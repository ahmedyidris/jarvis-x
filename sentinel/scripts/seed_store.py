"""One-time (idempotent) seed of the vector store from data/runbooks/*.md.
Run: ./.venv/bin/python scripts/seed_store.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from store.embeddings import embed_text
from store.vector_store import add_documents, is_empty

RUNBOOKS_DIR = Path(__file__).resolve().parent.parent / "data" / "runbooks"


def main():
    if not is_empty():
        print("vector_store.db already has documents — skipping seed. "
              "Delete data/vector_store.db to reseed.")
        return

    items = []
    for path in sorted(RUNBOOKS_DIR.glob("*.md")):
        text = path.read_text()
        items.append({
            "text": text,
            "metadata": {"source": path.name},
            "embedding": embed_text(text),
        })
        print(f"embedded {path.name}")

    add_documents(items)
    print(f"seeded {len(items)} runbooks into vector_store.db")


if __name__ == "__main__":
    main()
