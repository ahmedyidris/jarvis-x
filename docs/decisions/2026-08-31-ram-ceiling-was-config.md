# 2026-08-31 — RAM ceiling was config, not hardware

- Docker daemon + weft-local-postgres container (created during repo install run) drove load avg to 15-25 on 8 cores
- Stopped and disabled docker/containerd -> load avg 0.11
- SILMA-9B: 28s cold, 4.5s warm. Previous "8-minute Arabic latency" was CPU contention + repeated cold starts, not a RAM wall
- Set OLLAMA_KEEP_ALIVE=30m, OLLAMA_MAX_LOADED_MODELS=1 via /etc/systemd/system/ollama.service.d/override.conf
- GPU purchase DEFERRED - premise falsified
- Backed up voices/chatterbox-eg + voices/ahmed to ~/chatterbox-eg-backup.tar.gz

## Still open
- tts_worker.py holds 4.7GB resident at idle - lazy-load candidate
- uvicorn app:app at 3.48GB - possible leak
- jarvis-v4/, jarvis-dashboard/, dashboard/ in repo root - parallel builds, origin unknown
- Disk 89% full, ~6.5GB of cloned repos inside ~/jarvis-x

## Root cause found
- config/supervisord.conf [program:ollama] set OLLAMA_KEEP_ALIVE="0"
- Forced a full model unload after every request -> ~28s cold start on EVERY query
- Combined with Docker CPU contention, this is the "8-minute Arabic latency"
- Stanza renamed to [program:ollama_DISABLED]; systemd is now the sole owner
- Lesson: two process managers competing for one port. Neither config was authoritative.
