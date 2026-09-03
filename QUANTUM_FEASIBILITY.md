# Quantum AI on Jarvis X — Feasibility Study

**Date:** 2026-09-03 · **Verdict:** build it as a research track, keep it out of
the request path · **Reproduce:** `python3 -m quantum.benchmark`

Every number here was measured, not estimated. The measuring code is committed
in `quantum/` so any claim can be re-run and disputed.

---

## 1. Verdict first

| Question | Answer | Evidence |
|---|---|---|
| Can a quantum simulator run locally with no API? | **Yes**, comfortably | §2 — 8 qubits in 9 ms, 0 MB |
| How many qubits fit in a request path? | **~16**, hard ceiling ~20 | §2 — 16q = 32 ms, 20q = 200 ms, 24q = 8.4 s |
| Does the "LLM → circuit → tone" design work? | **No — it computes `cos(θ)`** | §3 — matches closed form to 1.45e-16 |
| Does a *real* trainable VQC beat what ships? | **No.** 0.273 vs 0.500 | §5 |
| Is the blocker qubits, features, or data? | **Data.** 64 queries | §4, §5 |
| Should it go in the request path now? | **No** — 889× slower, less accurate | §5 |
| Is it worth building anyway? | **Yes, as a gated track** | §7 |

---

## 2. The hardware envelope: what a CPU simulator actually costs

Each qubit doubles the state vector, so cost is exponential and the wall
arrives abruptly. Measured with `python3 -m quantum.benchmark --scaling`:

| Qubits | State vector | Latency | Peak memory | Usable where |
|---|---|---|---|---|
| 2 | 4 | 3.9 ms | ~0 MB | anywhere |
| 4 | 16 | 5.7 ms | ~0 MB | anywhere |
| 8 | 256 | 9.3 ms | ~0 MB | **request path** |
| 12 | 4,096 | 14.4 ms | 0.2 MB | **request path** |
| 16 | 65,536 | 31.9 ms | 3.2 MB | **request path, at the edge** |
| 18 | 262,144 | 69.7 ms | 12.6 MB | background only |
| 20 | 1,048,576 | 199.6 ms | 50.4 MB | background only |
| 22 | 4,194,304 | 1,123 ms | 201 MB | batch/offline |
| 24 | 16,777,216 | 8,355 ms | 805 MB | **unusable** |

**Read this as the design constraint.** Between 20 and 24 qubits, latency grows
42× and memory 16×. There is no configuration, threading trick, or optimization
flag that changes the shape of this curve — it is what simulating 2ⁿ amplitudes
costs. Anything targeting the request path must fit in **16 qubits**.

> ⚠️ **Measured in a cloud container** (4 × Xeon @ 2.10 GHz, 15 GB), **not on
> Ahmed's machine.** The *shape* of this curve transfers — it is set by 2ⁿ, not
> by the CPU — but absolute milliseconds do not. The runbook §1.1 hardware
> question is still open; expect the Chromebook to be slower, which tightens the
> ceiling rather than loosening it.

---

## 3. Why the proposed design does not work

The circulating design has an LLM emit two numbers, feeds them as rotation
angles into a 2-qubit circuit, and thresholds the measurement to pick a
response tone. The circuit:

```python
qml.AngleEmbedding(x, wires=[0, 1], rotation='X')
qml.CNOT(wires=[0, 1])
return [qml.expval(qml.PauliZ(0)), qml.expval(qml.PauliZ(1))]
```

It has **no trainable parameters**, so it has a closed form. Measured against
plain trigonometry:

| urgency | complexity | qubit 0 | `cos(u)` | qubit 1 | `cos(u)·cos(c)` |
|---|---|---|---|---|---|
| 0.500 | 1.000 | 0.877583 | 0.877583 | 0.474160 | 0.474160 |
| 1.000 | 2.000 | 0.540302 | 0.540302 | −0.224845 | −0.224845 |
| 2.000 | 0.300 | −0.416147 | −0.416147 | −0.397560 | −0.397560 |
| 3.140 | 3.140 | −0.999999 | −0.999999 | 0.999997 | 0.999997 |

**Maximum deviation: 1.45 × 10⁻¹⁶** — floating-point noise. It also returned
**one distinct result across 200 identical calls**: fully deterministic, no
sampling, no superposition being exploited, nothing an `if` statement could not
do more cheaply.

This finding is pinned as an executable test —
`test_naive_circuit_is_just_cosine` in `quantum/test_quantum.py` — so the
pattern cannot quietly return.

**The fix is trainable parameters.** `quantum/circuits.py` uses
`StronglyEntanglingLayers`, whose weights are optimized by gradient descent.
`test_circuit_is_trainable` asserts the loss actually moves. That is the
difference between a quantum classifier and quantum decoration.

---

## 4. The feature-budget trap, and the way out

`AngleEmbedding` spends **one qubit per feature**. Combined with §2, that caps
you at ~16 features in a request path — hopeless for text, where the seed
dataset alone has a 142-word vocabulary.

Measured: classical softmax regression on hashed bag-of-words, swept across
feature dimensions.

| Dimensions | Test accuracy | Hash collisions (142-word vocab) |
|---|---|---|
| 8 | 0.273 | 134 |
| 16 | 0.227 | 126 |
| 32 | 0.273 | 111 |
| 64 | 0.364 | 88 |
| 128 | **0.409** | 58 |
| 256 | 0.364 | 32 |
| 512 | 0.318 | 19 |

Accuracy climbs to 128 dimensions, then falls — with 42 training samples, more
dimensions start overfitting. Note what this rules out: at 8 dimensions,
**134 of 142 vocabulary words collide**, so the angle-embedding path is not
merely weak, it is destroying the input.

**`AmplitudeEmbedding` answers this**: it packs 2ⁿ features into n qubits, so
8 qubits carry **256** features rather than 8. This is the default in
`quantum/features.py`. The quantum feature budget is therefore *not* the
blocker — which is why §5's result matters.

---

## 5. The head-to-head

Task: route a query to one of 4 data-provider families (crypto / market /
energy / news). Baseline is `resolveQuery()` from
`code/agent-data-integration.js` — **the code that ships today**. Both learned
models consume identical features. 64 queries, 42 train / 22 test.

Accuracy is split by query kind because the aggregate hides the story: `kw`
queries contain a keyword the shipped matcher recognizes, `para` queries are
paraphrases containing none.

| Model | Accuracy | on `kw` | on `para` | Train | Inference | Params |
|---|---|---|---|---|---|---|
| **keyword matcher (ships today)** | **0.500** | **1.000** | 0.000 | — | **0.005 ms** | 0 |
| classical softmax (256 feats) | 0.364 | 0.364 | **0.364** | 0.04 s | 0.012 ms | 1,028 |
| quantum VQC (8q/2L, amplitude) | 0.273 | 0.273 | 0.273 | **142 s** | **10.3 ms** | 48 |

**The quantum classifier loses on every axis at once:** less accurate than a
zero-parameter keyword matcher, **889× slower** per inference than classical
logistic regression, and **3,297× slower** to train.

And the VQC was steel-manned before this conclusion: it got amplitude embedding
(256 features, not 8), backprop gradients rather than parameter-shift (~100×
cheaper), and entangling layers with genuinely trainable weights. It still lost.

### What the split reveals

- The keyword matcher is **perfect on keyword queries and scores zero on
  paraphrases** — it returned `null` on **11 of 11**. Its weakness is real and
  precisely located.
- Both learned models score ~0.27–0.36 *uniformly* across both kinds. They have
  not learned the task; they are close to the 0.25 chance line.
- The VQC reached **0.595 train / 0.273 test** — textbook overfitting on 42
  samples.

**So the binding constraint is training data, not quantum vs classical.** With
64 hand-written queries, no classifier of any kind beats the keyword matcher.
Buying better hardware or adding qubits would not change this result.

---

## 6. What this means for the "best local quantum AI model" goal

Three separate things get conflated under "quantum AI", and they have different
verdicts:

| Interpretation | Verdict |
|---|---|
| **Run QML locally with no API** | ✅ **Done.** PennyLane simulates on CPU, offline, free. §2 is the envelope. |
| **A quantum model that improves Jarvis today** | ❌ **Not supported by the data.** §5. Revisit when the dataset is 100× bigger. |
| **A "quantum LLM" replacing Ollama** | ❌ **Not physically available.** A 1B-parameter model needs ~10⁹ trained parameters; the largest simulable circuits here hold ~48. No hardware, quantum or classical, runs a transformer as a quantum circuit today. |

On `NeuroEquality/neuralquantum-coder`: the model **does exist** on Ollama. But
its published description is a generic coding assistant — "clear, actionable,
technically accurate solutions… performance, security, and best practices" —
with no published parameter count or base model, reading like a `SYSTEM` prompt
wrapper. Nothing found supports the claim that it reasons about quantum
structures; "NeuralQuantum" is the vendor's brand. Treat as **unverified**: the
model card could not be read directly from this environment (egress to
ollama.com and huggingface.co is blocked).

This also does not change the runbook §4 verdict on local *coding* models. That
conclusion was about RAM and tokens/sec for 7B–14B models, and none of the
measurements here touch it.

---

## 7. Recommendation: build it, gate it, let data promote it

Not "don't build this." The module is committed and working. But it earns the
request path by measurement, not by intent.

**Ship now (done):**
- `quantum/` with a real trainable VQC, both baselines, and the benchmark
- 31 correctness checks, no accuracy assertions
- PennyLane isolated to `quantum/requirements.txt`; nothing on the serving path
  imports it
- `cos(θ)` finding pinned as an executable regression test

**Promotion gate — all four, or it stays out:**
1. Dataset ≥ 500 real queries from `logs/queue.jsonl`, not hand-written
2. VQC test accuracy **beats the keyword matcher** on the same split
3. VQC **beats classical softmax** on identical features — otherwise use the
   classical model, which is 889× cheaper
4. p95 inference **< 50 ms** on Ahmed's actual hardware, not a cloud container

Gate 3 is the one that matters. If quantum and classical tie, the answer is
classical: same accuracy, a fraction of the cost.

**Do not** pursue: circuits > 16 qubits for anything user-facing (§2), a
parameterless circuit in a decision path (§3), or `AngleEmbedding` for text
(§4).

---

## 8. Known limits of this study

Stated plainly, so nothing here is over-read:

- **The dataset is 64 hand-written queries.** It is a seed, not a benchmark. A
  larger, real-traffic dataset could change §5 — that is exactly what gate 1
  tests.
- **Hardware numbers come from a cloud container**, not the target machine (§2).
- **One circuit architecture tested** (`StronglyEntanglingLayers`, 1–2 layers,
  8 qubits). Other ansätze exist; none was tried.
- **One task tested** (4-way intent routing). QAOA-style optimization for
  `scheduler.js` was *not* measured — though note §2 caps it at ~16 items, a
  size classical exact solving handles trivially.
- **Simulation only.** No real quantum hardware, which needs the cloud APIs this
  design explicitly avoids.
- **Not measured:** accuracy at the 11-key granularity `resolveQuery` actually
  returns; only the 4-family collapse was tested.

---

*Method follows `AS_BUILT.md`: every claim cites a command, and anything
unverified is labelled unverified rather than estimated.*
