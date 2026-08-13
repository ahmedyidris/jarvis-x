#!/usr/bin/env python3
"""HERMES WEB API — Week 4"""
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sys, logging, json, subprocess, asyncio
from pathlib import Path
from datetime import datetime

# Import local modules
sys.path.insert(0, str(Path(__file__).parent))
from code.router import Router
from code.tts_engine import get_engine
from code.stt_engine import get_engine as get_stt_engine
import hermes as hermes_module

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('HermesAPI')

app = FastAPI(title="Hermes", version="1.0")
router = Router()

WEB_DIST = Path(__file__).parent / "web" / "dist"

STOP_FILE = Path(__file__).parent / ".jarvis-x-STOP"

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
        "available_tiers": router.valid_tiers,
        "available_voices": voices
    }

@app.get("/api/voices")
async def list_voices():
    engine = get_engine()
    return {"voices": engine.list_voices()}

@app.post("/api/ask")
async def ask(req: QueryRequest):
    try:
        model, voice = router.resolve(req.tier, voice_override=req.voice)
        hermes = hermes_module.HermesCore()
        response = hermes.ask(req.question, model)
        hermes.close()
        
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
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    audio_path = Path.home() / ".hermes" / "audio" / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(audio_path, media_type="audio/wav")

@app.get("/api/history")
async def history(limit: int = 20):
    hermes = hermes_module.HermesCore()
    conversations = hermes.recall(limit)
    hermes.close()
    return {"conversations": conversations}

@app.get("/api/killswitch")
async def killswitch_status():
    return {"stopped": STOP_FILE.exists()}

@app.post("/api/killswitch")
async def killswitch_set(req: KillSwitchRequest):
    if req.stopped:
        STOP_FILE.write_text(datetime.now().isoformat() + "\n")
    else:
        STOP_FILE.unlink(missing_ok=True)
    return {"stopped": STOP_FILE.exists()}

@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    wav_bytes = await audio.read()
    text = await asyncio.to_thread(get_stt_engine().transcribe, wav_bytes)
    return {"text": text}

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
