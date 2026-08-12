"""Import/wiring smoke test — no Ollama call, safe to run in CI without a
model server. For an end-to-end run against the real local model, use
eval/eval_harness.py instead.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_graph_compiles():
    from app.graph import build_graph
    graph = build_graph()
    assert graph is not None


def test_vector_store_roundtrip(tmp_path, monkeypatch):
    import store.vector_store as vs
    monkeypatch.setattr(vs, "DB_PATH", tmp_path / "test.db")
    assert vs.is_empty()
    vs.add_documents([{"text": "hello world", "metadata": {"source": "x"}, "embedding": [1.0, 0.0]}])
    hits = vs.query([1.0, 0.0], top_k=1)
    assert hits and hits[0]["text"] == "hello world"
