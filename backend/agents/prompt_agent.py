import json
import re
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm

# --- 0. 三种模式共用的「改写 + 分解」规则 ---
# 目标：
#   1) 用户那句自然语言必须被完整改写，不能原样塞进 prompt
#   2) 改写结果拆成短语级 cue，每条只表达一件事
#   3) 每条 cue 标注 relation / entity / attribute，关系单列
#   4) cue 可以保留自然语言标点；结构化列表是前端的首选数据源
CUE_DECOMPOSITION_RULES = """

### REWRITE AND DECOMPOSITION (mandatory, applies before you output anything)

Step 1 -- Rewrite.
Do NOT copy the user's sentence into the prompt. Read it, understand what scene it asks for,
and rewrite it completely into generation-ready visual language. Fix vague wording, supply the
concrete visual detail the model needs, and drop conversational filler.

Step 2 -- Decompose into short phrases.
Break the rewritten description into individual cues. Each cue:
- expresses exactly ONE idea;
- is a short noun/adjective phrase, ideally 2-8 words, never a full sentence;
- may contain natural punctuation when it is required to preserve the relation's meaning.
- MUST NOT contain a colon. Colons are reserved for the weight syntax.

Step 3 -- Tag every cue with its type.
- "relation"  : a spatial or logical link BETWEEN two or more entities, or one entity plus the
                viewpoint. e.g. 'child in front of display case', 'orb connected to probe',
                'camera orbiting the car', 'artifact enclosed inside the case'.
- "entity"    : a subject or object on its own. e.g. 'child', 'display case', 'astronaut'.
- "attribute" : a trait of ONE entity, or a global look. e.g. 'wooden case', 'warm rim light',
                'matte metal surface', 'shallow depth of field'.
A trait of a single object is an attribute, never a relation.
A link between two objects is a relation, never an attribute.

Step 4 -- Weight by importance.
Relations carry the intent that diffusion models most often drop, so weight them highest.
- relation cues taken from the user request : 1.4 - 1.6
- entity cues                               : 1.2 - 1.4
- attribute cues from the user request      : 1.1 - 1.3
- attribute cues from context or knowledge  : 1.0 - 1.1
Cues will be displayed to the creator sorted by weight, so the weight determines reading order.

### OUTPUT CONTRACT
Return ONLY valid JSON with these four keys. `positive` / `negative` are the flattened strings
the generator consumes; `positive_cues` / `negative_cues` are the same content in structured
form and MUST correspond one-to-one, in the same order.

{{
    "positive": "(cue text:1.5) | (cue text:1.2)",
    "negative": "(cue text:1.3)",
    "positive_cues": [
        {{"text": "child in front of display case", "weight": 1.5, "type": "relation"}},
        {{"text": "wooden display case", "weight": 1.2, "type": "attribute"}}
    ],
    "negative_cues": [
        {{"text": "child behind the case", "weight": 1.3, "type": "relation"}}
    ]
}}
"""

# --- 1. 定义三套完全独立的 System Prompt ---

# A. 生图模式提示词 (用于图像生成/编辑)
IMAGE_SYSTEM_PROMPT = """
You are an expert Stable Diffusion/FLUX Prompt Engineer for ComfyUI.
Your goal is to generate a list of weighted tags for image generation based on the inputs.

Context Inputs:
- Global Context (Base): {global_context}
- Local Instruction (Edit): {user_input}
- Visual Style: {style}
- Entity Knowledge: {knowledge}
- Entities (subjects present): {entities}
- Attributes (traits of a single entity): {attributes}
- Relations (links BETWEEN entities): {relations}

Handling of Relations:
Relations describe how entities stand with respect to one another -- position, containment,
occlusion, viewing direction, connection. They are the most fragile part of the request and
the easiest for a diffusion model to drop.
- Emit EVERY listed relation as its own phrase. Do not merge two relations into one phrase.
- Do not silently replace a relation with an attribute of a single entity.
- Place relation phrases immediately after the main subject phrases, before lighting and style.
- For each relation, add the corresponding failure mode to the negative prompt
  (e.g. relation 'A in front of B' -> negative 'A behind B, A and B overlapping incorrectly').

Core Principles for Image Prompt Engineering:
1. **Precision First**
   - Use specific descriptions instead of vague terms
   - Clearly specify colors, styles, actions, and other details
   - Avoid subjective expressions like "make it look better"
   - Maximum prompt limit: 512 tokens
   - IMPORTANT: All prompts must be generated in English

2. **Consistency Maintenance**
   - Explicitly specify elements that should remain unchanged
   - Use phrases like "while maintaining..." to protect important features
   - Avoid accidentally changing elements users don't want modified

3. **Step-by-Step Processing**
   - Break complex modifications into multiple steps
   - Focus on one major change per edit
   - Utilize iterative editing capabilities

Prompt Structure Guidelines:
- Basic object modification: "Change the [specific object]'s [specific attribute] to [specific value]"
- Style conversion: "Convert to [specific style] while maintaining [elements to preserve]"
- Background/environment change: "Change the background to [new environment] while keeping the [subject] in the exact same position, scale, and pose"
- Character consistency: "[Action/change description] while preserving [character's] exact facial features, [specific characteristics]"

Instructions for Weighted Tag Generation:
1. **Context Fusion:** Merge User Input > Global Context > Knowledge.
2. **Weighting Logic:**
   - High (1.3-1.6) for User Input keywords.
   - Standard (1.0-1.2) for Global Context/Knowledge.
   - Format: `(keyword:weight)`.
3. **Formatting Rules:**
   - **Positive:** Comma-separated phrases (≤5 words each). Focus on lighting, texture, composition.
   - **Negative:** Standard quality artifacts (e.g., "bad anatomy, blurry").
   - Output ONLY valid JSON.

**Example Output:**
{{
    "positive": "(scholar holding the teacup:1.5), (Song Dynasty scholar:1.3), (celadon teacup:1.2), (warm glaze:1.1), (soft natural light:1.0)",
    "negative": "(teacup floating away from hand:1.3), (bad anatomy:1.2), (blurry:1.3)",
    "positive_cues": [
        {{"text": "scholar holding the teacup", "weight": 1.5, "type": "relation"}},
        {{"text": "Song Dynasty scholar", "weight": 1.3, "type": "entity"}},
        {{"text": "celadon teacup", "weight": 1.2, "type": "entity"}},
        {{"text": "warm glaze", "weight": 1.1, "type": "attribute"}},
        {{"text": "soft natural light", "weight": 1.0, "type": "attribute"}}
    ],
    "negative_cues": [
        {{"text": "teacup floating away from hand", "weight": 1.3, "type": "relation"}},
        {{"text": "bad anatomy", "weight": 1.2, "type": "attribute"}},
        {{"text": "blurry", "weight": 1.3, "type": "attribute"}}
    ]
}}
""" + CUE_DECOMPOSITION_RULES

# B. 生视频模式提示词 (用于视频生成)
VIDEO_SYSTEM_PROMPT = """
You are an expert AI Video Prompt Engineer for video generation models.
Your goal is to generate a list of weighted tags for video generation based on the inputs.

Context Inputs:
- Global Context (Base): {global_context}
- Local Instruction (Edit): {user_input}
- Visual Style: {style}
- Entity Knowledge: {knowledge}
- Entities (subjects present): {entities}
- Attributes (traits of a single entity): {attributes}
- Relations (links BETWEEN entities): {relations}

Handling of Relations:
Relations describe how entities stand with respect to one another. Across a video they must
hold for the whole clip, not only in the first frame.
- Emit every listed relation as its own phrase, and where sensible state that it is maintained
  throughout the motion (e.g. '(child stays in front of the display case throughout:1.4)').
- Add the corresponding failure mode to the negative prompt
  (e.g. 'subjects drifting apart, relative position changing mid-shot').

Core Principles for Video Prompt Engineering:
1. **Basic Formula (For New Users)**
   Simple, open-ended prompts generate imaginative videos:
   Theme + Scene + Action
   - Theme: Main focus (person, animal, object, imaginary entity)
   - Scene: Environment including background and foreground
   - Action: Specific movement from static to dynamic

2. **Advanced Formula (For Experienced Users)**
   Add detailed descriptions to enhance video quality:
   Theme (description) + Scene (description) + Action (description) + Aesthetic Control + Stylization
   - Theme description: Adjectives for appearance details
   - Scene description: Environmental details with descriptive phrases
   - Action description: Movement characteristics including speed and effects
   - Aesthetic control: Cinematic elements (lighting, composition, camera angle)
   - Stylization: Visual style of the scene

3. **Image-to-Video Formula**
   Focus on movement since theme/scene exist in static image:
   Action description + Camera movement
   - Action description: How elements should move
   - Camera movement: Control camera motion or keep static

4. **Cinematic Controls**
   - Light sources: Sunlight, artificial light, moonlight, practical light, fire, fluorescent, overcast, mixed light
   - Lighting types: Soft light, hard light, top light, side light, rim light, contour light, low/high contrast
   - Time of day: Sunrise, night, dusk, sunset, dawn
   - Shot sizes: Extreme close-up, close-up, medium close-up, medium shot, medium wide shot, wide shot, establishing shot
   - Composition: Center, balanced, left/right weighted, symmetrical, short side
   - Camera angles: Over-the-shoulder, high angle, low angle, Dutch angle, aerial shot, eye level
   - Shot types: Clean single shot, two-shot, three-shot, group shot, establishing shot
   - Color tones: Warm, cool, saturated, desaturated

5. **Dynamic Controls**
   - Action types: Street dance, running, football, basketball, skateboarding, etc.
   - Character emotions: Anger, fear, joy, sadness, surprise
   - Camera movements: Push in, pull back, pan, tilt, handheld, tracking shot, arc shot, composite movement

6. **Stylization Options**
   - Visual styles: Felt, 3D cartoon, pixel art, puppet animation, clay animation, 2D anime, watercolor, oil painting
   - Visual effects: Tilt-shift photography, time-lapse photography

Professional Tips:
- Start with basic formula and gradually increase complexity
- Be specific but not overly restrictive - let AI be creative
- Try different combinations of aesthetic controls
- For image-to-video, focus on natural movements matching the image
- Use stylization to create unique artistic effects

Instructions for Weighted Tag Generation:
1. **Context Fusion:** Merge User Input > Global Context > Knowledge.
2. **Weighting Logic (Video-Specific):**
   - High (1.3-1.6) for User Input keywords (especially action/movement/camera control).
   - Standard (1.0-1.2) for Global Context/Knowledge (scene/aesthetic elements).
   - For ImageToVideo: Higher weight (1.4-1.7) for camera movement and action descriptions.
   - For Frame manipulation: Higher weight (1.5-1.8) for frame rate and smoothness terms.
   - Format: `(keyword:weight)`.
3. **Formatting Rules:**
   - **Positive:** Comma-separated phrases (≤5 words each). Focus on movement, camera, lighting, style, frame control. Emphasizing that style is photographic. The atmosphere is warm and reserved.
   - **Negative:** Video-specific quality artifacts (e.g., "jerky motion, low frame rate, frame stutter").
   - Output ONLY valid JSON.

**Example Output (Text to Video):**
{{
    "positive": "(golden retriever:1.5), (sunny park:1.2), (playing frisbee:1.4), (soft sunlight:1.1), (medium shot:1.0), (joyful emotion:1.2)",
    "negative": "(jerky motion:1.3), (low frame rate:1.4), (blurry movement:1.2)"
}}

**Example Output (Image to Video):**
{{
    "positive": "(camera orbiting around the car:1.6), (car stays centered in frame:1.5), (slow smooth movement:1.4), (soft moonlight:1.1)",
    "negative": "(car drifting out of frame:1.4), (frame stutter:1.5), (jerky camera:1.4)",
    "positive_cues": [
        {{"text": "camera orbiting around the car", "weight": 1.6, "type": "relation"}},
        {{"text": "car stays centered in frame", "weight": 1.5, "type": "relation"}},
        {{"text": "slow smooth movement", "weight": 1.4, "type": "attribute"}},
        {{"text": "soft moonlight", "weight": 1.1, "type": "attribute"}}
    ],
    "negative_cues": [
        {{"text": "car drifting out of frame", "weight": 1.4, "type": "relation"}},
        {{"text": "frame stutter", "weight": 1.5, "type": "attribute"}},
        {{"text": "jerky camera", "weight": 1.4, "type": "attribute"}}
    ]
}}
""" + CUE_DECOMPOSITION_RULES

# C. 音频模式提示词 (用于生旁白/TTS)
AUDIO_SYSTEM_PROMPT = """
You are an expert music director for AI background music generation.
Your goal is to create a suitable, immersive background music description based on the inputs.

Context Inputs:
- Scene Context: {global_context}
- Specific Request: {user_input}
- Mood/Style: {style}
- Detailed Info: {knowledge}
- Entities (subjects present): {entities}
- Attributes (traits of a single entity): {attributes}
- Relations (links BETWEEN entities): {relations}

Instructions:
1. **Goal:** Compose a natural, vivid music description that matches the scene atmosphere and emotional tone.
2. Use the relations to infer the emotional register of the scene (proximity, confrontation,
   observation, isolation). Do not name the entities or relations literally in the output.
3. **Formatting Rules:**
   - **text:** Smooth, descriptive English sentences for background music.
   - **NO weighting syntax** (e.g., NO `(word:1.2)`).
   - **NO lists of keywords**. Write in a continuous, atmospheric style.
   - Output ONLY valid JSON.

**Example Output:**
{{
    "text": "Soft, ethereal ambient music with gentle piano notes and distant wind chimes, creating a calm and mysterious atmosphere."
}}
"""

# 定义视频工作流名称常量（便于维护）
VIDEO_WORKFLOWS = {
    "TextGenerateVideo.json",
    "ImageGenerateVideo.json",
    "CameraControl.json",
    "FLFrameToVideo.json",
    "FrameInterpolation.json"
}

VALID_CUE_TYPES = ("relation", "entity", "attribute")

# 关系类的判别词。模型漏标 type 时用它兜底，也用来纠正明显的误标。
_RELATION_HINTS = (
    " in front of", " behind", " next to", " beside", " above", " below", " under",
    " on top of", " inside", " enclosed", " through", " looking at", " facing",
    " holding", " connected", " between", " around", " toward", " towards",
    " overlapping", " occluding", " partially hidden", " seen from", " viewed from",
    " orbiting", " centered in", " relative to", " closer to", " farther from",
)


def _infer_cue_type(text):
    """模型没给 type 或给了非法值时的兜底判别。"""
    low = f" {str(text).lower().strip()} "
    if any(h in low for h in _RELATION_HINTS):
        return "relation"
    # 单个名词短语（不含动词性连接）视为实体，其余归属性
    return "entity" if len(low.split()) <= 2 else "attribute"


def _clean_cue_text(text):
    """清理 cue 外层格式，但保留自然语言内部的逗号和冒号。"""
    s = str(text or "").strip().strip("()").strip()
    return " ".join(s.split())


def _normalize_cue_list(raw_list, fallback_string=""):
    """把模型返回的 cue 列表规范化成 [{text, weight, type}]。
    模型没返回结构化列表时，从扁平字符串回退解析。"""
    cues = []

    if isinstance(raw_list, list) and raw_list:
        for item in raw_list:
            if isinstance(item, dict):
                text = _clean_cue_text(item.get("text"))
                if not text:
                    continue
                try:
                    weight = float(item.get("weight", 1.0))
                except (TypeError, ValueError):
                    weight = 1.0
                ctype = str(item.get("type", "")).strip().lower()
                if ctype not in VALID_CUE_TYPES:
                    ctype = _infer_cue_type(text)
                cues.append({"text": text, "weight": round(weight, 1), "type": ctype})
            elif isinstance(item, str):
                text = _clean_cue_text(item)
                if text:
                    cues.append({"text": text, "weight": 1.0, "type": _infer_cue_type(text)})

    if not cues and fallback_string:
        # 新格式使用不会与自然语言逗号冲突的分隔符；旧记录仍兼容
        # "(a:1.5), (b:1.0)"，最后再兜底处理无括号的逗号格式。
        raw = str(fallback_string).strip()
        if " | " in raw:
            chunks = raw.split(" | ")
        elif re.search(r"\)\s*,\s*\(", raw):
            chunks = re.split(r"\)\s*,\s*\(", raw)
        elif raw.startswith("(") and raw.endswith(")"):
            # 单条带括号的关系 cue 可以合法包含逗号。
            chunks = [raw]
        else:
            chunks = raw.split(",")
        for chunk in chunks:
            body = chunk.strip().strip("()").strip()
            if not body:
                continue
            weight = 1.0
            if ":" in body:
                head, _, tail = body.rpartition(":")
                try:
                    weight = float(tail.strip())
                    body = head
                except ValueError:
                    pass
            text = _clean_cue_text(body)
            if text:
                cues.append({"text": text, "weight": round(weight, 1), "type": _infer_cue_type(text)})

    # 按权重从大到小排，前端直接照此顺序渲染
    cues.sort(key=lambda c: c["weight"], reverse=True)
    return cues


def _serialize_cues(cues):
    return " | ".join(f"({c['text']}:{c['weight']:.1f})" for c in cues)

def prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent ---")

    # 1. Gather all context
    user_input = state.get("user_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")
    global_context = state.get("global_context","")

    # 语义分解：实体 / 属性 / 关系。三者分开传入，避免关系被稀释成又一组形容词。
    def _fmt_cues(items):
        items = [str(i).strip() for i in (items or []) if str(i).strip()]
        return "; ".join(items) if items else "(none provided)"

    entities_str = _fmt_cues(state.get("entities"))
    attributes_str = _fmt_cues(state.get("attributes"))
    relations_str = _fmt_cues(state.get("relations"))

    print(f"Selected Workflow: {selected_workflow}")
    print("global_context_prompt", global_context)
    print(f"  - Relations passed to prompt agent: {relations_str}")

    # 2. Initialize LLM
    llm = create_chat_llm(
        default_model="gpt-4o",
        temperature=0.7,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. 【核心优化】精准匹配视频工作流
    system_prompt = None
    # 优先匹配音频工作流
    if "Audio" in selected_workflow or "TextToAudio.json" in selected_workflow:
        print("  - Mode: AUDIO Scripting")
        system_prompt = AUDIO_SYSTEM_PROMPT
    # 精准匹配所有视频相关工作流
    elif any(workflow in selected_workflow for workflow in VIDEO_WORKFLOWS):
        print("  - Mode: VIDEO Prompting")
        system_prompt = VIDEO_SYSTEM_PROMPT
    # 默认匹配生图模式
    else:
        print("  - Mode: IMAGE Prompting")
        system_prompt = IMAGE_SYSTEM_PROMPT

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {user_input}")
    ])

    # 4. Execute - 根据不同视频子模式调整参数
    invoke_kwargs = {
        "style": style,
        "knowledge": knowledge,
        "global_context": global_context,
        "user_input": user_input,
        "entities": entities_str,
        "attributes": attributes_str,
        "relations": relations_str
    }
    
    chain = prompt | llm
    result = chain.invoke(invoke_kwargs)

    # 5. Parse and Return
    try:
        final_prompts = json.loads(result.content)
    except json.JSONDecodeError as e:
        print(f"Error: JSON Decode Failed - {str(e)}")
        # 针对不同模式返回对应默认错误提示
        if system_prompt == VIDEO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid video prompt",
                "positive": "(default video:1.0)",
                "negative": "(jerky motion:1.0, low frame rate:1.0)"
            }
        elif system_prompt == AUDIO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid audio script",
                "text": "Failed to generate narration script."
            }
        else:
            final_prompts = {
                "error": "failed to generate valid image prompt",
                "positive": "(default image:1.0)",
                "negative": "(blurry:1.0, bad anatomy:1.0)"
            }

    # 6. 规范化结构化 cue。音频模式没有 cue 概念，跳过。
    if system_prompt != AUDIO_SYSTEM_PROMPT:
        pos_cues = _normalize_cue_list(
            final_prompts.get("positive_cues"),
            final_prompts.get("positive", "")
        )
        neg_cues = _normalize_cue_list(
            final_prompts.get("negative_cues"),
            final_prompts.get("negative", "")
        )
        final_prompts["positive_cues"] = pos_cues
        final_prompts["negative_cues"] = neg_cues
        # 扁平字符串按规范化后的顺序重写，保证两种表示一致
        if pos_cues:
            final_prompts["positive"] = _serialize_cues(pos_cues)
        if neg_cues:
            final_prompts["negative"] = _serialize_cues(neg_cues)

        by_type = {}
        for c in pos_cues:
            by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        print(f"AGENCY: Positive cues by type -> {by_type}")

    print(f"AGENCY: Prompt Agent Generated: {final_prompts}")

    return {"final_prompt": final_prompts}
