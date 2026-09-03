---
title: Ollama signing-key permission bug — fixed
date: 2026-08-31
status: resolved
---

# Ollama pull/rm failures traced to signing-key ownership

**Symptom:** the system-level `ollama serve` (running as the `ollama`
service account, bound to :11434) refused every `ollama pull` with
"permission denied." Later found to be bidirectional: `ollama rm
qwen2.5-3b-64k` also failed permission-denied, even though the target
manifest file was owned by `ahmedyidris` (644, readable/writable by that
user) — the daemon runs as a *different* user and couldn't touch
`ahmedyidris`-owned files either, the mirror image of the pull failure.

**Root cause:** `/usr/share/ollama/.ollama/id_ed25519` (the daemon's own
signing key) was owned by `ahmedyidris` (mode 600, owner-only) instead of
`ollama`. Every pull needs to sign a manifest with this key; every caller,
not just one specific tool, was blocked.

**Fix:** `sudo chown -R ollama:ollama /usr/share/ollama/.ollama/` — a
system-account change, left for Ahmed to run rather than done unattended by
an AI session (this session's sandboxed non-interactive `sudo -n` was
correctly denied by the Claude Code permission classifier either way).

**Verified both directions after the fix:** `ollama rm qwen2.5-3b-64k`
succeeded; `ollama pull phi3.5` completed for real (2.2GB, watched to 100%,
no signing-key error).

## Why this mattered beyond disk cleanup

`qwen2.5-3b-64k` was a custom Ollama model (a `Modelfile` `num_ctx` bump)
built to satisfy [[hermes-agent-integration]]'s ">=64K context" requirement
— confirmed dead end (`~/.hermes/context_length_cache.yaml` never showed it
exceeding 32768 regardless of the Modelfile setting). `phi3.5` (128K native
context) is the model that actually satisfies the requirement, and this fix
is what unblocked pulling it.

## Before deleting other models, checked real code references first

`moondream` is live-wired in `code/vision.js`; `hf.co/bartowski/SILMA-9B-
Instruct-v1.0-GGUF:Q4_K_M` is `code/router.py`'s actual `"quality"`-tier
model — neither was a leftover. Only `deepseek-coder` and `tinyllama` had
zero references anywhere in this repo's own code; those two were removed
(~1.4GB). Lesson for future cleanup passes on this box: grep the codebase
before removing any Ollama model, not just check `ollama list`.
