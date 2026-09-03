# `quantum/` — QML experiment track

A real variational quantum classifier for Jarvis's intent routing, plus the two
baselines it has to beat, plus the harness that measures all three.

**This is not wired into the request path, and the measurements are why.** See
[`../QUANTUM_FEASIBILITY.md`](../QUANTUM_FEASIBILITY.md) for the full study.

## Setup

```bash
python3 -m venv quantum/.venv
source quantum/.venv/bin/activate
pip install -r quantum/requirements.txt
```

PennyLane is deliberately absent from the root `package.json` and from
`bootstrap/`: nothing on the serving path imports this package, and it drags in
autograd and scipy.

## Run

```bash
python3 quantum/test_quantum.py           # 31 correctness checks, ~40s
python3 -m quantum.benchmark              # full head-to-head, ~2.5 min
python3 -m quantum.benchmark --quick      # 10 epochs, smoke check
python3 -m quantum.benchmark --scaling    # qubit cost curve only
python3 -m quantum.benchmark --embedding angle   # the dimension-starved variant
```

## What's here

| File | Purpose |
|---|---|
| `circuits.py` | The VQC. `StronglyEntanglingLayers` with trainable weights, `diff_method="backprop"`. |
| `features.py` | Text → features. Both embeddings. Both models consume this unchanged. |
| `baseline.py` | The keyword matcher ported from `code/agent-data-integration.js`, and numpy softmax regression. |
| `benchmark.py` | The harness. Reproduces every number in the feasibility study. |
| `test_quantum.py` | Fast correctness checks. No training, no accuracy assertions. |
| `data/intents.json` | 64-query seed dataset. Far too small — that is itself a finding. |

## Two things to know before extending this

**1. The parameterless "quantum brain" pattern is just `cos(θ)`.** A bare
`AngleEmbedding` + `CNOT` + `PauliZ` with no trainable weights has a closed
form. `test_naive_circuit_is_just_cosine` asserts this to 1e-12 and exists so
nobody re-adds that shape believing it computes something classical
trigonometry cannot. Any circuit here needs trainable parameters to be doing
work.

**2. Qubits are exponentially expensive, so the qubit budget is a feature
budget — unless you use amplitude embedding.** `AngleEmbedding` spends one
qubit per feature, which starves the model at the 8–16 features a CPU
simulator can afford. `AmplitudeEmbedding` packs 2ⁿ features into n qubits
(8 qubits → 256 features) and is the default here for that reason.

## The honest state of it

On the seed dataset the VQC scores **0.273** against the keyword matcher's
**0.500**, while costing **889×** more per inference and **3297×** more to
train. It is not ready for the request path, and the binding constraint is
training data (64 queries), not qubits and not the classifier.

The next task is not a better circuit. It is a bigger dataset, drawn from real
`logs/queue.jsonl` traffic. Re-run the benchmark after that and let it decide.
