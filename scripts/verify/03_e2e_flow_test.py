#!/usr/bin/env python3
"""Phase 1A Task 3: one scripted E2E path -- query (trigger) -> agent
decision (which letter) -> content+TTS+video render -> API response
confirms the artifact. Exits non-zero on any assertion failure.

NOTE: hermes-api runs from the main checkout (/home/ahmedyidris/jarvis-x),
per config/supervisord.conf's `directory=/home/ahmedyidris/jarvis-x` --
not from whatever worktree this verify script happens to live in. All
generated content and rendered video therefore land under the main
checkout's automation/phase-b/... tree regardless of where this script
is executed from. LIVE_ROOT is pinned there explicitly (the same fix
Task 2 already made and verified) rather than derived from
Path(__file__).resolve().parents[2], which would silently point at the
wrong tree when this script runs from a worktree.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
LIVE_ROOT = Path("/home/ahmedyidris/jarvis-x")
CONTENT_DIR = LIVE_ROOT / "automation" / "phase-b" / "stages" / "01_source_content" / "output" / "letters"
RENDER_DIR = LIVE_ROOT / "automation" / "phase-b" / "stages" / "02_render_video" / "output" / "letters"


def step(msg):
    print(f"\n=== {msg} ===", flush=True)


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def main():
    step("1. Baseline state before triggering generation")
    before = {f.name for f in CONTENT_DIR.glob("*.json")} if CONTENT_DIR.is_dir() else set()

    step("2. Agent decision: POST /api/dashboard/generate/letters")
    r = requests.post(f"{BASE}/api/dashboard/generate/letters", timeout=10)
    if r.status_code != 200:
        fail(f"generate/letters returned {r.status_code}: {r.text}")
    job_id = r.json().get("job_id")
    if job_id != "letters":
        fail(f"expected job_id='letters', got {job_id!r}")

    step("3. Poll until content+video render completes (up to 340s)")
    start = time.time()
    job = None
    while time.time() - start < 340:
        ov = requests.get(f"{BASE}/api/dashboard/overview", timeout=10).json()
        job = ov["jobs"].get("letters")
        if job and job.get("status") in ("done", "failed", "timeout", "error"):
            break
        time.sleep(5)
    if job is None or job.get("status") != "done":
        fail(f"job did not complete cleanly: {job}")
    print(f"job done in {time.time() - start:.0f}s")

    step("4. Identify which letter this run generated")
    after = {f.name for f in CONTENT_DIR.glob("*.json")}
    new = after - before
    if len(new) != 1:
        fail(f"expected exactly 1 new content file, got {new}")
    content_file = new.pop()
    letter = content_file.replace("letter_", "").replace(".json", "")
    print(f"generated letter: {letter}")

    step("5. Content artifact: valid JSON, expected shape")
    data = json.loads((CONTENT_DIR / content_file).read_text())
    if "letter" not in data:
        fail(f"content JSON missing expected key 'letter': {list(data.keys())}")
    if data["letter"] != letter:
        fail(f"content JSON letter={data['letter']!r} != filename letter={letter!r}")

    step("6. Video artifact: exists, non-trivial size, has an audio track (TTS)")
    video = RENDER_DIR / f"letter_{letter}.mp4"
    if not video.is_file():
        fail(f"expected video at {video}, not found")
    size = video.stat().st_size
    if size < 10_000:
        fail(f"video file suspiciously small ({size} bytes) -- likely corrupt/empty")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "json", str(video)],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        fail(f"ffprobe failed: {probe.stderr}")
    streams = json.loads(probe.stdout).get("streams", [])
    if not streams:
        fail("video has no audio stream -- TTS narration did not make it into the render")
    print(f"video ok: {size} bytes, {len(streams)} audio stream(s)")

    step("7. API response: read the artifact back through the dashboard API")
    r = requests.get(f"{BASE}/api/dashboard/content/letters/{content_file}", timeout=10)
    if r.status_code != 200:
        fail(f"GET content/{content_file} returned {r.status_code}")
    if r.json().get("letter") != letter:
        fail("content served via API doesn't match the file on disk")
    r = requests.get(f"{BASE}/api/dashboard/video/letters/letter_{letter}.mp4", timeout=15)
    if r.status_code != 200:
        fail(f"GET video/letter_{letter}.mp4 returned {r.status_code}")

    print("\n=== E2E FLOW: PASS (query -> decision -> content+TTS+video -> API response) ===")


if __name__ == "__main__":
    main()
