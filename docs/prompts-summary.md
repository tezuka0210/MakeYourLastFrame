# Prompt Summary

更新时间：2026-09-11

本文档总结当前系统中实际启用的提示词结构、用途和输出契约。当前主流程入口在 `backend/app.py`，主要调用 `master_agent.py`、`knowledge_agent.py`、`workflow_agent.py`、`prompt_agent.py` 和 `final_prompt_agent.py`。

## 1. Agent 总流程

完整 Agent 流程用于把用户自然语言请求转换成可执行 workflow 和生成 prompt。

流程顺序：

1. `Master Agent`
2. `Knowledge Agent`
3. `Workflow Agent`
4. `Prompt Agent`

对应入口：

- `/api/agents/process`
- 源码：`backend/app.py`
- 服务封装：`backend/agents/service.py`

## 2. Master Agent

源码：`backend/agents/master_agent.py`

用途：

- 理解用户输入，支持文本和可选图片。
- 把自然语言请求拆成结构化语义。
- 将中文或其他语言输入转成英文语义，方便后续生成。

输入：

- `user_input`
- 可选 `image_data`

核心要求：

- 区分三类语义：
  - `entities`：主体或物体名词，例如 `child`、`display case`
  - `attributes`：单个实体的属性，例如颜色、材质、状态、光照
  - `relations`：多个实体之间的空间或逻辑关系，例如 `child in front of display case`
- 不要把关系误写成属性。
- 没有内容时返回空列表，不编造。

输出 JSON：

```json
{
  "intent": "Core action",
  "entities": [],
  "attributes": [],
  "relations": [],
  "style": "Visual style description",
  "image_caption": "Brief image description"
}
```

## 3. Knowledge Agent

源码：`backend/agents/knowledge_agent.py`

用途：

- 根据 Master Agent 提取的实体、属性、关系和风格，补充视觉知识。
- 为后续 prompt 增加服装、灯光、建筑、氛围等细节。

输入：

- `entities`
- `attributes`
- `relations`
- `style`
- `user_input`

核心要求：

- 输出 3 到 5 句话。
- 保持简洁。
- 如果 Master Agent 没提取出有效内容，则直接用原始用户输入作为上下文。

输出：

```json
{
  "knowledge_context": "visual enhancement knowledge"
}
```

## 4. Workflow Agent

源码：`backend/agents/workflow_agent.py`

用途：

- 根据用户意图和当前父节点 workflow，选择最合适的 ComfyUI workflow 文件。

输入：

- `intent`
- `user_input`
- `workflow_list`
- `parent_workflow`

硬规则：

- 如果匹配 `generate line draft` 或 `generate line art draft`，优先选择 `ImageCanny.json`。
- 不允许选择 `ImageMerging.json`。
- 音频/旁白/声音请求优先选择 `TextToAudio.json`。
- 视频/运动/秒数请求选择视频类 workflow。
- 图片修改/融合选择 `ImageGenerateImage_Basic.json`。
- 线稿生成图选择 `ImageGenerateImage_Canny.json`。
- 图层叠放选择 `LayerStacking.json`。

输出 JSON：

```json
{
  "filename": "WorkflowFile.json",
  "title": "Node title"
}
```

## 5. Prompt Agent

源码：`backend/agents/prompt_agent.py`

用途：

- 根据选中的 workflow，把用户请求、全局上下文、知识补充和语义拆解改写成最终生成 prompt。
- 根据 workflow 类型选择不同系统提示词。

模式选择：

- `TextToAudio.json`：使用 Audio Prompt
- `TextGenerateVideo.json`、`ImageGenerateVideo.json`、`CameraControl.json`、`FLFrameToVideo.json`、`FrameInterpolation.json`：使用 Video Prompt
- 其他默认使用 Image Prompt

### 5.1 通用 Cue 拆解规则

所有图像和视频 prompt 都会使用统一的 cue 拆解规则。

核心步骤：

1. 重写用户句子，不直接照抄自然语言。
2. 拆成短语 cue，每条 cue 只表达一个意思。
3. 给每条 cue 标注类型：
   - `relation`
   - `entity`
   - `attribute`
4. 给 cue 加权。

权重规则：

- 用户请求中的关系：`1.4 - 1.6`
- 实体：`1.2 - 1.4`
- 用户请求中的属性：`1.1 - 1.3`
- 上下文或知识补充属性：`1.0 - 1.1`

图像/视频输出 JSON：

```json
{
  "positive": "(cue text:1.5) | (cue text:1.2)",
  "negative": "(failure cue:1.3)",
  "positive_cues": [
    {
      "text": "child in front of display case",
      "weight": 1.5,
      "type": "relation"
    }
  ],
  "negative_cues": [
    {
      "text": "child behind the case",
      "weight": 1.3,
      "type": "relation"
    }
  ]
}
```

### 5.2 Image Prompt

用途：

- 文生图、图生图、图像编辑、融合、局部修改等图像任务。

关键输入：

- `global_context`
- `user_input`
- `style`
- `knowledge`
- `entities`
- `attributes`
- `relations`

核心要求：

- 所有 prompt 必须是英文。
- 用户输入优先于全局上下文，全局上下文优先于知识补充。
- 每个关系必须单独输出，不要被合并成属性。
- 关系 cue 要靠前，放在主体之后、灯光风格之前。
- 对重要关系写对应 negative failure mode。
- 图像编辑时要明确保留不应变化的元素。
- 最大 prompt 长度目标为 512 tokens。

典型 negative：

- `bad anatomy`
- `blurry`
- `incorrect overlap`
- `changed identity`
- `floating object`

### 5.3 Video Prompt

用途：

- 文生视频、图生视频、相机控制、首尾帧视频、补帧类任务。

核心要求：

- 关注动作、运动、镜头、时间连续性。
- 图生视频时，主题和场景已由输入图决定，prompt 应重点描述运动和相机。
- 关系必须在整个视频中保持，例如主体不要漂移、相对位置不要变化。
- 对视频失败模式写入 negative。

视频 cue 重点：

- action
- camera movement
- lighting
- shot size
- composition
- motion smoothness
- style

典型 negative：

- `jerky motion`
- `low frame rate`
- `frame stutter`
- `subject drift`
- `relative position changing mid-shot`
- `jerky camera`

### 5.4 Audio Prompt

用途：

- 文生音频、背景音乐、声音氛围。

核心要求：

- 输出自然、连续的英文音乐描述。
- 不使用权重语法。
- 不输出关键词列表。
- 不要字面复述实体关系，而是根据关系推断情绪和氛围。

输出 JSON：

```json
{
  "text": "Soft, ethereal ambient music with gentle piano notes..."
}
```

## 6. Final Prompt Agent

源码：`backend/agents/final_prompt_agent.py`

用途：

- 用于 `/api/agents/only-prompt`。
- 在用户已经手动编辑 prompt/cue 后，只重新整理最终 prompt，不重跑完整 Agent 流程。

核心特点：

- 更偏“保留用户编辑”的模式。
- 不主动改写用户已经输入的关键词。
- 会把用户输入反解析为结构化 cue。
- 如果用户表达了保持/不变/原样等要求，会自动强化 preservation cues。

保留类正向 cue：

- `preserve original subject identity`
- `preserve original face`
- `preserve original clothing`
- `preserve original pose`
- `preserve original position`
- `preserve original scale`
- `preserve original composition`
- `preserve original camera angle`
- `preserve original lighting direction`

保留类负向 cue：

- `changed identity`
- `changed face`
- `changed clothing`
- `changed pose`
- `changed position`
- `changed scale`
- `changed composition`
- `changed camera angle`
- `inconsistent lighting`
- `subject drift`

输出 JSON：

```json
{
  "positive": "(preserve original subject identity:1.6) | ...",
  "negative": "(changed identity:1.4) | ...",
  "positive_cues": [],
  "negative_cues": []
}
```

## 7. Entity Vision Agent

源码：`backend/agents/entity_agent.py`

用途：

- 对生成图进行视觉实体识别。
- 服务于 `SegmentElement` / SAM 分割流程。

输入：

- 图片
- 原始 prompt

核心规则：

- 优先识别生物主体，例如人、动物。
- 中等优先级识别明显独立的建筑、车、家具等。
- 通常排除花草树木，除非它们是绝对核心主体。
- 不拆分附着物，例如人穿裙子时识别为 `woman/person`，不单独识别 `dress`。
- 不返回重叠局部，例如 `head`、`arm`。
- 返回适合 SAM 使用的简单英文名词。

输出 JSON：

```json
{
  "entities": ["person", "dog", "house"]
}
```

## 8. Segment Background Prompt

源码：`backend/app.py`

用途：

- `SegmentElement` 分割主体后，会调用 `RemovePeople.json` 生成背景补全图。

如果用户填写了背景 prompt：

- 使用用户提供的 `background_prompt` 或 `remove_people_prompt`。

如果没有填写：

```text
Remove {subjects} from the image and reconstruct the original background behind them.
Preserve the camera angle, lighting, composition, color tone, and scene context.
Do not add new subjects.
```

用途上它不是通用生成 prompt，而是专门给背景修复/去主体 workflow 使用。

## 9. Speech Transcription Prompt

源码：`backend/app.py`

用途：

- 语音输入转文字。
- 在线语音模型和本地 Whisper 都会使用对应 prompt 或热词。

中文模式：

- 逐字转写为简体中文。
- 只输出转写文字。
- 不描述音频、不总结、不加标题。
- 保留说话者实际使用的中文、英文、数字、字母和标点。
- 英文术语不翻译。
- 没有清晰人声时输出空字符串。

英文模式：

- 逐字转写英文。
- 只输出 transcript。
- 保留词语、数字、标点和明确的领域术语大小写。
- 没有可辨别人声时输出空字符串。

自动语言模式：

- 自动检测语言。
- 英文输出英文，中文输出简体中文。
- 不翻译、不总结、不描述音频。

热词机制：

- 从 `backend/speech_glossary.json` 读取术语。
- 只有音频中确实出现标准词、别名或明显同音表达时，才使用标准写法。
- 不凭空添加热词。

## 10. Speech Polish Prompt

源码：`backend/app.py`

用途：

- 对语音转写结果做轻量整理。

核心要求：

- 只修正明显识别错误。
- 补充标点。
- 删除重复口癖。
- 保留原意。
- 不添加新角色、新物体、新风格。
- 不扩写成正式生成 prompt。
- 不翻译。
- 只输出整理后的文本，不解释。

## 11. 独立 Prompt 版本备注

当前仓库中还有一些备用或历史版本：

- `backend/agents/prompt_agent_new.py`
- `backend/agents/final_prompt_agent_weight.py`
- `backend/agents/graph.py`

根据当前 `backend/app.py` 的导入和调用路径，它们不是主流程正在使用的 prompt 版本。若后续切换到这些文件，需要单独重新整理它们的提示词规则。

## 12. 当前 Prompt 系统的设计重点

整体策略可以概括为：

- 先理解语义，再选择 workflow，再生成 prompt。
- 把实体、属性、关系分开，尤其保护空间关系。
- 图像/视频 prompt 使用 weighted cues。
- 音频 prompt 使用自然语言描述，不使用 cue 权重。
- 用户编辑过的 prompt 尽量保留。
- 对“保持不变”类需求强制加入 preservation cues。
- 语音输入只负责准确转写和轻量整理，不直接扩写成生成 prompt。
