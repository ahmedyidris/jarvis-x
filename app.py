#!/usr/bin/env python3
"""HERMES WEB API — Week 4"""
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import urllib.request as _urlreq
import uuid
from datetime import datetime
from pathlib import Path
from subprocess import run as subprocess_run

from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Import local modules
sys.path.insert(0, str(Path(__file__).parent))
from code.reply import engine as reply_engine
from code.router import Router
from code.stt_engine import get_engine as get_stt_engine
from code.tts_engine import get_engine

import hermes as hermes_module

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('HermesAPI')

app = FastAPI(title="Hermes", version="1.0")
router = Router()

WEB_DIST = Path(__file__).parent / "web" / "dist"

STOP_FILE = Path(__file__).parent / ".jarvis-x-STOP"

# Optional shared-secret auth. Unset by default (matches current behavior --
# nothing breaks for an existing setup); set JARVIS_API_TOKEN to require an
# "X-Jarvis-Token" header on the sensitive endpoints below. If you enable it,
# the web UI needs the same value baked in at build time as
# VITE_JARVIS_API_TOKEN (see web/lib/api.ts) or its requests will 401.
#
# Caveat worth knowing: since the frontend is a static SPA served from this
# same app, the token ends up in the built JS bundle -- this stops another
# unrelated local process from hitting the API blind, but doesn't stop
# anything that can load this page itself (same as the page today).
API_TOKEN = os.environ.get("JARVIS_API_TOKEN")
AUDIO_FILENAME_RE = re.compile(r"^response-\d{8}-\d{6}\.wav$")


def require_token(x_jarvis_token: str = Header(default=None)):
    if API_TOKEN and x_jarvis_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="missing or invalid X-Jarvis-Token header")

class QueryRequest(BaseModel):
    question: str
    tier: str = "local"
    voice: str = None
    speak: bool = False

class KillSwitchRequest(BaseModel):
    stopped: bool

@app.get("/")
async def root():
    return FileResponse(WEB_DIST / "index.html")

# Mount built assets (JS/CSS/etc.) under /assets
app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

@app.get("/api/status")
async def status():
    hermes = hermes_module.HermesCore()
    status_data = hermes.status()
    hermes.close()
    engine = get_engine()
    voices = {v['id']: v['name'] for v in engine.list_voices()}
    return {
        "status": "online",
        "version": "Hermes v1",
        "conversations": status_data["conversations"],
        "available_tiers": router.local_tiers(),  # local only -- see Router.local_tiers
        "available_voices": voices
    }

@app.get("/api/voices")
async def list_voices():
    engine = get_engine()
    return {"voices": engine.list_voices()}


# === ARABIC VOICE ROUTING (chatterbox-eg worker on :8001) ===
TTS_WORKER_URL = "http://127.0.0.1:8001/synthesize"

def _is_arabic(text: str) -> bool:
    """True if the text is predominantly Arabic script."""
    ar = sum(1 for c in text if '\u0600' <= c <= '\u06FF')
    letters = sum(1 for c in text if c.isalpha())
    return letters > 0 and ar / letters > 0.5

def _synth_arabic_clone(text: str) -> bytes:
    """Ask the resident Chatterbox worker for cloned Egyptian audio."""
    body = json.dumps({"text": text, "clone": True}).encode("utf-8")
    req = _urlreq.Request(TTS_WORKER_URL, data=body,
                          headers={"Content-Type": "application/json"})
    with _urlreq.urlopen(req, timeout=180) as r:
        return r.read()

@app.post("/api/ask", dependencies=[Depends(require_token)])
async def ask(req: QueryRequest):
    # TODO: Fix Arabic TTS — using English voice as fallback
    # Kill switch: CONSTITUTION.md's guarantee ("Jarvis halts... all running
    # processes exit cleanly") carves out no exception for chat, and
    # /api/killswitch already checks this exact file -- an /api/ask that
    # kept answering while the switch was set would be a silent exception to
    # what's otherwise treated as an unconditional stop everywhere else in
    # this codebase (code/guard.js, code/lib.js's execute()).
    if STOP_FILE.exists():
        raise HTTPException(status_code=503, detail="Kill switch active — Jarvis is halted")
    busy = _generation_job_in_progress()
    if busy:
        started = datetime.fromisoformat(busy["started_at"])
        elapsed = int((datetime.now() - started).total_seconds())
        raise HTTPException(
            status_code=503,
            detail=(
                f"Content generation running for '{busy['vertical']}' "
                f"({elapsed}s so far) — Ollama is busy, try again shortly"
            ),
        )
    try:
        model, voice = router.resolve(req.tier, voice_override=req.voice)
        hermes = hermes_module.HermesCore()
        try:
            # System prompt: establish Jarvis X identity
            system_msg = (
                "You are Jarvis X, a local AI agent built by Ahmed. "
                "Never say you are Qwen or any other model. "
                "Always write your own name in Latin script as 'Jarvis X' — never transliterate it into Arabic. "
                "If the user writes in Arabic, reply in EGYPTIAN COLLOQUIAL ARABIC (المصري), never Modern Standard Arabic. "
                "Use Egyptian words: عايز not أريد، إيه not ماذا، دلوقتي not الآن، "
                "إزيك not كيف حالك، النهاردة not اليوم، ازاي not كيف، مش not ليس. "
                "Write naturally, the way people actually talk in Cairo. "
                "You were built by Ahmed — you are NOT SILMA, Gemma, Qwen, or Simon. "
                "NEVER write a single English word in an Arabic reply, except your own name. "
                "If unsure of a fact, say مش متأكد rather than inventing one. "
                "Keep answers SHORT — two sentences maximum. "
                "Never mix English words into Arabic sentences except your own name. "
                "Never invent capabilities. You answer questions, run guarded local commands, and speak."
            )
            response = reply_engine.handle(req.question, model, system_msg, hermes)
        except hermes_module.HermesBackendError as e:
            # Distinct status from a normal (if terse) answer -- a caller
            # checking only the HTTP status code must be able to tell "the
            # LLM backend is down" from "it answered". See REMAINING_WORK.md
            # P6: this used to fold both into an ordinary 200 response.
            raise HTTPException(status_code=503, detail=f"LLM backend unavailable: {e}")
        finally:
            hermes.close()

        from code.arabic_text import prepare as _prep
        if _is_arabic(response):
            response = _prep(response)

        result = {
            "question": req.question,
            "response": response,
            "tier": req.tier,
            "model": model,
            "voice": voice if req.speak else None,
            "audio": None
        }
        
        if req.speak and response:
            try:
                engine = get_engine()
                # synthesize() blocks — most voices are fast, but EGTTS can
                # take up to ~5 minutes on a cold load. Dispatch off-thread
                # so a slow voice doesn't freeze the event loop for every
                # other request.
                if _is_arabic(response):
                    audio_bytes = await asyncio.to_thread(_synth_arabic_clone, response)
                else:
                    audio_bytes = await asyncio.to_thread(engine.synthesize, response, voice)
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                audio_path = Path.home() / ".hermes" / "audio" / f"response-{ts}.wav"
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with open(audio_path, 'wb') as f:
                    f.write(audio_bytes)
                result["audio"] = f"/api/audio/{audio_path.name}"
            except Exception as e:
                logger.warning(f"TTS failed: {e}")
        
        return result
    except HTTPException:
        # Already the right status (e.g. the 503 raised above for a backend
        # failure) -- let it through as-is instead of the broad handler
        # below rewrapping it into a misleading 500.
        raise
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/audio/{filename}", dependencies=[Depends(require_token)])
async def get_audio(filename: str):
    if not AUDIO_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    audio_path = Path.home() / ".hermes" / "audio" / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(audio_path, media_type="audio/wav")

@app.get("/api/history", dependencies=[Depends(require_token)])
async def history(limit: int = 20):
    hermes = hermes_module.HermesCore()
    conversations = hermes.recall(limit)
    hermes.close()
    return {"conversations": conversations}

@app.get("/api/killswitch", dependencies=[Depends(require_token)])
async def killswitch_status():
    return {"stopped": STOP_FILE.exists()}

@app.post("/api/killswitch", dependencies=[Depends(require_token)])
async def killswitch_set(req: KillSwitchRequest):
    if req.stopped:
        STOP_FILE.write_text(datetime.now().isoformat() + "\n")
    else:
        STOP_FILE.unlink(missing_ok=True)
    return {"stopped": STOP_FILE.exists()}

@app.post("/api/transcribe", dependencies=[Depends(require_token)])
async def transcribe(audio: UploadFile = File(...), language: str = "ar"):
    # `language` used to be hardcoded to "ar" with no way to override --
    # confirmed that forced English speech into a garbled Arabic transcript.
    # Tried defaulting this to None (auto-detect) instead: fixed English, but
    # broke short Arabic clips exactly as code/stt_engine.py's own comment
    # warns ("the smaller models will happily romanize Arabic into Latin
    # script" -- turns out large-v3 does this too on short audio, not just
    # smaller models) -- a real espeak-ng Arabic sample under 3s came back
    # as "Mh-ba-ka-fah-a-lick." instead of Arabic text. This system is
    # Arabic-first by design (system prompt, EGTTS voice cloning), so "ar"
    # stays the default -- unchanged behavior for the primary use case --
    # but is now an explicit, overridable parameter instead of a hardcoded
    # literal, so a caller that knows it's getting English speech (e.g. a
    # future language-toggle UI) can pass ?language=en or language=None to
    # auto-detect.
    wav_bytes = await audio.read()
    text = await asyncio.to_thread(get_stt_engine().transcribe, wav_bytes, language)
    return {"text": text}

# ---------------------------------------------------------------------------
# Dashboard — read-only observability + Phase B generation trigger.
#
# All routes below are auth-gated the same way /api/ask already is
# (require_token, off by default) -- this is new surface area with real
# system-internals visibility and one route with real side effects
# (POST .../generate), so it gets the same treatment as everything else
# sensitive in this file, not a new exception.
#
# Deliberately NOT implemented, even though the original request asked for
# it: live-editing SOURCED_FACTS "inline". SOURCED_FACTS lives inside the
# *.py generator files (code), not standalone JSON -- exposing arbitrary
# write access to a Python file that later gets imported and executed is a
# real code-injection surface, not a config-editing convenience, regardless
# of auth-gating (a compromised token would become an RCE primitive). What
# IS exposed instead: the already-generated JSON *content* files under
# stages/01_source_content/output/ (pure data: topic/headline_fact/
# narration_script/etc, never executed) -- editable, but that's the
# rendered output of a fact, not the fact-sourcing code itself.
# ---------------------------------------------------------------------------

PHASE_B_ROOT = Path(__file__).parent / "automation" / "phase-b"
CONTENT_ROOT = PHASE_B_ROOT / "stages" / "01_source_content" / "output"
RENDER_ROOT = PHASE_B_ROOT / "stages" / "02_render_video" / "output"

# vertical -> its generator script + the module-level function that runs a
# full batch. All four already exist; this just maps the dashboard's
# "generate" button to the same code path automation/phase-b/*_generator.py
# already exposes via `if __name__ == "__main__"`.
VERTICAL_GENERATORS = {
    "letters": "content_generator.py",
    "economic_facts": "economic_facts_generator.py",
    "commodities_macro": "commodities_macro_generator.py",
    "geopolitical_risk": "geopolitical_risk_generator.py",
}

# In-memory job tracking. A single dashboard/single-operator system doesn't
# need a persistent job queue -- this is intentionally the simplest thing
# that actually works, not a placeholder for something bigger.
_generation_jobs: dict[str, dict] = {}


def _generation_job_in_progress() -> dict | None:
    """The running Phase B vertical job, if any -- these call Ollama
    directly (content_generator.py et al) and contend with /api/ask's own
    Ollama call for Ollama's single-slot internal request queue
    (REMAINING_WORK.md P7). Excludes "_test_run" (scripts/status.sh --
    no Ollama call, doesn't contend)."""
    for job in _generation_jobs.values():
        if job.get("vertical") in VERTICAL_GENERATORS and job.get("status") == "running":
            return job
    return None


def _dashboard_path_for(vertical: str, filename: str, root: Path) -> Path:
    """Jailed path resolution for dashboard file access -- same pattern as
    code/exec.js's safePath(): resolve, then confirm the real path is still
    inside the expected vertical's directory, so a filename like
    '../../../etc/passwd' can't escape it."""
    if vertical not in VERTICAL_GENERATORS:
        raise HTTPException(status_code=404, detail=f"unknown vertical: {vertical}")
    base = (root / vertical).resolve()
    candidate = (base / filename).resolve()
    if not str(candidate).startswith(str(base) + os.sep) and candidate != base:
        raise HTTPException(status_code=400, detail="invalid filename")
    return candidate


def _read_system_health() -> dict:
    disk = shutil.disk_usage("/")
    load1, load5, load15 = os.getloadavg()
    mem_total = mem_avail = None
    try:
        with open("/proc/meminfo") as f:
            meminfo = {}
            for line in f:
                k, v = line.split(":", 1)
                meminfo[k] = int(v.strip().split()[0])  # kB
        mem_total = meminfo.get("MemTotal")
        mem_avail = meminfo.get("MemAvailable")
    except FileNotFoundError:
        pass  # non-Linux; leave as None rather than fabricate a number
    return {
        "disk_free_gb": round(disk.free / (1024**3), 2),
        "disk_total_gb": round(disk.total / (1024**3), 2),
        "load_average": {"1m": load1, "5m": load5, "15m": load15},
        "memory_used_mb": round((mem_total - mem_avail) / 1024, 1) if mem_total and mem_avail else None,
        "memory_total_mb": round(mem_total / 1024, 1) if mem_total else None,
    }


def _read_agent_loop_status() -> dict:
    # Honest check, not a fabricated "running" status: scheduler.js isn't
    # currently supervised as a persistent process (only ollama + hermes-api
    # are, per config/supervisord.conf) -- report whichever is actually true.
    try:
        r = subprocess.run(["pgrep", "-f", "node.*scheduler.js"], capture_output=True, text=True, timeout=5)
        running = bool(r.stdout.strip())
    except Exception:
        running = None  # couldn't determine, not "not running"
    return {"scheduler_running": running, "note": "scheduler.js is not supervised as a persistent process by default — see config/supervisord.conf"}


def _read_latest_test_status() -> dict:
    logs_dir = Path(__file__).parent / "logs"
    candidates = sorted(logs_dir.glob("nightly-status-*.log"), reverse=True)
    if not candidates:
        return {"available": False, "note": "no nightly cron run yet"}
    latest = candidates[0]
    text = latest.read_text(errors="replace")
    m = re.search(r"checks\s+(\d+)\s+passed,\s+(\d+)\s+failed", text)
    if not m:
        return {"available": False, "note": f"could not parse {latest.name}"}
    return {
        "available": True,
        "file": latest.name,
        "passed": int(m.group(1)),
        "failed": int(m.group(2)),
    }


def _read_nightly_history(limit: int = 30) -> list[dict]:
    """Real history, not a fabricated trend line: every nightly-status-*.log
    that actually exists, parsed the same way _read_latest_test_status()
    does. Will be short/empty until the cron job (added 2026-08-16) has run
    a few times -- that's honest, not a bug."""
    logs_dir = Path(__file__).parent / "logs"
    out = []
    for f in sorted(logs_dir.glob("nightly-status-*.log"))[-limit:]:
        text = f.read_text(errors="replace")
        m = re.search(r"checks\s+(\d+)\s+passed,\s+(\d+)\s+failed", text)
        if m:
            date_match = re.search(r"nightly-status-(\d{8})", f.name)
            out.append({
                "date": date_match.group(1) if date_match else f.name,
                "passed": int(m.group(1)),
                "failed": int(m.group(2)),
            })
    return out


async def _dashboard_overview() -> dict:
    return {
        "timestamp": datetime.now().isoformat(),
        "kill_switch_stopped": STOP_FILE.exists(),
        "system": _read_system_health(),
        "agent_loop": _read_agent_loop_status(),
        "tests": _read_latest_test_status(),
        "jobs": {v: j for v, j in _generation_jobs.items()},
    }


def _read_live_data() -> dict:
    """Snapshot of live market/crypto data via the Node provider layer.

    Providers live in code/providers/*.js; rather than reimplementing the
    CoinGecko and Alpha Vantage clients in Python, shell out to the same
    verified code the agent uses. Each item declares its own origin so the
    dashboard can show live vs mock rather than presenting both alike.
    """
    script = Path(__file__).parent / "scripts" / "live-data.js"
    if not script.exists():
        return {"error": "live-data.js not found", "items": []}
    try:
        proc = subprocess.run(
            ["node", str(script)],
            capture_output=True, text=True, timeout=45,
            cwd=str(Path(__file__).parent),
        )
        if proc.returncode != 0:
            return {"error": (proc.stderr or "node exited non-zero").strip()[:400], "items": []}
        return json.loads(proc.stdout)
    except subprocess.TimeoutExpired:
        return {"error": "live-data timed out after 45s", "items": []}
    except json.JSONDecodeError as exc:
        return {"error": f"bad JSON from live-data.js: {exc}", "items": []}


@app.get("/api/dashboard/live-data", dependencies=[Depends(require_token)])
async def dashboard_live_data():
    return await asyncio.to_thread(_read_live_data)


@app.get("/api/dashboard/overview", dependencies=[Depends(require_token)])
async def dashboard_overview():
    return await _dashboard_overview()


@app.get("/api/dashboard/tests/history", dependencies=[Depends(require_token)])
async def dashboard_test_history():
    return {"history": _read_nightly_history()}


@app.get("/api/dashboard/verticals", dependencies=[Depends(require_token)])
async def dashboard_verticals():
    result = {}
    for vertical in VERTICAL_GENERATORS:
        vdir = CONTENT_ROOT / vertical
        facts = []
        if vdir.is_dir():
            for f in sorted(vdir.glob("*.json")):
                try:
                    data = json.loads(f.read_text())
                except (json.JSONDecodeError, OSError):
                    continue
                facts.append({
                    "filename": f.name,
                    "topic": data.get("topic") or data.get("letter"),
                    "source_name": data.get("source_name"),
                    "source_url": data.get("source_url"),
                    "generated_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                })
        result[vertical] = {
            "fact_count": len(facts),
            "facts": facts,
            # Honest: no live schedule exists for any vertical today.
            "next_scheduled_refresh": None,
        }
    return result


@app.get("/api/dashboard/videos", dependencies=[Depends(require_token)])
async def dashboard_videos():
    result = {}
    for vertical in VERTICAL_GENERATORS:
        vdir = RENDER_ROOT / vertical
        videos = []
        if vdir.is_dir():
            for f in sorted(vdir.glob("*.mp4")):
                videos.append({
                    "filename": f.name,
                    "size_mb": round(f.stat().st_size / (1024**2), 2),
                    "rendered_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                    "url": f"/api/dashboard/video/{vertical}/{f.name}",
                })
        result[vertical] = {"video_count": len(videos), "videos": videos}
    return result


@app.get("/api/dashboard/video/{vertical}/{filename}", dependencies=[Depends(require_token)])
async def dashboard_get_video(vertical: str, filename: str):
    if not re.match(r"^[\w\-.]+\.mp4$", filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = _dashboard_path_for(vertical, filename, RENDER_ROOT)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="video not found")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/dashboard/content/{vertical}/{filename}", dependencies=[Depends(require_token)])
async def dashboard_get_content(vertical: str, filename: str):
    if not re.match(r"^[\w\-.]+\.json$", filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = _dashboard_path_for(vertical, filename, CONTENT_ROOT)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="content file not found")
    return json.loads(path.read_text())


class ContentUpdate(BaseModel):
    # Same fields every economic-facts-shaped generator's output JSON has.
    # source_name/source_url/headline_fact are intentionally NOT editable
    # here -- they're the traceable-fact record; only the LLM-scripted
    # narration/caption/image-prompt fields are.
    narration_script: str | None = None
    on_screen_text: str | None = None
    image_prompt: str | None = None


@app.put("/api/dashboard/content/{vertical}/{filename}", dependencies=[Depends(require_token)])
async def dashboard_update_content(vertical: str, filename: str, update: ContentUpdate):
    if not re.match(r"^[\w\-.]+\.json$", filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = _dashboard_path_for(vertical, filename, CONTENT_ROOT)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="content file not found")
    data = json.loads(path.read_text())
    for field in ("narration_script", "on_screen_text", "image_prompt"):
        value = getattr(update, field)
        if value is not None:
            data[field] = value
    path.write_text(json.dumps(data, indent=2))
    return data


def _next_letter_to_generate() -> str:
    """letters is the one vertical with no generate_and_render_all()-style
    batch entrypoint -- content_generator.py takes a single required
    <LETTER> CLI arg (confirmed: running it with none exits 1, 'Usage:
    ...'). Pick the next not-yet-generated letter A-Z as a deterministic,
    honest default rather than inventing an arbitrary always-regenerate-A
    behavior."""
    existing = {f.stem.replace("letter_", "") for f in (CONTENT_ROOT / "letters").glob("letter_*.json")}
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if letter not in existing:
            return letter
    return "A"  # all 26 exist; re-run A rather than error


def _run_generator_job(vertical: str, job_id: str):
    venv_python = str(Path.home() / "venv-ai" / "bin" / "python3")
    # P7 (REMAINING_WORK.md): confirmed by direct reproduction that this batch
    # pipeline's own CPU usage (Piper TTS synthesis inside video_renderer.py
    # hit 386.7% CPU on this 8-core box) starves interactive chat's Ollama
    # calls -- a trivial "Hello." query went from 4s to 64-76s when it ran
    # concurrent with a render. `nice`/`ionice` here de-prioritize this batch
    # subprocess tree below interactive chat without needing to serialize the
    # two paths or touch Ollama/hermes.py at all.
    NICE_PREFIX = ["nice", "-n", "15", "ionice", "-c2", "-n7"]

    def run_deprioritized(argv, **kwargs):
        return subprocess.run(NICE_PREFIX + argv, **kwargs)

    try:
        if vertical == "letters":
            # Unlike the other 3 verticals' generate_and_render_all() (one
            # call does both content + render), letters needs two separate
            # scripts -- confirmed via content_generator.py's __main__,
            # which only writes the JSON and never renders.
            letter = _next_letter_to_generate()
            r1 = run_deprioritized([venv_python, "content_generator.py", letter], cwd=str(PHASE_B_ROOT), capture_output=True, text=True, timeout=300)
            if r1.returncode != 0:
                _generation_jobs[job_id] = {"vertical": vertical, "status": "failed", "finished_at": datetime.now().isoformat(), "output_tail": (r1.stdout + r1.stderr)[-2000:]}
                return
            result = run_deprioritized([venv_python, "video_renderer.py", letter], cwd=str(PHASE_B_ROOT), capture_output=True, text=True, timeout=300)
        else:
            script = VERTICAL_GENERATORS[vertical]
            result = run_deprioritized(
                [venv_python, script],
                cwd=str(PHASE_B_ROOT),
                capture_output=True, text=True, timeout=1800,  # generous: real Ollama calls, CPU-only
            )
        _generation_jobs[job_id] = {
            "vertical": vertical,
            "status": "done" if result.returncode == 0 else "failed",
            "finished_at": datetime.now().isoformat(),
            "output_tail": (result.stdout + result.stderr)[-2000:],
        }
    except subprocess.TimeoutExpired:
        _generation_jobs[job_id] = {"vertical": vertical, "status": "timeout", "finished_at": datetime.now().isoformat()}
    except Exception as e:
        _generation_jobs[job_id] = {"vertical": vertical, "status": "error", "finished_at": datetime.now().isoformat(), "error": str(e)}


@app.post("/api/dashboard/generate/{vertical}", dependencies=[Depends(require_token)])
async def dashboard_generate(vertical: str):
    if vertical not in VERTICAL_GENERATORS:
        raise HTTPException(status_code=404, detail=f"unknown vertical: {vertical}")
    if STOP_FILE.exists():
        raise HTTPException(status_code=503, detail="Kill switch active — Jarvis is halted")
    # One job per vertical at a time -- prevents two concurrent Ollama batch
    # runs for the same vertical from racing on the same output files.
    existing = _generation_jobs.get(vertical)
    if existing and existing.get("status") == "running":
        raise HTTPException(status_code=409, detail=f"a generation job for {vertical} is already running")
    job_id = vertical
    _generation_jobs[job_id] = {"vertical": vertical, "status": "running", "started_at": datetime.now().isoformat()}
    asyncio.get_event_loop().run_in_executor(None, _run_generator_job, vertical, job_id)
    return {"job_id": job_id, "status": "running"}


def _run_test_suite_job():
    try:
        result = subprocess.run(
            ["bash", "scripts/status.sh"],
            cwd=str(Path(__file__).parent),
            capture_output=True, text=True, timeout=300,
        )
        m = re.search(r"checks\s+(\d+)\s+passed,\s+(\d+)\s+failed", result.stdout)
        _generation_jobs["_test_run"] = {
            "vertical": "_test_run",
            "status": "done",
            "finished_at": datetime.now().isoformat(),
            "passed": int(m.group(1)) if m else None,
            "failed": int(m.group(2)) if m else None,
        }
    except subprocess.TimeoutExpired:
        _generation_jobs["_test_run"] = {"vertical": "_test_run", "status": "timeout", "finished_at": datetime.now().isoformat()}
    except Exception as e:
        _generation_jobs["_test_run"] = {"vertical": "_test_run", "status": "error", "finished_at": datetime.now().isoformat(), "error": str(e)}


@app.post("/api/dashboard/run-tests", dependencies=[Depends(require_token)])
async def dashboard_run_tests():
    # Ctrl+R in the dashboard UI -- runs the real scripts/status.sh (~2min),
    # same job-tracking pattern as generate. Distinct key from any real
    # vertical name so it can't collide with those jobs.
    existing = _generation_jobs.get("_test_run")
    if existing and existing.get("status") == "running":
        raise HTTPException(status_code=409, detail="a test run is already in progress")
    _generation_jobs["_test_run"] = {"vertical": "_test_run", "status": "running", "started_at": datetime.now().isoformat()}
    asyncio.get_event_loop().run_in_executor(None, _run_test_suite_job)
    return {"status": "running"}


@app.get("/api/dashboard/config", dependencies=[Depends(require_token)])
async def dashboard_config():
    constitution = (Path(__file__).parent / "CONSTITUTION.md").read_text(errors="replace")
    guidelines = (Path(__file__).parent / "knowledge" / "Guidelines.md").read_text(errors="replace")
    return {
        "constitution_preview": constitution,
        "guidelines_preview": guidelines,
        # Informational only, deliberately not exposed as live-editable
        # controls: none of these map to a real enforced setting today
        # (see docs/obsidian-vault/decisions/model-gateway-not-wired.md --
        # there's no live cost/budget tracking wired into the running
        # system to control with a slider). A fake control that doesn't
        # actually do anything would be worse than not having one.
        "voice_per_vertical": {
            "letters": "en_us_piper",
            "economic_facts": "en_us_kokoro",
            "commodities_macro": "en_us_kokoro",
            "geopolitical_risk": "en_us_kokoro",
        },
        "api_token_configured": bool(API_TOKEN),
        "self_debug_loop_status": "deliberately deferred — NOTES.md: revisit when agent accuracy is 'boring' (still 77% as of last check)",
    }


@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    if API_TOKEN:
        token = websocket.headers.get("x-jarvis-token") or websocket.query_params.get("token")
        if token != API_TOKEN:
            await websocket.close(code=4401)
            return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(await _dashboard_overview())
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass

# SPA fallback: any unmatched non-/api path serves index.html,
# so client-side routes (if added later) don't 404 on refresh.
#
# Deviation from the plan's literal code: Vite's build here also copies
# web/public/*'s root-level static files (favicon.svg, icons.svg, and
# Task 10's manifest.json/icon-*.png) straight into web/dist/ rather than
# under /assets/. The plan's fallback would have shadowed every one of
# those with index.html's HTML (still a 200, but wrong content) since this
# catch-all matches before any 404 would occur. Serving the real file when
# it exists on disk keeps the SPA-fallback behavior for genuine client
# routes while not breaking the manifest/icons/favicon.

# === DECISION INSPECTOR ===
@app.get("/api/decision/{decision_id}")
async def get_decision(decision_id: str, _token=Depends(require_token)):
    """Fetch full decision detail: inputs, reasoning, sources, output."""
    try:
        log_file = Path(__file__).parent / "logs" / "actions.jsonl"
        if not log_file.exists():
            raise HTTPException(status_code=404, detail="No decisions yet")
        
        with open(log_file) as f:
            for line in f:
                entry = json.loads(line)
                if entry.get("timestamp") == decision_id or entry.get("id") == decision_id:
                    return {
                        "id": decision_id,
                        "timestamp": entry.get("timestamp"),
                        "question": entry.get("input", ""),
                        "tier": entry.get("tier", "local"),
                        "model": entry.get("model", ""),
                        "reasoning": entry.get("reasoning", ""),
                        "sources": entry.get("sources", []),
                        "output": entry.get("output", ""),
                        "latency_ms": entry.get("latency_ms", 0),
                    }
        raise HTTPException(status_code=404, detail="Decision not found")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No decisions yet")

# === OUTPUT LIBRARY ===
@app.get("/api/outputs/query")
async def query_outputs(
    from_date: str = None,
    to_date: str = None,
    model: str = None,
    tier: str = None,
    search: str = None,
    limit: int = 50,
    _token=Depends(require_token)
):
    """Query saved outputs with filters."""
    results = []
    try:
        log_file = Path(__file__).parent / "logs" / "actions.jsonl"
        if not log_file.exists():
            return []
        
        with open(log_file) as f:
            for line in f:
                entry = json.loads(line)
                if entry.get("action") != "ask":
                    continue
                
                # Apply filters
                if from_date and entry.get("timestamp", "") < from_date:
                    continue
                if to_date and entry.get("timestamp", "") > to_date:
                    continue
                if model and entry.get("model") != model:
                    continue
                if tier and entry.get("tier") != tier:
                    continue
                if search and search.lower() not in entry.get("input", "").lower():
                    continue
                
                results.append({
                    "id": entry.get("timestamp"),
                    "timestamp": entry.get("timestamp"),
                    "question": entry.get("input", ""),
                    "response": entry.get("output", ""),
                    "model": entry.get("model", ""),
                    "tier": entry.get("tier", "local"),
                })
                
                if len(results) >= limit:
                    break
    except Exception:
        pass
    
    return results

# === VERTICAL CONTROLS ===
@app.get("/api/verticals/status")
async def get_verticals_status(_token=Depends(require_token)):
    """List all verticals and their pause/resume state."""
    try:
        config_file = Path(__file__).parent / "config" / "scheduler.json"
        if not config_file.exists():
            return []
        
        with open(config_file) as f:
            config = json.load(f)
            return [
                {
                    "name": v.get("name"),
                    "enabled": not v.get("paused", False),
                    "last_run": v.get("last_run"),
                    "next_run": v.get("next_run"),
                    "schedule": v.get("schedule"),
                }
                for v in config.get("verticals", [])
            ]
    except Exception:
        return []

@app.post("/api/verticals/{name}/pause")
async def pause_vertical(name: str, _token=Depends(require_token)):
    """Pause a vertical."""
    try:
        config_file = Path(__file__).parent / "config" / "scheduler.json"
        with open(config_file) as f:
            config = json.load(f)
        for v in config.get("verticals", []):
            if v.get("name") == name:
                v["paused"] = True
        with open(config_file, "w") as f:
            json.dump(config, f)
        return {"name": name, "enabled": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/verticals/{name}/resume")
async def resume_vertical(name: str, _token=Depends(require_token)):
    """Resume a vertical."""
    try:
        config_file = Path(__file__).parent / "config" / "scheduler.json"
        with open(config_file) as f:
            config = json.load(f)
        for v in config.get("verticals", []):
            if v.get("name") == name:
                v["paused"] = False
        with open(config_file, "w") as f:
            json.dump(config, f)
        return {"name": name, "enabled": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# === AGENT EXECUTOR ===
class ExecuteRequest(BaseModel):
    cmd: str
    args: list = []

@app.post("/api/execute")
async def execute_command(req: ExecuteRequest, _token=Depends(require_token)):
    """Execute a guarded local command."""
    ALLOWED = {'ls', 'cat', 'mkdir', 'touch', 'echo', 'curl', 'bash', 'python', 'node', 'rm', 'pwd'}
    
    if req.cmd not in ALLOWED:
        raise HTTPException(status_code=403, detail=f"Command '{req.cmd}' not allowed")
    
    try:
        result = subprocess_run(
            [req.cmd] + req.args,
            capture_output=True,
            text=True,
            timeout=15
        )
        
        # Log the execution
        log_file = Path(__file__).parent / "logs" / "actions.jsonl"
        log_file.parent.mkdir(exist_ok=True)
        with open(log_file, "a") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "action": "cmd-exec",
                "cmd": req.cmd,
                "args": req.args,
                "exit_code": result.returncode,
                "allowed": True,
            }, f)
            f.write("\n")
        
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout[:10000],
            "stderr": result.stderr[:10000],
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Command timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === CLIPPER VERTICAL ===
class ClipperRequest(BaseModel):
    source: str
    n_clips: int = 5
    aspect: str = "9:16"
    language: str = None
    model_size: str = "base"
    subtitles: bool = True

# Keyed by job_id (uuid4), not by a fixed vertical name like
# _generation_jobs -- any number of distinct sources can run concurrently,
# so there's no small fixed keyspace to key on.
_clipper_jobs: dict[str, dict] = {}


def _run_clipper_job(job_id: str, params: dict):
    """Background worker for one clipper pipeline run.

    Same job-queue shape as _run_generator_job, adapted for an in-process
    pipeline instead of a subprocess script. This runs inside a
    ThreadPoolExecutor worker thread (via run_in_executor below), so
    os.nice() here only renices this thread's kernel task, not the whole
    process -- same deprioritization intent as _run_generator_job's
    nice/ionice subprocess wrapping (see its P7 comment: this box measured
    an interactive Ollama query go from 4s to 64-76s when a batch render
    ran concurrently), just without a subprocess boundary to hang ionice
    off of, so only CPU niceness is covered here, not I/O priority.
    """
    try:
        os.nice(15)
    except OSError:
        pass  # best-effort; a failure to renice must not fail the job

    from code.verticals.clipper import ClipperStoppedError, run as clipper_run
    from code.verticals.clipper.ingest import IngestError

    try:
        result = clipper_run(**params)
        _clipper_jobs[job_id] = {
            "source": params["source"],
            "status": "done",
            "finished_at": datetime.now().isoformat(),
            "language": result["transcript"]["language"],
            "clips": result["clips"],
        }
    except IngestError as e:
        _clipper_jobs[job_id] = {"source": params["source"], "status": "failed", "finished_at": datetime.now().isoformat(), "error": str(e)}
    except ClipperStoppedError as e:
        _clipper_jobs[job_id] = {"source": params["source"], "status": "stopped", "finished_at": datetime.now().isoformat(), "error": str(e)}
    except Exception as e:
        _clipper_jobs[job_id] = {"source": params["source"], "status": "error", "finished_at": datetime.now().isoformat(), "error": str(e)}


@app.post("/api/verticals/clipper")
async def run_clipper(req: ClipperRequest, _token=Depends(require_token)):
    """Start the clipper vertical (code/verticals/clipper) on a local video file.

    Background job-queue pattern, same shape as
    /api/dashboard/generate/{vertical}: returns immediately with a job_id,
    runs in a thread-pool executor, caller polls
    GET /api/verticals/clipper/{job_id} for the result. Not /api/execute's
    synchronous shape -- a whisper+ffmpeg pipeline can run for minutes, and
    blocking the event loop that long would make the rest of Jarvis's API
    (including the dashboard) look dead.
    """
    ALLOWED_ASPECTS = {'9:16', '16:9', '1:1', '4:5'}
    ALLOWED_MODEL_SIZES = {'tiny', 'base', 'small', 'medium', 'large-v3'}

    if req.aspect not in ALLOWED_ASPECTS:
        raise HTTPException(status_code=400, detail=f"aspect must be one of {sorted(ALLOWED_ASPECTS)}")
    if req.model_size not in ALLOWED_MODEL_SIZES:
        raise HTTPException(status_code=400, detail=f"model_size must be one of {sorted(ALLOWED_MODEL_SIZES)}")
    if not 1 <= req.n_clips <= 20:
        raise HTTPException(status_code=400, detail="n_clips must be between 1 and 20")
    if STOP_FILE.exists():
        raise HTTPException(status_code=503, detail="Kill switch active — Jarvis is halted")

    # One job per source path at a time -- same race dashboard_generate
    # guards against, keyed by source instead of a fixed vertical name.
    existing = next(
        (j for j in _clipper_jobs.values() if j.get("source") == req.source and j.get("status") == "running"),
        None,
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"a clipper job for {req.source!r} is already running")

    job_id = uuid.uuid4().hex
    params = {
        "source": req.source,
        "n_clips": req.n_clips,
        "aspect": req.aspect,
        "language": req.language,
        "model_size": req.model_size,
        "subtitles": req.subtitles,
    }
    _clipper_jobs[job_id] = {"source": req.source, "status": "running", "started_at": datetime.now().isoformat()}
    asyncio.get_event_loop().run_in_executor(None, _run_clipper_job, job_id, params)
    return {"job_id": job_id, "status": "running"}


@app.get("/api/verticals/clipper/{job_id}", dependencies=[Depends(require_token)])
async def clipper_job_status(job_id: str):
    job = _clipper_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    return job


@app.exception_handler(hermes_module.HermesBackendError)
async def hermes_backend_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "error_class": "HermesBackendError",
            "message": exc.message,
            "path": request.url.path
        }
    )


# SPA fallback: any unmatched non-/api path serves index.html
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    candidate = WEB_DIST / full_path
    if full_path and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(WEB_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

