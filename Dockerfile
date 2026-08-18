# Jarvis X — single-container image.
#
# Runs Ollama + hermes-api together via supervisord, mirroring the real
# deployment model this project already uses on bare metal
# (config/supervisord.conf) -- NOT two separate compose services, on
# purpose: code/local.js, code/vision.js, and hermes.py all call Ollama at
# a hardcoded http://127.0.0.1:11434 / http://localhost:11434 (no
# OLLAMA_HOST env var support), so a sibling "ollama" container would be
# unreachable by hostname from this app's code without modifying those
# files. Containerizing the existing single-host supervisord setup avoids
# that change entirely. See DEPLOY.md for the reasoning and the documented
# future path if true service separation is ever wanted.
#
# Expect this image to be LARGE (likely 12-15GB+): the Ollama model store
# alone is ~8.6GB (qwen2.5:3b/7b, moondream, nomic-embed-text) and
# bootstrap/requirements-venv-ai.txt's CPU torch/transformers/spaCy/Coqui
# stack is another ~3.8GB. This is inherent to a local-first AI stack, not
# a packaging mistake -- don't try to slim this without understanding
# what functionality (TTS/STT/vision) would break.
FROM node:20-bookworm-slim AS node-stage

FROM python:3.11-slim-bookworm

# System packages: build tooling for the Python C-extension wheels in
# requirements-venv-ai.txt, ffmpeg for TTS/STT/MoviePy, supervisor for
# process management (matches config/supervisord.conf's real usage), curl
# for the Ollama installer + healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ffmpeg curl git jq supervisor \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# Copy Node.js 20 from the official node image rather than re-adding
# nodesource's apt repo inside this image -- fewer moving parts, same
# version bootstrap/install.sh installs on bare metal.
COPY --from=node-stage /usr/local/bin/node /usr/local/bin/node
COPY --from=node-stage /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# zstd: ollama's own install.sh hard-requires it for extraction (confirmed
# via a real build attempt -- "ERROR: This version requires zstd for
# extraction" otherwise). Kept as its own RUN rather than folded into the
# earlier apt-get line above, so adding it doesn't bust that layer's cache
# and force re-installing ffmpeg's large dependency tree on every rebuild.
RUN apt-get update && apt-get install -y --no-install-recommends zstd \
  && rm -rf /var/lib/apt/lists/*

# Ollama itself (the binary only -- models are pulled at container start
# into a volume-backed directory, not baked into this image layer, so a
# rebuild doesn't re-download 8.6GB every time).
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

# Python deps first (changes less often than app code -- better layer
# caching). Matches bootstrap/install.sh's real install command, plus
# --no-cache-dir: confirmed via a real build attempt that pip's build-time
# wheel cache (downloaded .whl + unpacked site-packages coexisting
# simultaneously) roughly doubles peak disk usage during this one step --
# went from 11GB free to under 1.5GB and triggered a disk-safety abort.
# The cache serves no purpose in a throwaway Docker layer anyway (not
# reused across separate `docker build` invocations without BuildKit cache
# mounts, which this Dockerfile doesn't use) -- disabling it costs nothing
# functionally.
COPY bootstrap/requirements-venv-ai.txt bootstrap/requirements-venv-ai.txt
ENV VENV_PATH=/root/venv-ai
RUN python3 -m venv "$VENV_PATH" \
  && "$VENV_PATH/bin/pip" install --no-cache-dir --upgrade pip \
  && "$VENV_PATH/bin/pip" install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
       -r bootstrap/requirements-venv-ai.txt \
  && "$VENV_PATH/bin/pip" install --no-cache-dir --no-deps kokoro-onnx==0.3.9 kokoro-tts==2.3.1

# Node deps (root workspace + packages/model-gateway via the workspaces
# field) -- packages/ must be copied before `npm ci` runs: the root
# package.json declares workspaces: ["packages/*"], and npm validates the
# lockfile against the on-disk workspace structure, not just package.json.
COPY package.json package-lock.json ./
COPY packages/ packages/
RUN npm ci --omit=dev

# Frontend: install + build web/'s production bundle, served by app.py
# directly from web/dist (same as the real deployment -- see app.py's
# WEB_DIST constant).
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix web
COPY web/ web/
RUN npm run build --prefix web

# Everything else
COPY . .

# supervisord config adapted for the container filesystem (HOME=/root
# instead of /home/ahmedyidris, venv path from $VENV_PATH, ollama's model
# store on a named volume so it survives container recreation).
COPY docker/supervisord.conf /etc/supervisor/conf.d/jarvis-x.conf

EXPOSE 8000 11434

ENTRYPOINT ["docker/entrypoint.sh"]
