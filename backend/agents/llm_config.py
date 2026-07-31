import os
from langchain_openai import ChatOpenAI


def get_model(default_model="gpt-4o", env_name="OPENAI_MODEL"):
    return os.getenv(env_name) or os.getenv("OPENAI_MODEL") or default_model


def create_chat_llm(
    default_model="gpt-4o",
    env_name="OPENAI_MODEL",
    temperature=0,
    model_kwargs=None
):
    kwargs = {
        "model": get_model(default_model=default_model, env_name=env_name),
        "temperature": temperature
    }
    if model_kwargs:
        kwargs["model_kwargs"] = model_kwargs
    return ChatOpenAI(**kwargs)
