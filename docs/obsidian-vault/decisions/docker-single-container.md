---
title: Docker — single container, not two services
date: 2026-08-17
status: decided
---

# Decision: one container, not two compose services

**Question:** the deployment plan specified `docker-compose.yml` with two services (a `jarvis-x` app service + a separate `ollama` service) — the common, idiomatic pattern.

**Decision: one container, running Ollama + `hermes-api` together via `supervisord`** (mirroring `config/supervisord.conf`'s real bare-metal setup), not two separate services.

**Why:** `code/local.js`, `code/vision.js`, and `hermes.py` all call Ollama at a hardcoded `127.0.0.1:11434`/`localhost:11434` — no `OLLAMA_HOST` environment override exists anywhere in this code. In a two-service split, the app container's `localhost` would never reach a sibling `ollama` container (container networking requires the service's hostname, e.g. `http://ollama:11434`). Fixing that would mean modifying production files, including `hermes.py`, against this project's "preserve existing code, extend don't refactor" rule — for a Docker-only convenience, not a real bug.

**Trade-off accepted:** a single, large image (~12-15GB — Ollama's model store alone is ~8.6GB, plus `bootstrap/requirements-venv-ai.txt`'s ~3.8GB CPU torch/transformers/spaCy/Coqui stack). This is inherent to a local-first AI stack, not a packaging shortcut.

**Not tested end-to-end:** the actual `docker-compose up`/build was **not run** on the development machine — disk was at 8.5GB free at the time, and a real build of this size risked exhausting disk on a live, in-use system (the same machine `ollama`/`hermes-api` run on daily). Validated instead: `docker-compose.yml`'s YAML and compose-schema correctness (`docker-compose config`, with the real, expected failure being the not-yet-created `~/.jarvis-x/.env`), and a careful manual Dockerfile re-review that caught two real bugs before they'd have surfaced in a build (see `git log` for the commit that added these files — full detail in the commit message). Test the actual build on a machine with real headroom before relying on it.

**Future path, if true service separation is ever wanted:** add an `OLLAMA_HOST` env var read in `code/local.js`/`code/vision.js`/`hermes.py`, defaulting to `127.0.0.1:11434` to preserve bare-metal behavior — a small, explicit, separately-reviewable change.
