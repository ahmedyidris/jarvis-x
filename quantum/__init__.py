"""Quantum machine-learning experiment track for Jarvis X.

NOT wired into the request path, deliberately. ``QUANTUM_FEASIBILITY.md`` has
the measurements: on this hardware the VQC is ~850x slower per inference than
classical logistic regression on identical features, and loses to the keyword
matcher already in ``code/agent-data-integration.js``. Importing this package
pulls in PennyLane, so nothing on the serving path should import it.

Run the benchmark to reproduce those numbers:

    pip install -r quantum/requirements.txt
    python3 -m quantum.benchmark
"""

__all__ = ["baseline", "circuits", "features"]
