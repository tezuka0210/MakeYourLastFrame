from .state import AgentState
from .master_agent import master_agent_node
from .knowledge_agent import knowledge_agent_node
from .workflow_agent import workflow_selector_node
from .prompt_agent import prompt_agent_node
from .utils import get_all_workflow_names

def run_agent_pipeline(user_input: str, image_data: str = None, parent_workflow: str = None):
    """
    这是给后端 API 调用的唯一入口函数
    """
    print(f"🚀 Processing Request: {user_input[:20]}...")

    # 1. 初始化状态
    state = {
        "user_input": user_input,
        "image_data": image_data,
        "parent_workflow": parent_workflow,
        "workflow_list": get_all_workflow_names(),
        # 预设空值防止报错
        "intent": "", "entities": [], "attributes": [], "relations": [],
        "style": "", "knowledge_context": "",
        "selected_workflow": "", "workflow_title": "", "final_prompt": {}
    }

    # 2. 依次执行 Agent (线性流水线)
    # Master -> Knowledge -> Workflow -> Prompt
    state.update(master_agent_node(state))
    state.update(knowledge_agent_node(state))
    state.update(workflow_selector_node(state))
    state.update(prompt_agent_node(state))

    # 3. 格式化返回给前端的数据
    return {
        "status": "success",
        "data": {
            "intent": state["intent"],
            "style": state["style"],
            "knowledge": state["knowledge_context"],
            # 语义分解：前端据此把 cue 按类型分组显示，并记录各类型的编辑行为
            "semantic_cues": {
                "entities": state.get("entities", []),
                "attributes": state.get("attributes", []),
                "relations": state.get("relations", [])
            },
            "recommendation": {
                "workflow_file": state["selected_workflow"],
                "card_title": state["workflow_title"]
            },
            "prompts": state["final_prompt"]
        }
    }