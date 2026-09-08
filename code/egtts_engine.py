#!/usr/bin/env python3
"""
Egyptian Arabic TTS via EGTTS-V0.1 (XTTS-v2 fine-tune, voice-cloned to Ahmed).

Async/slow path only — checkpoint load takes 90-220s, and synthesis runs
~3-10x slower than real-time on this CPU. Not suitable for live
conversational replies; intended for intentional, one-off Egyptian Arabic
generation requests. Callers on an event loop (see app.py) must dispatch
`synthesize()` off-thread (e.g. via asyncio.to_thread) — it blocks.

The model stays resident once loaded (lazy-start on first call) and
auto-unloads after EGTTS_IDLE_TIMEOUT_SEC of inactivity to free the RAM
it holds (measured ~3-7GB while loaded).

Model checkpoint and reference audio paths are configurable via env vars
so this can point somewhere else on a different machine/platform without
code changes — see EGTTS_MODEL_DIR / EGTTS_REFERENCE_AUDIO below.
"""
import io
import os
import threading
import time
from pathlib import Path

MODEL_DIR = os.getenv("EGTTS_MODEL_DIR", "/mnt/chromeos/MyFiles/egtts-v0.1")
REFERENCE_AUDIO = os.getenv(
    "EGTTS_REFERENCE_AUDIO",
    str(Path(__file__).resolve().parent.parent / "models" / "egtts" / "reference_ahmed.wav"),
)
IDLE_TIMEOUT_SEC = int(os.getenv("EGTTS_IDLE_TIMEOUT_SEC", str(10 * 60)))

# Confirmed-best generation settings from manual tuning (2026-08-13) —
# see project memory "egtts-egyptian-arabic-followup" for the full
# experiment trail (why these specific values, and what was ruled out).
# Don't change without re-testing by ear; XTTS accent/quality is sensitive
# to these in ways that aren't obvious from the numbers alone.
GENERATION_PARAMS = dict(
    temperature=0.3,
    top_k=20,
    top_p=0.7,
    repetition_penalty=8.0,
)
# The first fraction of a second of output is a known XTTS artifact
# (garbled/unintelligible before generation "settles") — always discarded.
TRIM_SECONDS = float(os.getenv("EGTTS_TRIM_SECONDS", "1.8"))
SAMPLE_RATE = 24000

_lock = threading.Lock()
_state = {"model": None, "gpt_cond_latent": None, "speaker_embedding": None, "last_used": 0.0}
_unload_thread_started = False


def _patch_torchaudio():
    """torchaudio.load() in this environment routes through torchcodec,
    which needs system FFmpeg shared libraries that aren't installed here.
    Redirect to soundfile instead (already a dependency, no ffmpeg needed).
    """
    import soundfile as sf
    import torch
    import torchaudio

    def _load_via_soundfile(path, *args, **kwargs):
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        return torch.from_numpy(data.T), sr

    torchaudio.load = _load_via_soundfile


def _load():
    """Load the checkpoint and compute speaker latents. Expensive (90-220s)."""
    import torch

    torch.set_num_threads(8)
    _patch_torchaudio()

    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts

    config = XttsConfig()
    config.load_json(f"{MODEL_DIR}/config.json")
    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=MODEL_DIR, use_deepspeed=False)
    model.cpu()
    model.eval()

    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
        audio_path=[REFERENCE_AUDIO]
    )
    return model, gpt_cond_latent, speaker_embedding


def _ensure_unload_watcher():
    """Start the idle-unload background thread once per process."""
    global _unload_thread_started
    if _unload_thread_started:
        return
    _unload_thread_started = True

    def _watch():
        while True:
            time.sleep(30)
            with _lock:
                idle_for = time.time() - _state["last_used"]
                if _state["model"] is not None and idle_for > IDLE_TIMEOUT_SEC:
                    _state["model"] = None
                    _state["gpt_cond_latent"] = None
                    _state["speaker_embedding"] = None

    threading.Thread(target=_watch, daemon=True, name="egtts-idle-unload").start()


def is_loaded() -> bool:
    with _lock:
        return _state["model"] is not None


def synthesize(text: str) -> bytes:
    """Synthesize `text` (Egyptian Arabic) in the cloned reference voice.

    Returns WAV bytes. BLOCKING and slow: ~15-90s once warm, up to ~5
    minutes on a cold first call (checkpoint load + synthesis). The lock
    is held for the full inference call by design — this is a single CPU
    resource, so concurrent requests should queue, not contend for cores.
    """
    _ensure_unload_watcher()
    with _lock:
        if _state["model"] is None:
            model, gpt_cond_latent, speaker_embedding = _load()
            _state["model"] = model
            _state["gpt_cond_latent"] = gpt_cond_latent
            _state["speaker_embedding"] = speaker_embedding

        model = _state["model"]
        gpt_cond_latent = _state["gpt_cond_latent"]
        speaker_embedding = _state["speaker_embedding"]

        out = model.inference(
            text=text,
            language="ar",
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            **GENERATION_PARAMS,
        )
        _state["last_used"] = time.time()

    import numpy as np
    import soundfile as sf

    wav = np.array(out["wav"])
    trim_samples = int(TRIM_SECONDS * SAMPLE_RATE)
    if len(wav) > trim_samples:
        wav = wav[trim_samples:]

    buffer = io.BytesIO()
    sf.write(buffer, wav, SAMPLE_RATE, format="wav")
    return buffer.getvalue()
