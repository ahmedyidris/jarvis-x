"""Resident Chatterbox-Egyptian worker.

Loads the 5GB model once (~75s) and serves synthesis over HTTP so the app
pays that cost at startup, not per request. Run:
    python code/tts_worker.py
"""
import io, sys, time
from pathlib import Path

import torch, soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))
from arabic_text import prepare

REPO = Path(__file__).resolve().parent.parent
CKPT = REPO / "voices" / "chatterbox-eg"
REF = REPO / "voices" / "ahmed" / "ref.wav"

app = FastAPI(title="Jarvis X Arabic TTS")
_model = None


def get_model():
    global _model
    if _model is None:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        orig = torch.nn.Module.load_state_dict
        torch.nn.Module.load_state_dict = (
            lambda s, sd, strict=True, assign=False: orig(s, sd, strict=False, assign=assign)
        )
        t0 = time.time()
        _model = ChatterboxMultilingualTTS.from_local(str(CKPT), "cpu")
        torch.nn.Module.load_state_dict = orig
        print(f"[tts_worker] model loaded in {time.time()-t0:.0f}s", flush=True)
    return _model


class SynthRequest(BaseModel):
    text: str
    clone: bool = True


@app.get("/health")
def health():
    return {"loaded": _model is not None}


@app.post("/synthesize")
def synthesize(req: SynthRequest):
    m = get_model()
    text = prepare(req.text)
    t0 = time.time()
    try:
        kw = {"audio_prompt_path": str(REF)} if (req.clone and REF.exists()) else {}
        wav = m.generate(text=text, language_id="ar", **kw)
    except Exception as e:
        raise HTTPException(500, f"synthesis failed: {e}")
    buf = io.BytesIO()
    sf.write(buf, wav.squeeze(0).cpu().numpy(), m.sr, format="WAV")
    print(f"[tts_worker] {len(text)} chars in {time.time()-t0:.1f}s", flush=True)
    return Response(buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    get_model()  # warm before accepting traffic
    uvicorn.run(app, host="127.0.0.1", port=8001)
