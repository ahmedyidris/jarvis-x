# The Station tab

A **Station** tab in Jarvis's web UI. It is the handoff's Priority 3, built on
2026-09-25/26 instead of a StarNet clone. Each agent in `config/agents.yaml`
gets:

- a card on a grid;
- its own transcript;
- a box to talk to it or queue a task;
- one background worker.

Agents **write text only**. They cannot run tools, a shell, files or the web
(the handoff: "Do not run YOLO-mode agents on this machine").

## What is in it

| Piece | File |
|---|---|
| Roster: Raqib plus three roles adapted from StarNet (MIT, credited in the file) | `config/agents.yaml` |
| Roster loader, strict: unknown keys, bad tiers, duplicate or unsafe ids all refuse to start | `code/station/roster.py` |
| Transcript and task log per agent, append-only JSONL under `logs/station/<id>/` | `code/station/store.py` |
| One worker thread per agent; the kill switch is checked before every model call | `code/station/worker.py` |
| HTTP routes behind app.py's `require_token` | `code/station/api.py` |
| One-call mount for app.py | `code/station/__init__.py` |
| The tab | `web/src/components/dashboard/Station.tsx`, `web/src/lib/station-api.ts` |
| Tests: 64, offline, in CI | `code/station/test_station.py` |

### Routes

| Method | Path | Does |
|---|---|---|
| GET | `/api/station/agents` | roster with live status (idle or working, queued count), plus the kill switch |
| POST | `/api/station/agents/{id}/chat` | `{"message": ...}`: waits for the answer |
| GET | `/api/station/agents/{id}/transcript?limit=50` | what was said, oldest first |
| POST | `/api/station/agents/{id}/task` | `{"task": ...}`: returns `202` at once; the answer lands in the transcript |
| GET | `/api/station/agents/{id}/tasks` | each task's latest status: queued, running, done, failed or stopped |

### How an agent answers

Its worker builds one prompt from these parts:

1. the persona;
2. a fixed "you can only write text" rule;
3. up to 12 recent turns, capped at 12k characters (failed turns are left out, so an error is never replayed as dialogue);
4. the new message.

It then calls `node code/providers/cli.js <tier> <prompt>`, the same bridge
`hermes.py` uses for every `registry:<tier>` model. So the station shares
`registry.js`'s free provider chains, its fallback order and its on-disk daily
quota. Every tier ends on local ollama, which means:

- no agent can spend money;
- every agent still answers with zero cloud keys.

Raqib is on `smart`. That chain ends on `qwen2.5:7b`, the model he ran on in StarNet.

Each agent does one thing at a time, so its transcript reads in order.
Different agents work in parallel.

### Kill switch

With `.jarvis-x-STOP` present (the same file the ACTIVE/HALTED button writes):

- chat and task requests return 503;
- the tab shows a banner and disables Send;
- a task that was already queued is marked **stopped** and never runs. It does not run later either, when the switch is released.

## Turning it on: one step for app.py

`app.py` is local-owned (HANDOFF.md), so this branch does not touch it. Add
the lines below **once**, anywhere after `require_token` is defined:

```python
# === STATION (handoff Priority 3, docs/STATION.md) ===
from code.station import mount_station
station = mount_station(app, require_token, Path(__file__).parent)
```

The lines can go anywhere after `require_token`, even after the SPA fallback
route: `mount_station` moves the station's routes to the front of the route
table itself. Placement is tested against a catch-all registered first.

Then run this on the Chromebook:

```bash
cd ~/jarvis-x && git pull
cd web && npm run build && cd ..          # the tab lives in the built UI
supervisorctl -c config/supervisord.conf restart hermes-api
curl -s http://127.0.0.1:8000/api/station/agents | head -c 300
```

Open the UI and pick **Station** in the sidebar.

- **If `JARVIS_API_TOKEN` is set,** add `-H "X-Jarvis-Token: $JARVIS_API_TOKEN"` to that curl command.
- **If the tab says "Station backend is not mounted yet",** the lines above are missing or hermes-api was not restarted.
- **If hermes-api fails to start after the change,** read `logs/supervisord/hermes-api.err.log`. A roster mistake names the agent and the field, for example `agent 'raqib': tier 'frontier' is not one of local, fast, smart, quality`.

Needs: `PyYAML` and `fastapi` in `venv-ai`. Both are already pinned in
`bootstrap/requirements-venv-ai.txt`.

## Editing the roster

Edit `config/agents.yaml` and restart hermes-api. The header lists every field.

- `tier` is one of `local | fast | smart | quality`. A test keeps that list equal to `registry.js`'s tiers.
- Any key the loader doesn't know stops the station at startup, on purpose. A typo like `model:` can't silently drop an agent's setting.

## Known limits

- **Answers arrive whole, not word by word.** The Chat tab works the same way.
- **The Scriptwriter uses `quality`, whose first provider is Gemini.** That is 20 requests a day, shared with the rest of Jarvis. When it runs out, the chain falls back to Groq, then local.
- **A slow local answer can outlast the 5-minute wait of a chat.** The request then returns 504, and the answer still appears in the transcript when it finishes. Tasks never wait.
- **Transcripts are files under `logs/`, which is gitignored.** They stay on the machine. Nothing prunes them yet.
- **The worker threads live inside hermes-api.** Restarting it drops tasks that are still queued. Their rows stay `queued` in `tasks.jsonl`, which tells the truth about what happened.

## Verified

- `python -m pytest code/station/test_station.py`: 64 passed, stable over repeated runs.
- A mutation pass caught 28 of 28 hand-made changes. The first run let 3 through, and each exposed a real gap:
  - a kill-switch refusal that waited behind a busy job;
  - a worker that could die on a disk error;
  - a vacuous "workers started" check.
- The built UI was driven in headless Chromium against the real station package, with a stand-in model:
  - 4 cards render;
  - a chat reply appears;
  - an Arabic task is queued and shows **done**, rendered right-to-left;
  - pulling the kill switch shows the banner and disables Send.
- **Not verified here:** a real model answering through `cli.js`. That needs the Chromebook, and it is the curl above plus one message in the tab.
