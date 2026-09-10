import os
from pathlib import Path
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def get_model(default_model="gpt-4o", env_name="OPENAI_MODEL"):
    return os.getenv(env_name) or os.getenv("OPENAI_MODEL") or default_model


def get_base_url():
    return os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")


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
    base_url = get_base_url()
    if base_url:
        kwargs["base_url"] = base_url
    if model_kwargs:
        kwargs["model_kwargs"] = model_kwargs
    return ChatOpenAI(**kwargs)
