# jarvis-x — Operating Constraints (verified 2026-08-13)

Layer-3 reference material for future Claude Code sessions/subagents
working on this repo: constraints that have had to be re-explained by hand
in nearly every subagent dispatch this session. Point future plan docs and
subagent prompts at this file instead of retyping these. Every item below
was re-checked against the live system on 2026-08-13, not transcribed from
an earlier plan — deviations from what was assumed are flagged inline.

## Kill switch

The real, enforced kill switch is **`.jarvis-x-STOP` at the repo root**
(`/home/ahmedyidris/jarvis-x/.jarvis-x-STOP`), matching both real
enforcement points:
- `code/guard.js`: `const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');`
- `app.py`: `STOP_FILE = Path(__file__).parent / ".jarvis-x-STOP"`

**`CONSTITUTION.md` is stale on this point** — it says `~/.jarvis-x/STOP`
(line 56: "Ahmed may create `~/.jarvis-x/STOP` at any time"). That path is
not what either `guard.js` or `app.py` actually checks. Do not follow
`CONSTITUTION.md` for this specific detail; follow this file instead. (The
file does not currently exist — the kill switch is not engaged right now.)

## Edit-denied files

Enforced via the **global** `~/.claude/settings.json` deny list (not
anything in this repo) — confirmed present in `permissions.deny` as of this
check:
- `code/guard.js`
- `code/validate.js`
- `knowledge/Guidelines.md`
- `memory/rules.md`

Never `Edit`/`Write` these. Additionally, `~/.jarvis-x/.env` is
**Read+Edit** denied (both directions blocked, not just write).

## Python environment

All Python in this repo runs via `/home/ahmedyidris/venv-ai/bin/python3`.
Verified present with the expected packages: `fastapi`, `uvicorn`,
`faster_whisper`, `moviepy` import cleanly; `piper` (piper-tts) and
`kokoro` also import cleanly. Use this interpreter explicitly — do not rely
on a bare `python3`/`python` on PATH.

## No paid APIs

No paid APIs anywhere in this repo's own code paths. Local Ollama
(`qwen2.5:3b`/`qwen2.5:7b` — confirmed both referenced, in
`content_generator.py`/`economic_facts_generator.py` and `code/router.py`'s
tier table respectively) for text generation; local Piper/Kokoro for TTS;
`faster-whisper` for STT. `WebSearch` is fine for fact-sourcing (Phase B
`economic_facts` vertical) since it isn't a paid API and the entire point is
real sourcing, not LLM invention — see
`automation/phase-b/stages/01_source_content/CONTEXT.md` for the exact
rule. Any future cloud-model fallback must be an explicit, off-by-default,
human-gated toggle — never automatic.

## Backend process supervision

`app.py` (FastAPI) runs under `jarvis-supervisord.service` — confirmed
`systemctl is-enabled jarvis-supervisord.service` still reports **enabled**.
That systemd unit runs `supervisord`, which manages two programs (confirmed
via `supervisorctl -c config/supervisord.conf status`, both `RUNNING`):
- `hermes-api` (uvicorn, `app:app`)
- `ollama`

Never start a second manual `uvicorn`/`ollama` process — use
`supervisorctl -c /home/ahmedyidris/jarvis-x/config/supervisord.conf ...`.
After editing `app.py`, restart with:
```
supervisorctl -c config/supervisord.conf restart hermes-api
```

## Ollama model store pin

`config/supervisord.conf`'s `[program:ollama]` block pins
`OLLAMA_MODELS=/usr/share/ollama/.ollama/models` via its `environment=`
line — confirmed still present. Without this, Ollama silently looks in the
wrong (empty) directory. Don't let a future edit to this config drop it.

## Piper binary resolution

`code/tts_engine.py` resolves the Piper binary via
`Path(sys.executable).parent / "piper"` (falling back to `shutil.which`
only if that doesn't exist) — confirmed still in place, with the code
comment explicitly explaining why: `/usr/bin/piper` on this machine is an
unrelated GTK mouse-configuration tool that crashes if invoked as if it
were piper-tts. Never shell out to a bare `"piper"` command here.

## Unrelated / out-of-scope directories

- `sentinel/` — confirmed present, a separate, out-of-scope project within
  this same git repo. Don't touch it as part of jarvis-x work.
- `automation/n8n/` — confirmed present, likewise separate and out of
  scope.
- `~/.openjarvis/` — confirmed present at `/home/ahmedyidris/.openjarvis`,
  but it is a **completely unrelated third-party tool** (different
  project, coincidentally similar name) — not part of jarvis-x, not a
  dependency.

## Frontend (`web/`)

Confirmed via `web/package.json` and `web/components.json`:
- Vite + React + TypeScript + Tailwind CSS **v4** (`tailwindcss@^4.3.3`,
  `@tailwindcss/vite@^4.3.3`) — no `tailwind.config.js` exists (confirmed
  absent), consistent with v4's Vite-plugin-based config model.
- shadcn/ui `components.json` has `"style": "radix-nova"` (Radix
  primitives) and `"iconLibrary": "lucide"` (`lucide-react`) — the CLI's
  newer Base UI default was explicitly overridden to `radix-nova`.
- No CDN fonts/webfonts.
- Production build (`npm run build` in `web/`) is served by `app.py`
  directly from `web/dist` — confirmed: `WEB_DIST = Path(__file__).parent
  / "web" / "dist"` in `app.py`. Rebuild and
  `supervisorctl restart hermes-api` after any frontend change that needs
  to go live.

## Git convention this session

Small, verified fixes go directly to `master`. Larger subagent-dispatched
work goes on a fresh feature branch off `master`, gets independently
verified, then merged. Recent examples (both merged and branches deleted):
`feature/web-hud-visual-pass`, `feature/phase-b-week2-econ-facts`.

## `guard.js` is convention-only, not a sandbox

`code/guard.js` is the JS agent-autonomy runtime's convention-only
enforcement layer (checks the `.jarvis-x-STOP` file, logs actions) — it is
**not** a sandbox. Raw `fs`/`subprocess` calls elsewhere in the codebase
bypass it entirely. This does not apply to `app.py`'s web-chat path, which
has its own separate, real kill-switch check directly against the same
shared `.jarvis-x-STOP` file (`STOP_FILE.exists()` in
`/api/killswitch` and presumably gating chat requests).

## Two parallel routing systems — do not conflate

- **`code/router.js`** — the JS agent-autonomy path. Tiers requests to
  remote **Gemini** (`quick`/`hard`/`consequential` → `gemini` via
  `flash`/`pro`/`max` chains, per its own tier table) per
  `knowledge/Guidelines.md`. This is **not** part of the local-first chat
  path.
- **`code/router.py`** — the actual web-chat path used by `app.py`.
  Confirmed 100% local: its `TIERS` dict maps `local`/`quality` to
  `qwen2.5:3b`/`qwen2.5:7b` (Ollama) with `en_us_piper`/`en_us_kokoro`
  voices, and a Kokoro→Piper `FALLBACK_CHAINS` — no remote model anywhere
  in it.

These are separate files with separate purposes despite the similar name;
don't assume a fix or constraint on one applies to the other.
