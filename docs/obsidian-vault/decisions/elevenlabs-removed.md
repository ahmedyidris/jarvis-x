---
title: ElevenLabs removed for Egyptian Arabic
date: 2026-08-16
status: decided — implemented
---

# Decision: drop ElevenLabs, keep EGTTS-V0.1 as the sole Egyptian Arabic voice

**Context:** `code/tts_engine.py` had an `ar_eg_elevenlabs` voice that was actually a Bella (English) voice standing in — a real Egyptian voice was identified but blocked by ElevenLabs' free-tier "no library voices via API" restriction, pending a plan upgrade that never happened.

**Decision:** explicit call — stick with the local `EGTTS-V0.1` voice-cloned model as the only Egyptian Arabic option, drop ElevenLabs entirely rather than wait on an account upgrade.

**Removed:** the `ar_eg_elevenlabs` voice entry, `_synthesize_elevenlabs()`, key-loading logic, now-unused `io`/`wave` imports. Bootstrap docs (`bootstrap/env.template`, `install.sh`, `README.md`) also had stale references to this cleaned up in a follow-up pass.

See [[letters]]/[[economic-facts]]/[[commodities-macro]]/[[geopolitical-risk]] for which voice each Phase B vertical actually uses (`en_us_piper` for letters, `en_us_kokoro` for the rest) — none of them ever used the Egyptian voice, so this had zero effect on Phase B.
