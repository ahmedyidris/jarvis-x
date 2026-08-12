#!/usr/bin/env python3
"""
HERMES WEB API — Week 4
FastAPI wrapper around hermes.py + router.py + tts_engine.py
Serves REST API + static HTML
"""

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import sys
import logging
from pathlib import Path
from datetime import datetime

# Add code/ to path
sys.path.insert(0, str(Path(__file__).parent / "code"))

from router import Router
import hermes as hermes_module
from tts_engine import get_engine

logging.basicConfig(level=logging.INFO, format='[%(name)s] %(message)s')
logger = logging.getLogger('HermesAPI')

app = FastAPI(title="Hermes", version="1.0")
router = Router()

class QueryRequest(BaseModel):
    question: str
    tier: str = "local"
    voice: str = None
    speak: bool = False

class StatusResponse(BaseModel):
    status: str
    version: str
    available_tiers: list
    available_voices: dict

@app.get("/")
async def root():
    """Serve index.html"""
    return FileResponse("index.html")

@app.get("/api/status")
async def status() -> StatusResponse:
    """Get Hermes status"""
    hermes = hermes_module.HermesCore()
    status_data = hermes.status()
    hermes.close()
    
    engine = get_engine()
    voices = {v['id']: v['name'] for v in engine.list_voices()}
    
    return StatusResponse(
        status="online",
        version="Hermes v1 (Core + Router + TTS)",
        available_tiers=router.valid_tiers,
        available_voices=voices
    )

@app.get("/api/voices")
async def list_voices():
    """List all available voices"""
    engine = get_engine()
    return {"voices": engine.list_voices()}

@app.post("/api/ask")
async def ask(req: QueryRequest):
    """
    Ask Hermes a question.
    Returns: text response + optional audio
    """
    try:
        # Resolve tier → (model, voice)
        model, voice = router.resolve(
            req.tier,
            voice_override=req.voice
        )
        
        # Query Hermes
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
        
        # Synthesize audio if requested
        if req.speak and response:
            try:
                engine = get_engine()
                audio_bytes, mime = engine.synthesize(response, voice)
                
                # Save to temp file
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                audio_path = Path.home() / ".hermes" / "audio" / f"response-{ts}.wav"
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with open(audio_path, 'wb') as f:
                    f.write(audio_bytes)
                
                result["audio"] = f"/api/audio/{audio_path.name}"
            except Exception as e:
                logger.warning(f"TTS failed, returning text only: {e}")
                result["audio_error"] = str(e)
        
        return result
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    """Serve audio file"""
    audio_path = Path.home() / ".hermes" / "audio" / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    
    return FileResponse(audio_path, media_type="audio/wav")

@app.get("/api/recall")
async def recall(limit: int = 5):
    """Get recent conversations"""
    hermes = hermes_module.HermesCore()
    conversations = hermes.recall(limit)
    hermes.close()
    return {"conversations": conversations}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
