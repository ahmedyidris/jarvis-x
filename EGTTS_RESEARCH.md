# Egyptian TTS Research: OmarSamir/EGTTS-V0.1

## Model Status
- Exists on HuggingFace: YES (XTTS-v2 variant)
- Type: XTTS-v2 (Coqui TTS fork)
- Size: ~1GB model + dependencies

## CPU Viability
- GPU required: **YES** (CUDA 13+)
- Latency on CPU: Not applicable
- Install method: pip install TTS (pulls torch CUDA)

## License
- Commercial use: Apache 2.0 (allowed)

## Findings
TTS library requires torch with CUDA support. Crostini (Chromebook) is CPU-only and lacks libcudart.so.13. EGTTS cannot run locally on this hardware.

## Decision
- ✅ **v1.1:** Integrate ElevenLabs API as cloud fallback for Egyptian
- ✅ **v1.2+:** Evaluate CPU-only TTS alternatives (e.g., lightweight espeak-ng Egyptian)
- ❌ **Local:** Not viable on Chromebook

---

**Next Steps:** Use cloud service (ElevenLabs, OpenAI TTS, or Google Cloud TTS) for Egyptian audio post-v1.
