"""Text -> fixed-width numeric features.

Both the quantum and the classical models consume the output of this module,
unchanged. That is deliberate: a benchmark where the two models see different
features measures the featurizer, not the models.

The hash is written out longhand rather than using Python's ``hash()``, which is
salted per process -- the same query must featurize identically across runs or
a trained model is worthless on reload.
"""

import numpy as np

_HASH_MULT = 131
_HASH_MOD = 1_000_003


def tokenize(query):
    cleaned = query.lower().replace("?", " ").replace(",", " ").replace(".", " ")
    return [t for t in cleaned.split() if t]


def stable_hash(token):
    h = 0
    for ch in token:
        h = (h * _HASH_MULT + ord(ch)) % _HASH_MOD
    return h


def bag_of_words(query, n_features):
    """Hashed bag-of-words, unnormalized counts."""
    v = np.zeros(n_features, dtype=float)
    for token in tokenize(query):
        v[stable_hash(token) % n_features] += 1.0
    return v


def for_angle_embedding(query, n_qubits):
    """One feature per qubit, scaled to [0, pi] as rotation angles.

    AngleEmbedding spends a whole qubit per feature, and every qubit doubles
    simulation cost -- so this path is dimension-starved by construction. See
    ``for_amplitude_embedding`` for the alternative.
    """
    v = bag_of_words(query, n_qubits)
    total = v.sum()
    if total > 0:
        v = v / total
    return v * np.pi


def for_amplitude_embedding(query, n_qubits):
    """2**n_qubits features packed into n_qubits, unit-normalized.

    Amplitude embedding answers the dimension-starvation problem: 8 qubits
    carry 256 features instead of 8. Unit norm is required -- a state vector
    whose amplitudes do not square-sum to 1 is not a valid quantum state.
    """
    v = bag_of_words(query, 2 ** n_qubits)
    norm = np.linalg.norm(v)
    if norm == 0:
        # An empty/unknown query would be an invalid state vector. Fall back to
        # a uniform superposition, which is valid and carries no class signal.
        return np.full(2 ** n_qubits, 1.0 / np.sqrt(2 ** n_qubits))
    return v / norm
