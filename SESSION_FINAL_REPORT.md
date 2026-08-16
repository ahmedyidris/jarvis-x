# Jarvis X — Session Final Report
*2026-08-16*

## Architecture summary (1 page)

Jarvis X is three separate systems sharing one repo, one kill-switch file, and (for two of the three) a local Ollama instance:

1. **Web chat** (`app.py` + `web/`) — 100% local (Ollama `qwen2.5:3b`/`7b` via `code/router.py`), voice in/out (`code/stt_engine.py`, `code/tts_engine.py`), served under `supervisord`.
2. **JS agent-autonomy loop** (`code/agent.js` + `code/scheduler.js`) — proposes one action at a time, structurally validated (`code/validate.js`), kill-switch-gated (`code/guard.js`), executed through a jailed/allowlisted engine (`code/exec.js`/`code/shell.js`/`code/lib.js`), tier-routed to Gemini with a human-approval gate on consequential actions (`code/router.js`/`code/gemini.js`).
3. **Phase B** (`automation/phase-b/`) — batch video generation, four verticals (`letters`, `economic_facts`, `commodities_macro`, `geopolitical_risk`), three of them built on real WebSearch-sourced facts the LLM only narrates around, never invents.

Not part of Jarvis X: `sentinel/` (separate incident-response portfolio project — verified this session to genuinely work end-to-end against live Ollama, not just import cleanly), `automation/n8n/`.

Built, tested, deliberately **not** wired in: `packages/model-gateway` + `code/gateway-adapter.js`. See `DECISION_RECORD_model-gateway.md`.

Full detail: `docs/architecture.md`. Development workflow: `docs/DEVELOPMENT.md`.

## What was done this session

Chronological, one line per commit (`8a73dab..HEAD`, all pushed to `origin/master`):

| Commit | What |
|---|---|
| `5079aab` | **Security.** Kill switch now checked by every action type in `agent.js`'s path (previously unchecked); shell actions routed through the existing allowlist instead of raw `child_process.exec`; a deeper symlink-jail bug found and fixed in `exec.js` itself while fixing this; `scheduler.js`'s validation gate fixed (was silently rejecting 100% of proposals, then not even awaiting execution); opt-in shared-secret API auth added to `app.py`/`sentinel` (off by default). |
| `b03cf5b` | **Dependencies.** `automation/n8n` bumped in-range (148→~147 known vulnerabilities in its unused, not-installed lockfile — no in-range fix clears the rest); `web/`'s `shadcn` patched; `sentinel/requirements.lock.txt` added (fully pinned, pip-audit clean). |
| `1c8d7f1` | **Cleanup.** 3 verified-dead files deleted; Sentinel agent helpers deduplicated; 3 stale `scripts/status.sh` safety checks fixed (including one reading the wrong kill-switch path entirely). |
| `69e3176` | Added `icm-architect` skill (vetted: 904★, MIT, Socket/Snyk clean) — turned out to be the origin of the ICM pattern `automation/phase-b/` already uses. |
| `1eacdae` | `CONSTITUTION.md`'s kill-switch path corrected (self-amendment-gated file — done on your explicit sign-off, not unilaterally). |
| `132964a` | **Phase B Week 3** — `commodities_macro` vertical, 7 real facts (5 commodities + 2 macro releases), verified end-to-end including a rendered+`ffprobe`-checked video. |
| `397ea77` | `paper-trading.js`'s `getPortfolioStats()` fixed — previously always computed `pnl = 0` regardless of market movement (same value added then subtracted). |
| `ee1e7a9` | ElevenLabs support removed from `code/tts_engine.py` (explicit decision — EGTTS-V0.1 is now the sole Egyptian Arabic voice). |
| `e925670` | `test-helper.js`'s async-test bug fixed — found while tracing a divergent branch's history; a real, latent (not yet triggered) leaked-kill-switch-file risk. |
| `b964214` | **Phase 1 audit.** `REMAINING_WORK.md` backlog + `DECISION_RECORD_model-gateway.md`, built from cross-referencing every doc against actual filesystem/git state (zero TODO/FIXME markers exist anywhere). |
| `612afe9` | **Phase B Week 4** — `geopolitical_risk` vertical, 5 flashpoints. Found and hand-corrected 2 fabricated numbers in LLM output during verification — a real gap in the shared pattern's validation, documented, not silently shipped. |
| `4f9ec91` | Stale kill-switch path fixed in `Design.md` (Phase 3). |
| `8c99f4e` | Stale ElevenLabs/`models.js` references removed from `bootstrap/` (3 leftover mentions of things deleted earlier this session). |
| `e8f9640` | `app.py`'s `/api/status` fixed — was computing `hermes.status()`'s real conversation count and discarding it; verified live via a `supervisorctl` restart. |
| `59c7b03` | **Phase 6 docs.** `docs/architecture.md` (new), `docs/DEVELOPMENT.md` (new), `README.md` rewritten — was a Week-1 snapshot describing a deleted file as the live router and omitting most of the actual current system. |

**Verification performed, not just claimed:** kill switch live-tested (`guard()` throws, `scheduler.js` halts before any LLM call); `sentinel`'s full pipeline run end-to-end against live local Ollama (not just import-checked) — correctly triaged a real incident, correctly ranked the right runbook first; frontend build clean; `git fsck` clean; full JS suite 11/11 on a clean run (63-65/67 under `status.sh`'s heavier concurrent load — see Known Issues); model-gateway package suite 47/47.

## What remains — next 3 months, roughly prioritized

1. **`app.py`'s `/api/ask` doesn't check the kill switch** (only `/api/killswitch` does) — a real product decision (should web chat count as "autonomous action"?), not a bug fix. Needs your call.
2. **Phase B's numeric-fidelity gap** — the shared generator pattern has no automated check that LLM-scripted narration stays faithful to its source fact's numbers. Found twice in `geopolitical_risk`'s first batch; fixed by hand both times. Worth either an automated second-pass checker or a standing manual-review step before every new batch ships.
3. **Self-debug loop** — deliberately deferred, not forgotten. `NOTES.md`'s own stated condition ("revisit when the accuracy number is boring") isn't met yet — still 77% (24/31). Don't build until that changes.
4. **`packages/model-gateway` wiring** — a real, separable future decision (not now) for whenever this project needs multi-provider cost budgeting/circuit-breaking at scale. Start from `dccd5e2`'s 12 fixes if revisited (still readable via `git show`, even with the branch deleted).
5. **Major dependency bumps flagged, not applied**, per this session's own conservative-default rule: `dotenv` (16→17), `better-sqlite3` (11→12, needs a native rebuild), `web/`'s `@types/node`/`typescript` (both major-behind, types-only/build-tooling so lower risk).
6. Minor, low-priority: `bootstrap/requirements-venv-ai.txt` still lists an unused `elevenlabs` pip pin (harmless, a frozen-snapshot file, not worth curating); `code/local.js`/`vision.js`/`gemini.js`'s `fetch()` calls have no timeout (a hang-risk resilience gap, not a known incident).

## Known issues (severity + workaround)

| Issue | Severity | Workaround |
|---|---|---|
| `/api/ask` not kill-switch-gated | Medium (product decision, not a bug) | See "what remains" #1. |
| Phase B numeric-fidelity gap | Medium | Manually read every generated JSON against its source fact before shipping a new batch — see `docs/DEVELOPMENT.md` step 5. |
| `test-voice.js`/`test-voice-interaction.js` intermittently fail under system load | Low (test flakiness, not a code bug) | These invoke real Piper/Kokoro subprocess synthesis — timing-sensitive. Confirmed this session: `test-voice.js` failed once under `status.sh`'s full concurrent load, passed cleanly (3/3) run standalone moments later with no code change in between. Re-run in isolation before treating a failure here as a regression. |
| `~/.jarvis-x/` owned by a separate `jarvis` system user, `700` | Low (by design) | `sudo -u jarvis <cmd>`, with `HOME=/home/ahmedyidris` set explicitly (see `docs/DEVELOPMENT.md`). |
| `automation/n8n`'s lockfile still carries real CVEs in transitive deps | Low (not installed/running) | No published n8n version fully clears them yet; re-check `npm audit` next time n8n is actually deployed, before installing for real. |

## How to deploy/run (fresh user)

```bash
git clone https://github.com/ahmedyidris/jarvis-x.git && cd jarvis-x
bash bootstrap/install.sh
```

Then, per `bootstrap/install.sh`'s own printed next-steps: fill in `~/.jarvis-x/.env` from `bootstrap/env.template` by hand (never committed/backed up on purpose), and verify with `supervisorctl -c config/supervisord.conf status` (`ollama` + `hermes-api` both `RUNNING`) and `curl -s localhost:8000/api/killswitch` (should return JSON). See `README.md` for day-to-day usage and `bootstrap/README.md` for exactly what the installer does and does not restore.

## A note on process, for anyone reading this later

This session was run under an autonomous, phase-gated instruction set. Several of that instruction set's own stated assumptions/defaults did not match the actual repo and were corrected rather than followed blindly, each documented at the point it happened:
- Phase 3's default ("wire in model-gateway: YES") was overridden to NO-GO, using the instructions' own authorized alternative ("document why in a decision record"), after re-verifying the reasoning that led to it being excluded in the first place still held.
- Phase 3's premise that `code/router.py` might be dead code was wrong — it's the live production routing file for the actual web-chat path.
- Phase 1's "TODO is fair game" default did not override `NOTES.md`'s explicit, reasoned deferral of the self-debug loop.
- Every "fix" was verified against the running system (a live kill-switch test, a live API restart + curl, a real end-to-end sentinel run against local Ollama, an `ffprobe` check on a rendered video) rather than trusted on the strength of the diff alone.
