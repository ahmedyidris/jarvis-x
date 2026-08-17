---
title: /api/ask kill-switch gating
date: 2026-08-16
status: decided (gate it) — implemented
---

# Decision: `/api/ask` checks the kill switch

**Question:** `app.py`'s `/api/ask` could be called directly while `.jarvis-x-STOP` was set, bypassing the kill switch entirely — only `/api/killswitch` read/wrote the flag. Should chat be gated too, or is it out of scope (a person is directly in the loop reading the answer, unlike an unattended action)?

**Decision: gate it.** `CONSTITUTION.md`'s kill-switch guarantee ("Jarvis halts... all running processes exit cleanly") carves out no exception for chat, and a kill switch with a silent exception undermines the "one tap, everything stops" property the whole mechanism exists for.

**Implementation:** `/api/ask` now checks `STOP_FILE.exists()` at the top of the handler, returns `503` if set.

**Verified live** (not just diffed): baseline `/api/ask` → `200` real answer; set the switch → `503`; clear it → `200` again. Full round-trip.

See [[system-overview]] for where this sits in the wider kill-switch mechanism, and `../../../docs/architecture.md`'s kill-switch section for the fuller writeup.
