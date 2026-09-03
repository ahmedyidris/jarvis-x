---
title: Egyptian Arabic voice — Chatterbox clone verified working
date: 2026-08-31
status: verified, partially wired (quality tier only)
---

# Egyptian Arabic TTS: Chatterbox voice clone, not EGTTS-V0.1

**Timeline, because three different findings about Egyptian Arabic TTS exist
across this repo's docs and none of them fully supersede the others on their
own — read this page instead of trusting any single older doc in isolation:**

1. `EGTTS_RESEARCH.md` (repo root, 2026-08-13 or earlier): `OmarSamir/EGTTS-V0.1`
   (XTTS-v2 based) needs CUDA, ruled not viable on this CPU-only Crostini box.
2. A later 2026-08-13 finding (see `CONTEXT.md`-adjacent project memory, not
   this vault): reported EGTTS-V0.1 later got working locally on CPU after
   further commits — never independently re-verified in this vault.
3. **2026-08-31, this decision:** a *different* model — `chatterbox-tts`
   (checkpoint `voices/chatterbox-eg` + a reference clip `voices/ahmed/ref.wav`)
   — is what `code/tts_worker.py` actually runs today, as its own dedicated
   service on port 8001 (the `tts-worker` supervisord program — see
   [[system-overview]]). Not EGTTS-V0.1 at all.

**Verified directly (2026-08-31):** started `tts_worker.py` manually, ~32s
model load, produced a valid WAV with real cloned speech from a direct test.
Then confirmed the full `/api/ask` pipeline actually reaches it end to end —
important because **the JSON response's `voice` field is misleading**: it
echoes the tier's *nominal configured* voice (e.g. `en_us_kokoro` for
`"quality"`) regardless of which engine actually ran. The real signal is the
tts-worker process's own log line (`[tts_worker] N chars in Ts`), which only
appears when the Chatterbox clone path genuinely fired.

## The gap: works on `quality`, not on `local`

- `"quality"` tier (`qwen2.5:7b`/`SILMA-9B`) produces clean Arabic script →
  `_is_arabic()` correctly routes to Chatterbox → real ~74s synthesis
  confirmed, character count matched.
- `"local"` tier (`qwen2.5:3b`) keeps mixing Arabizi/Latin script into
  replies despite the Egyptian-Arabic system prompt → `_is_arabic()`
  correctly *skips* the clone path every time tried, since the text isn't
  actually Arabic script.

This is a **model-behavior gap** (qwen2.5:3b not reliably staying in Arabic
script), not a wiring bug in `tts_worker.py` or `_is_arabic()`.

## Stale docs this supersedes (flagged, not silently overwritten)

- `memory/rules.md` (repo root, Edit-denied, human-authoritative) states
  *"Egyptian Arabic TTS does NOT work and is not installed"* as of
  2026-08-24. That was accurate on that date; it is no longer accurate as
  of the Chatterbox work above. Cannot be edited by an AI session — flagged
  here for Ahmed to update by hand, same treatment `docs/architecture.md`
  already gives `knowledge/Guidelines.md`'s stale kill-switch path.
- `EGTTS_RESEARCH.md`'s own conclusion (EGTTS-V0.1 specifically, CPU-nonviable)
  is not contradicted by this decision — Chatterbox is a different model
  that was adopted instead, not evidence EGTTS-V0.1 became viable.

## Open, not yet checked in this vault

Which service is *actually* live right now (`tts-worker` under supervisord,
vs. a manually-started ad hoc process) was last confirmed 2026-08-31 night —
worth a fresh `supervisorctl -c config/supervisord.conf status` before
trusting this page's "currently running" framing on any later date.
