# Jarvis X — Status

Regenerate the numbers, don't trust them: `bash scripts/status.sh`,
`npm test`, `bash scripts/verify/run-all.sh`.

Last verified: 2026-08-24

## Corrections to JARVIS_X_CONTEXT_HANDOFF (2026-08-19)

That handoff's status table is stale. Five entries were wrong as of
2026-08-24, all verified by running the thing rather than reading about it:

| Handoff claimed | Actual |
|---|---|
| Electron ~20%, "build never tested" | Builds AppImage + .deb, installs, launcher registered, autostart verified from the packaged binary with the backend stopped |
| E2E tests "0% — do not exist" | `scripts/verify/03_e2e_flow_test.py` passes end-to-end: query → agent decision → content → TTS → video with audio track → API readback. 65s |
| Content verticals ~40%, "output never verified" | All 4 generate; 25+ content files on disk with rendered video |
| Agent accuracy 77% (24/31 graded) | That number was a hand-count over a log nothing had written to since the pre-`type` agent — unreproducible, not merely stale. `code/eval-agent.js` measures it on demand: 15/15, stable across 3 runs, 6/6 on held-out goals |
| status.sh ~65/67 | 100/1. The one failure is the self-debug loop, deliberately unbuilt |

## Two long-running misdiagnoses, both resolved

- **"Recurring orphaned root uvicorn/ollama pair"** (chased across 3
  sessions, killed repeatedly, always returned): it was this project's own
  Docker container, `restart=unless-stopped`, working exactly as configured.
  Two full stacks meant two `ollama serve` daemons competing for 8 vCPUs --
  the real cause of both the measured latency variance and the E2E test's
  120s Ollama timeout. `docker stop` took load from 2.23 to 0.04.
- **"Gemini judge has a 5/5 false-positive rate"**: the acceptance fixture
  was never verified, only assumed clean. It contained two real factual
  errors that had shipped. Every model that flagged it was correct. Fixed
  both; the same judge returns 0/5.

Both share a shape: something working correctly was diagnosed as broken on
an unverified assumption. Verify the fixture before it disqualifies anything.

## Open

- Semantic judge: GO for deliberate review, not automatic gating.
  Nondeterministic recall (3/5 on one real defect, hence any-flag voting at
  `votes=3`) and a hard free-tier cap of 20 Gemini calls/day/model.
- Self-debug loop: still do not build. 15/15 is not boring yet -- 15 cases,
  one model, eval and few-shot written in the same sitting.
- Repo is public. The handoff flags this as a patent concern; unresolved.
