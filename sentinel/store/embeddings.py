"""Thin wrapper around Ollama's embeddings endpoint.

Kept dependency-free (just httpx) on purpose — Sentinel runs on a
disk-constrained Chromebook alongside jarvis-x, so we avoid pulling in
sentence-transformers/torch just to embed short incident text.
"""
import os

import httpx

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")


def embed_text(text: str) -> list[float]:
    resp = httpx.post(
        f"{OLLAMA_HOST}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]
