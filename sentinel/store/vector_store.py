"""Minimal SQLite-backed vector store.

Mirrors jarvis-x's own "SQLite for state" pattern (see Hermes Core) instead
of standing up Qdrant/pgvector — the corpus here is a few hundred runbooks
and past incidents at most, so a linear cosine scan is plenty fast and
costs zero extra services or disk.
"""
import json
import sqlite3
from pathlib import Path

import numpy as np

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "vector_store.db"


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            metadata TEXT NOT NULL,
            embedding TEXT NOT NULL
        )"""
    )
    return conn


def add_documents(items: list[dict]):
    """items: [{"text": ..., "metadata": {...}, "embedding": [...] }]"""
    conn = _connect()
    conn.executemany(
        "INSERT INTO docs (text, metadata, embedding) VALUES (?, ?, ?)",
        [
            (it["text"], json.dumps(it["metadata"]), json.dumps(it["embedding"]))
            for it in items
        ],
    )
    conn.commit()
    conn.close()


def query(embedding: list[float], top_k: int = 3) -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT text, metadata, embedding FROM docs").fetchall()
    conn.close()
    if not rows:
        return []

    q = np.array(embedding)
    q_norm = np.linalg.norm(q) or 1e-8

    scored = []
    for text, metadata, emb_json in rows:
        v = np.array(json.loads(emb_json))
        v_norm = np.linalg.norm(v) or 1e-8
        sim = float(np.dot(q, v) / (q_norm * v_norm))
        scored.append({"text": text, "metadata": json.loads(metadata), "score": sim})

    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored[:top_k]


def is_empty() -> bool:
    conn = _connect()
    n = conn.execute("SELECT COUNT(*) FROM docs").fetchone()[0]
    conn.close()
    return n == 0
