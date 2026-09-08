"""Reproduce the numbers in QUANTUM_FEASIBILITY.md.

    python3 -m quantum.benchmark              # full run
    python3 -m quantum.benchmark --quick      # fewer epochs, for a smoke check
    python3 -m quantum.benchmark --scaling    # qubit cost curve only

Accuracy is reported split by query kind, because the aggregate hides the whole
story: the shipped keyword matcher is perfect on queries containing its
keywords and scores zero on paraphrases, so a single average makes it look
mediocre at both.
"""

import argparse
import json
import time

import numpy as np

from . import circuits, features
from .baseline import SoftmaxRegression, keyword_route, load_dataset, split


def measure_scaling(max_qubits=20):
    """Latency and memory against qubit count. Each qubit doubles the state."""
    import tracemalloc

    import pennylane as qml

    rows = []
    for n in [2, 4, 8, 12, 16, 18, 20, 22, 24]:
        if n > max_qubits:
            break
        device = qml.device("default.qubit", wires=n)

        @qml.qnode(device)
        def circuit(x):
            qml.AngleEmbedding(x, wires=range(n), rotation="X")
            for i in range(n - 1):
                qml.CNOT(wires=[i, i + 1])
            return qml.expval(qml.PauliZ(0))

        x = np.random.uniform(0, np.pi, n)
        circuit(x)  # warm up, so we time steady state not first-call setup
        tracemalloc.start()
        started = time.perf_counter()
        circuit(x)
        elapsed_ms = (time.perf_counter() - started) * 1000
        peak_mb = tracemalloc.get_traced_memory()[1] / 1e6
        tracemalloc.stop()
        rows.append({"qubits": n, "statevector": 2 ** n,
                     "latency_ms": elapsed_ms, "peak_mb": peak_mb})
        print(f"{n:7d} {2**n:11d} {elapsed_ms:10.2f}ms {peak_mb:9.1f} MB")
    return rows


def accuracy_by_kind(pred, y, kinds):
    out = {"all": float((pred == y).mean())}
    for kind in ("kw", "para"):
        mask = kinds == kind
        out[kind] = float((pred[mask] == y[mask]).mean()) if mask.any() else float("nan")
    return out


def run(epochs=80, n_qubits=8, n_layers=2, embedding="amplitude"):
    families, texts, y, kinds = load_dataset()
    n_classes = len(families)
    train_mask, test_mask = split(len(texts))
    y_train, y_test = y[train_mask], y[test_mask]
    kinds_test = kinds[test_mask]
    texts_test = [t for t, keep in zip(texts, test_mask) if keep]

    print(f"dataset: {len(texts)} queries, {train_mask.sum()} train / "
          f"{test_mask.sum()} test")
    print(f"  test split: {(kinds_test == 'kw').sum()} keyword-bearing, "
          f"{(kinds_test == 'para').sum()} paraphrase\n")

    results = []

    # -- 1. what ships today -------------------------------------------------
    started = time.perf_counter()
    kw_pred = []
    for text in texts_test:
        routed = keyword_route(text)
        # None means "no match"; score it as a miss, never as a class
        kw_pred.append(families.index(routed) if routed in families else -1)
    kw_latency = (time.perf_counter() - started) / len(texts_test) * 1000
    kw_pred = np.array(kw_pred)
    unmatched = int((kw_pred == -1).sum())
    results.append({"model": "keyword matcher (ships today)",
                    "accuracy": accuracy_by_kind(kw_pred, y_test, kinds_test),
                    "train_s": 0.0, "infer_ms": kw_latency, "params": 0,
                    "unmatched": unmatched})

    # -- 2. classical, identical features ------------------------------------
    n_features = 2 ** n_qubits if embedding == "amplitude" else n_qubits
    featurize = (features.for_amplitude_embedding if embedding == "amplitude"
                 else features.for_angle_embedding)
    X = np.array([featurize(t, n_qubits) for t in texts])
    X_train, X_test = X[train_mask], X[test_mask]

    classical = SoftmaxRegression(n_features, n_classes)
    cl_train_s = classical.fit(X_train, y_train)
    started = time.perf_counter()
    for x in X_test:
        classical.predict(x[None, :])
    cl_latency = (time.perf_counter() - started) / len(X_test) * 1000
    results.append({"model": f"classical softmax ({n_features} feats)",
                    "accuracy": accuracy_by_kind(classical.predict(X_test),
                                                 y_test, kinds_test),
                    "train_s": cl_train_s, "infer_ms": cl_latency,
                    "params": classical.n_params})

    # -- 3. the variational quantum classifier -------------------------------
    circuit = circuits.build(n_classes, n_qubits, n_layers, embedding)
    weights = circuits.init_weights(n_qubits, n_layers)

    def log(epoch, loss, w):
        if epoch % 20 == 0 or epoch == epochs - 1:
            acc = (circuits.predict(circuit, w, X_train) == y_train).mean()
            print(f"    epoch {epoch:3d}  loss {loss:.4f}  train_acc {acc:.3f}")

    print(f"  training VQC: {n_qubits} qubits, {n_layers} layers, "
          f"{int(np.prod(circuits.weight_shape(n_qubits, n_layers)))} params, "
          f"{n_features} features via {embedding} embedding")
    started = time.perf_counter()
    weights, _ = circuits.train(circuit, weights, X_train, y_train, n_classes,
                                epochs=epochs, on_epoch=log)
    q_train_s = time.perf_counter() - started

    started = time.perf_counter()
    for x in X_test:
        circuits.predict(circuit, weights, x[None, :])
    q_latency = (time.perf_counter() - started) / len(X_test) * 1000
    results.append({"model": f"quantum VQC ({n_qubits}q/{n_layers}L, {embedding})",
                    "accuracy": accuracy_by_kind(
                        circuits.predict(circuit, weights, X_test), y_test, kinds_test),
                    "train_s": q_train_s, "infer_ms": q_latency,
                    "params": int(np.prod(circuits.weight_shape(n_qubits, n_layers)))})

    print("\n" + "=" * 96)
    print(f"{'model':<42} {'acc':>7} {'acc(kw)':>9} {'acc(para)':>10} "
          f"{'train s':>9} {'infer ms':>9}")
    print("-" * 96)
    for r in results:
        a = r["accuracy"]
        print(f"{r['model']:<42} {a['all']:7.3f} {a['kw']:9.3f} {a['para']:10.3f} "
              f"{r['train_s']:9.2f} {r['infer_ms']:9.3f}")
    print("=" * 96)
    print(f"\nkeyword matcher failed to match {unmatched}/{test_mask.sum()} "
          f"test queries entirely")
    print(f"quantum inference is {q_latency / max(cl_latency, 1e-9):.0f}x slower "
          f"than classical; training {q_train_s / max(cl_train_s, 1e-9):.0f}x slower")
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true",
                        help="10 epochs instead of 80")
    parser.add_argument("--scaling", action="store_true",
                        help="qubit cost curve only")
    parser.add_argument("--embedding", default="amplitude",
                        choices=["amplitude", "angle"])
    parser.add_argument("--qubits", type=int, default=8)
    parser.add_argument("--layers", type=int, default=2)
    parser.add_argument("--json", help="write results to this path")
    args = parser.parse_args()

    if args.scaling:
        print(f"{'qubits':>7} {'statevector':>11} {'latency':>12} {'peak':>12}")
        print("-" * 46)
        payload = {"scaling": measure_scaling()}
    else:
        epochs = 10 if args.quick else 80
        payload = {"benchmark": run(epochs, args.qubits, args.layers,
                                    args.embedding)}

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(payload, fh, indent=2)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
