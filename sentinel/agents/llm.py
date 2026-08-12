"""Single shared LLM handle for all agents — local Ollama first, matching
jarvis-x's `code/models.js` philosophy of local-first / API-as-fallback."""
import os
from langchain_ollama import ChatOllama

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")


def get_llm(temperature: float = 0.0) -> ChatOllama:
    return ChatOllama(base_url=OLLAMA_HOST, model=OLLAMA_MODEL, temperature=temperature)
