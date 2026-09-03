"""Variational quantum classifier for intent routing.

This is a real VQC: ``StronglyEntanglingLayers`` holds trainable weights that
are optimized by gradient descent, and the class scores come from measuring
distinct qubits. It is NOT the pattern where an LLM's output is piped through a
fixed circuit and read back -- that shape has a closed form (a bare
``AngleEmbedding`` + ``CNOT`` + ``PauliZ`` reduces to ``cos(theta)``) and cannot
learn anything, because it has no parameters to learn with.

``diff_method="backprop"`` matters: the parameter-shift rule costs two circuit
evaluations per parameter per step, which for 48 parameters is ~100x more work
per gradient. Backprop through the simulator is exact here and far cheaper.
"""

import numpy as np
import pennylane as qml
from pennylane import numpy as pnp

DEFAULT_QUBITS = 8
DEFAULT_LAYERS = 2
# Expectation values live in [-1, 1]; softmax over that range is nearly flat, so
# scores are scaled before the loss to let classes actually separate.
LOGIT_SCALE = 3.0


def weight_shape(n_qubits=DEFAULT_QUBITS, n_layers=DEFAULT_LAYERS):
    return qml.StronglyEntanglingLayers.shape(n_layers=n_layers, n_wires=n_qubits)


def init_weights(n_qubits=DEFAULT_QUBITS, n_layers=DEFAULT_LAYERS, seed=7):
    rng = np.random.default_rng(seed)
    shape = weight_shape(n_qubits, n_layers)
    return pnp.array(rng.normal(0, 0.3, shape), requires_grad=True)


def build(n_classes, n_qubits=DEFAULT_QUBITS, n_layers=DEFAULT_LAYERS,
          embedding="amplitude"):
    """Return a QNode mapping (weights, features) -> one score per class.

    ``embedding`` is "amplitude" (2**n features, recommended) or "angle"
    (n features, dimension-starved -- kept so the benchmark can show the gap).
    """
    if n_classes > n_qubits:
        raise ValueError(
            f"need at least one readout qubit per class: "
            f"{n_classes} classes > {n_qubits} qubits")
    if embedding not in ("amplitude", "angle"):
        raise ValueError(f"unknown embedding: {embedding!r}")

    device = qml.device("default.qubit", wires=n_qubits)

    @qml.qnode(device, diff_method="backprop")
    def circuit(weights, features):
        if embedding == "amplitude":
            qml.AmplitudeEmbedding(features, wires=range(n_qubits), normalize=True)
        else:
            qml.AngleEmbedding(features, wires=range(n_qubits), rotation="X")
        qml.StronglyEntanglingLayers(weights, wires=range(n_qubits))
        return [qml.expval(qml.PauliZ(i)) for i in range(n_classes)]

    return circuit


def scores(circuit, weights, X):
    """Class scores for a batch, as a differentiable stacked array."""
    return pnp.stack([pnp.stack(circuit(weights, x)) for x in X])


def cross_entropy(circuit, weights, X, y_onehot):
    logits = scores(circuit, weights, X) * LOGIT_SCALE
    shifted = logits - pnp.max(logits, axis=1, keepdims=True)
    log_prob = shifted - pnp.log(pnp.sum(pnp.exp(shifted), axis=1, keepdims=True))
    return -pnp.mean(pnp.sum(y_onehot * log_prob, axis=1))


def train(circuit, weights, X, y, n_classes, epochs=80, stepsize=0.1,
          on_epoch=None):
    y_onehot = pnp.array(np.eye(n_classes)[y], requires_grad=False)
    X_fixed = pnp.array(np.asarray(X), requires_grad=False)
    optimizer = qml.AdamOptimizer(stepsize=stepsize)
    history = []
    for epoch in range(epochs):
        weights, loss = optimizer.step_and_cost(
            lambda w: cross_entropy(circuit, w, X_fixed, y_onehot), weights)
        history.append(float(loss))
        if on_epoch is not None:
            on_epoch(epoch, float(loss), weights)
    return weights, history


def predict(circuit, weights, X):
    return np.asarray(scores(circuit, weights, X)).argmax(axis=1)
