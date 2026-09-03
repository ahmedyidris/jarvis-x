"""Fast correctness tests. No training runs here -- a full VQC fit takes ~140s,
which does not belong in a test suite.

    python3 quantum/test_quantum.py     # standalone
    pytest quantum/test_quantum.py      # or under pytest

These assert behaviour, never accuracy: the accuracy numbers are the
benchmark's job, and asserting them here would make the suite fail whenever the
seed or dataset changes, which is not a regression.
"""

import sys

import numpy as np

try:
    import pennylane as qml
    from pennylane import numpy as pnp
except ImportError:  # pragma: no cover
    print("SKIP: pennylane not installed (pip install -r quantum/requirements.txt)")
    sys.exit(0)

sys.path.insert(0, __file__.rsplit("/", 2)[0])
from quantum import circuits, features                      # noqa: E402
from quantum.baseline import (SoftmaxRegression, keyword_route,  # noqa: E402
                              load_dataset, split)

FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print(f"ok   {name}")
    else:
        print(f"FAIL {name}" + (f" ({detail})" if detail else ""))
        FAILURES.append(name)


# ----------------------------------------------------------------- featurizer
def test_features():
    a = features.for_amplitude_embedding("bitcoin price today", 8)
    b = features.for_amplitude_embedding("bitcoin price today", 8)
    check("featurizer is deterministic across calls", np.allclose(a, b))

    check("amplitude features are unit-norm (valid state vector)",
          abs(np.linalg.norm(a) - 1.0) < 1e-12,
          f"norm={np.linalg.norm(a)}")

    check("amplitude features have 2**n entries", a.shape == (256,),
          f"shape={a.shape}")

    empty = features.for_amplitude_embedding("", 8)
    check("empty query still yields a valid state vector",
          abs(np.linalg.norm(empty) - 1.0) < 1e-12)

    ang = features.for_angle_embedding("bitcoin price today", 8)
    check("angle features are one-per-qubit", ang.shape == (8,))
    check("angle features stay within [0, pi]",
          ang.min() >= 0 and ang.max() <= np.pi + 1e-12)

    different = features.for_amplitude_embedding("gold price today", 8)
    check("different queries give different features",
          not np.allclose(a, different))


# -------------------------------------------------------------------- circuit
def test_circuit_shape():
    circuit = circuits.build(n_classes=4, n_qubits=8, n_layers=2)
    w = circuits.init_weights(8, 2)
    x = features.for_amplitude_embedding("btc price", 8)
    out = np.asarray(pnp.stack(circuit(w, x)))
    check("circuit returns one score per class", out.shape == (4,),
          f"shape={out.shape}")
    check("scores are expectation values in [-1, 1]",
          out.min() >= -1.0000001 and out.max() <= 1.0000001)

    try:
        circuits.build(n_classes=9, n_qubits=8, n_layers=2)
        check("more classes than qubits is rejected", False, "no error raised")
    except ValueError:
        check("more classes than qubits is rejected", True)

    try:
        circuits.build(n_classes=4, n_qubits=8, embedding="bogus")
        check("unknown embedding is rejected", False, "no error raised")
    except ValueError:
        check("unknown embedding is rejected", True)


def test_circuit_is_trainable():
    """The whole point. A fixed circuit with no parameters cannot learn;
    this one must move its loss when its weights change."""
    circuit = circuits.build(n_classes=4, n_qubits=6, n_layers=1)
    _, texts, y, _ = load_dataset()
    # Every 4th sample, so all four classes are represented -- the dataset is
    # grouped by family, so texts[:16] would be 16 crypto queries and the fit
    # would be trivially solved by predicting one constant.
    pick = np.arange(0, len(texts), 4)
    X = np.array([features.for_amplitude_embedding(texts[i], 6) for i in pick])
    y16 = y[pick]
    check("trainability fixture covers every class", len(set(y16.tolist())) == 4)
    w = circuits.init_weights(6, 1)

    before = float(circuits.cross_entropy(
        circuit, w, pnp.array(X, requires_grad=False),
        pnp.array(np.eye(4)[y16], requires_grad=False)))
    w_trained, history = circuits.train(circuit, w, X, y16, 4, epochs=12,
                                        stepsize=0.2)
    after = history[-1]

    check("training reduces the loss (weights actually matter)", after < before,
          f"{before:.4f} -> {after:.4f}")
    check("weights changed during training",
          not np.allclose(np.asarray(w), np.asarray(w_trained)))

    preds = circuits.predict(circuit, w_trained, X)
    check("predict returns one label per sample", preds.shape == (len(pick),))
    check("predicted labels are valid class indices",
          preds.min() >= 0 and preds.max() < 4)


def test_naive_circuit_is_just_cosine():
    """Regression guard on a documented finding: the 'quantum brain' pattern of
    AngleEmbedding + CNOT + PauliZ, with no trainable weights, is exactly
    cos(theta). Kept executable so nobody re-adds it believing it computes
    something a classical line of trigonometry could not."""
    dev = qml.device("default.qubit", wires=2)

    @qml.qnode(dev)
    def naive(x):
        qml.AngleEmbedding(x, wires=[0, 1], rotation="X")
        qml.CNOT(wires=[0, 1])
        return [qml.expval(qml.PauliZ(0)), qml.expval(qml.PauliZ(1))]

    worst = 0.0
    for u, c in [(0.5, 1.0), (1.0, 2.0), (2.0, 0.3), (3.14, 3.14)]:
        q0, q1 = naive([u, c])
        worst = max(worst, abs(q0 - np.cos(u)), abs(q1 - np.cos(u) * np.cos(c)))
    check("parameterless circuit == closed-form cosine", worst < 1e-12,
          f"max deviation {worst:.2e}")


# ------------------------------------------------------------------- baseline
def test_keyword_baseline():
    check("keyword matcher routes a keyword query",
          keyword_route("what is bitcoin doing") == "crypto")
    check("keyword matcher is case-insensitive",
          keyword_route("BITCOIN price") == "crypto")
    check("keyword matcher returns None on a paraphrase (matches JS null)",
          keyword_route("how are digital currencies trading") is None)
    check("keyword matcher returns None on unrelated text",
          keyword_route("what is the weather") is None)


def test_dataset_and_split():
    families, texts, y, kinds = load_dataset()
    check("dataset loads 4 families", families == ["crypto", "market", "energy", "news"])
    check("labels align with texts", len(texts) == len(y) == len(kinds))
    check("every label is a valid family index", y.min() >= 0 and y.max() == 3)
    check("kinds are only kw/para", set(kinds.tolist()) <= {"kw", "para"})

    counts = {f: int((y == i).sum()) for i, f in enumerate(families)}
    check("classes are balanced", len(set(counts.values())) == 1, str(counts))

    train_mask, test_mask = split(len(texts))
    check("split is a partition", bool((train_mask ^ test_mask).all()))
    check("split is deterministic across calls",
          bool((split(len(texts))[1] == test_mask).all()))
    check("test set is non-empty", test_mask.sum() > 0)


def test_classical_baseline_learns():
    _, texts, y, _ = load_dataset()
    X = np.array([features.for_amplitude_embedding(t, 8) for t in texts])
    model = SoftmaxRegression(256, 4)
    start_acc = (model.predict(X) == y).mean()
    model.fit(X, y, epochs=400, lr=1.0)
    end_acc = (model.predict(X) == y).mean()
    check("classical baseline fits its training data", end_acc > start_acc,
          f"{start_acc:.3f} -> {end_acc:.3f}")
    check("classical baseline reports its parameter count",
          model.n_params == 256 * 4 + 4)


if __name__ == "__main__":
    for fn in [test_features, test_circuit_shape, test_circuit_is_trainable,
               test_naive_circuit_is_just_cosine, test_keyword_baseline,
               test_dataset_and_split, test_classical_baseline_learns]:
        fn()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        sys.exit(1)
    print("all quantum module checks passed")
