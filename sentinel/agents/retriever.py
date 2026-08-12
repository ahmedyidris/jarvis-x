"""Retriever agent — the RAG step. Covers HF's Sentence Similarity /
Feature Extraction task: embed the incident + extracted entities, pull the
top-k nearest runbooks/past incidents out of the SQLite vector store.
"""
from store.embeddings import embed_text
from store.vector_store import query as vector_query


def _flatten_entities(entities: dict) -> str:
    """Entities come from an LLM's JSON output, so values may be a list,
    a bare string, or a bare number (e.g. a status code) — normalize all
    of them to strings instead of assuming list[str]."""
    parts = []
    for value in entities.values():
        values = value if isinstance(value, list) else [value]
        parts.extend(str(v) for v in values if v not in (None, ""))
    return " ".join(parts)


def retriever_node(state: dict) -> dict:
    entity_text = _flatten_entities(state.get("entities", {}) or {})
    query_text = f"{state['raw_input']} {entity_text}".strip()
    embedding = embed_text(query_text)
    hits = vector_query(embedding, top_k=3)
    return {"retrieved": hits}
