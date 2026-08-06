import json
from langchain_core.messages import HumanMessage,SystemMessage
from .state import AgentState
from .llm_config import create_chat_llm

def master_agent_node(state: AgentState):
    print("--- Running Master Agent ---")

    image_data = state.get("image_data", None)
    print(state.get("user_input",None))

    # 1. Initialize LLM (GPT-4o is required for Image Vision)
    llm = create_chat_llm(
        default_model="gpt-4o",
        env_name="OPENAI_VISION_MODEL",
        temperature=0,
        model_kwargs={"response_format":{"type": "json_object"}}
    )


    # 2. Construct the System Prompt
    system_prompt = """
    You are the "Master Brain" of a creative AI system.
    Your task is to analyze User Input (Text + Optional Image) and extract structured information.

    IMPORTANT:
    1. The user input might be in Chinese or other languages.
    2. You MUST decompose the request into three DISTINCT categories: entities, attributes, relations.
    3. Please translate the extracted values into English for better downstream processing.

    Decomposition rules (read carefully, this separation matters):
    - "entities": primary subjects or objects. Nouns only. e.g. 'child', 'display case', 'artifact'.
    - "attributes": traits that belong to ONE entity on its own -- colour, material, texture,
      size, condition, state. Each item SHOULD name the entity it belongs to.
      e.g. 'wooden display case', 'glowing orb', 'weathered bronze artifact'.
    - "relations": spatial or logical links BETWEEN two or more entities. Each item MUST
      mention at least two entities, or one entity plus the viewpoint.
      e.g. 'child stands in front of the display case', 'artifact enclosed inside the case',
      'child looking at the artifact through the glass', 'probe placed ahead of the astronaut',
      'visible energy connection between orb and probe', 'camera orbiting around the car'.

    A trait of a single object is an ATTRIBUTE, never a relation.
    A link between two objects is a RELATION, never an attribute.
    If a phrase names only one entity and no viewpoint, it is an attribute.
    Return an empty list rather than inventing content that is not in the input.

    Output JSON format requirements:
    {
        "intent": "Core action (e.g., 'text_to_image', 'image_to_video', 'modify_image')",
        "entities": ["list", "of", "visual", "subjects", "e.g., 'man', 'robe', 'vase'"],
        "attributes": ["traits of a single entity, e.g., 'red robe', 'cracked vase'"],
        "relations": ["links between entities, e.g., 'man holding the vase', 'vase on the table'"],
        "style": "Visual style description (e.g., 'Ancient Chinese Court', 'Photorealistic')",
        "image_caption": "Brief description of the uploaded image content (if any, else empty)"
    }
    """

    # 3. Construct the User Message (Text + Image)
    content_blocks = [{"type": "text", "text": state["user_input"]}]

    if image_data:
        content_blocks.append({
            "type": "image_url",
            "image_url": {"url": image_data}
        })

    messages = [SystemMessage(content=system_prompt), HumanMessage(content=content_blocks)]

    # 4. Execute
    response = llm.invoke(messages)

    # 5. Parse JSON
    try:
        parsed_data = json.loads(response.content)
    except json.JSONDecodeError:
        print("❌ Master Agent: JSON Parse Error")
        parsed_data = {
            "intent": state["user_input"],
            "entities": [],
            "attributes": [],
            "relations": [],
            "style": "General",
            "image_caption": ""
        }

    def _as_str_list(value):
        """Downstream code assumes a flat list of strings. The model occasionally
        returns a bare string, None, or a list of dicts; normalise all of those."""
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, dict):
            return [str(v) for v in value.values() if str(v).strip()]
        if isinstance(value, list):
            out = []
            for item in value:
                if isinstance(item, str):
                    if item.strip():
                        out.append(item.strip())
                elif isinstance(item, dict):
                    out.append(", ".join(f"{k}: {v}" for k, v in item.items()))
                elif item is not None:
                    out.append(str(item))
            return out
        return [str(value)]

    entities = _as_str_list(parsed_data.get("entities"))
    attributes = _as_str_list(parsed_data.get("attributes"))
    relations = _as_str_list(parsed_data.get("relations"))

    print(f"AGENCY: Master Agent Intent: {parsed_data.get('intent')}")
    print(f"AGENCY: Entities({len(entities)}) {entities}")
    print(f"AGENCY: Attributes({len(attributes)}) {attributes}")
    print(f"AGENCY: Relations({len(relations)}) {relations}")

    # 6. Update State
    return {
        "intent": parsed_data.get("intent"),
        "entities": entities,
        "attributes": attributes,
        "relations": relations,
        "style": parsed_data.get("style"),
        "image_caption": parsed_data.get("image_caption")
    }
