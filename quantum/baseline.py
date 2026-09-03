"""The two things the quantum classifier has to beat.

1. ``keyword_route`` -- a port of ``resolveQuery()`` from
   ``code/agent-data-integration.js``, which is what Jarvis actually ships.
   A new approach that cannot beat the code already in production is not an
   improvement, however interesting it is.

2. ``SoftmaxRegression`` -- plain multinomial logistic regression on the same
   features. Without this, any quantum result is unfalsifiable: you cannot tell
   whether the circuit helped or whether the features were simply learnable.
"""

import json
import os
import time

import numpy as np

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "intents.json")

# Kept in lockstep with code/agent-data-integration.js resolveQuery()'s
# keywordMap. Its 11 data keys collapse to the 4 provider families here.
KEYWORD_MAP = [
    (["bitcoin", "btc"], "crypto"),
    (["ethereum", "eth"], "crypto"),
    (["sp500", "s&p 500", "stock market"], "market"),
    (["nasdaq", "tech stocks"], "market"),
    (["yield", "treasury"], "market"),
    (["gold"], "energy"),
    (["oil", "crude"], "energy"),
    (["gas", "natural gas"], "energy"),
    (["fed", "interest", "rate"], "news"),
    (["earnings", "q3", "profit"], "news"),
    (["geopolitical", "shipping", "red sea"], "news"),
]


def keyword_route(query):
    """Returns a family, or None -- matching the JS function's null."""
    lowered = query.lower()
    for keywords, family in KEYWORD_MAP:
        if any(k in lowered for k in keywords):
            return family
    return None


def load_dataset(path=DATA_PATH):
    with open(path) as fh:
        raw = json.load(fh)
    families = raw["families"]
    texts = [q["text"] for q in raw["queries"]]
    labels = np.array([families.index(q["family"]) for q in raw["queries"]])
    kinds = np.array([q["kind"] for q in raw["queries"]])
    return families, texts, labels, kinds


def split(n, every=3):
    """Deterministic held-out split: every Nth sample is test.

    Deterministic rather than random so a benchmark rerun is comparable to the
    numbers already written down in QUANTUM_FEASIBILITY.md.
    """
    idx = np.arange(n)
    test = idx % every == 0
    return ~test, test


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


class SoftmaxRegression:
    def __init__(self, n_features, n_classes, seed=7):
        rng = np.random.default_rng(seed)
        self.W = rng.normal(0, 0.1, (n_features, n_classes))
        self.b = np.zeros(n_classes)
        self.n_classes = n_classes

    @property
    def n_params(self):
        return self.W.size + self.b.size

    def fit(self, X, y, epochs=1500, lr=1.0):
        Y = np.eye(self.n_classes)[y]
        started = time.perf_counter()
        for _ in range(epochs):
            P = softmax(X @ self.W + self.b)
            self.W -= lr * (X.T @ (P - Y) / len(X))
            self.b -= lr * (P - Y).mean(axis=0)
        return time.perf_counter() - started

    def predict(self, X):
        return softmax(X @ self.W + self.b).argmax(axis=1)
