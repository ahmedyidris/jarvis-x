#!/usr/bin/env python3
"""Phase 1A Task 4: failure-mode checks. Restores normal state (ollama
running, no stray tmpfs mount) in all cases, including on failure."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
SUPERVISORCTL = ["supervisorctl", "-c", "config/supervisord.conf"]
REPO = Path(__file__).resolve().parents[2]
# hermes-api (per config/supervisord.conf: `directory=/home/ahmedyidris/jarvis-x`,
# `uvicorn app:app`) runs from the MAIN checkout, not necessarily from
# wherever this script happens to be checked out -- call_timeout() reads
# hermes.py to check a property of the *live* service, so it must read the
# main checkout's copy, not this script's own REPO-relative one (they are
# byte-identical today, but that's not guaranteed to stay true).
LIVE_ROOT = Path("/home/ahmedyidris/jarvis-x")

results = {}


def ollama_down():
    print("--- 4.1 Ollama down ---")
    subprocess.run(SUPERVISORCTL + ["stop", "ollama"], check=True)
    try:
        r = requests.post(f"{BASE}/api/ask", json={"question": "ping", "tier": "local"}, timeout=15)
        results["ollama_down"] = {
            "status_code": r.status_code,
            "leaked_traceback": "Traceback" in r.text,
            "body": r.text[:500],
            "graceful": r.status_code in (500, 503) and "Traceback" not in r.text,
        }
    finally:
        # Restart ollama, but don't let a failure *here* raise inside this
        # finally block and replace/swallow whatever exception (if any) is
        # already propagating from the try block above.
        try:
            subprocess.run(SUPERVISORCTL + ["start", "ollama"], check=True)
        except subprocess.CalledProcessError as e:
            print(f"ERROR: failed to restart ollama via supervisorctl: {e}", file=sys.stderr)
        # Poll ollama's own health endpoint directly -- BASE (hermes-api,
        # :8000) never went down in this test, so polling it here would just
        # pass on the first check without ever confirming ollama itself came
        # back up. http://localhost:11434/api/tags is ollama's real endpoint.
        for _ in range(15):
            try:
                if requests.get("http://localhost:11434/api/tags", timeout=5).ok:
                    break
            except requests.exceptions.RequestException:
                pass
            time.sleep(1)


def malformed_input():
    print("--- 4.2 Malformed input (missing required 'question' field) ---")
    r = requests.post(f"{BASE}/api/ask", json={"tier": "local"}, timeout=10)
    results["malformed_input"] = {
        "status_code": r.status_code,
        "graceful": r.status_code == 422,  # pydantic validation, not a 500/crash
        "body": r.text[:300],
    }


def call_timeout():
    print("--- 4.3 Ollama call timeout ceiling ---")
    # Verified by reading the code, not reproduced live (forcing a real
    # 120s hang would need an artificially slow model): hermes.py bounds the
    # Ollama subprocess call at timeout=120 and raises HermesBackendError on
    # expiry. Updated 2026-08-23 (P6 fix, b985d2e): this used to surface as
    # "Error: Query timeout (120s)" answer text over HTTP 200; app.py's
    # /api/ask now catches HermesBackendError and returns 503 instead.
    hermes_src = (LIVE_ROOT / "hermes.py").read_text()
    has_timeout = "timeout=120" in hermes_src
    has_graceful_message = "Query timeout" in hermes_src
    raises_backend_error = "raise HermesBackendError" in hermes_src
    results["ollama_call_timeout"] = {
        "note": "hermes.py subprocess.run(..., timeout=120), catches TimeoutExpired, "
                "raises HermesBackendError('Query timeout (120s)'); app.py's /api/ask "
                "turns that into HTTP 503 (was 200 with the error folded into answer "
                "text, before the P6 fix).",
        "confirmed_in_source": has_timeout and has_graceful_message and raises_backend_error,
        "graceful": has_timeout and has_graceful_message and raises_backend_error,
    }


def disk_full():
    print("--- 4.4 Disk full (simulated via a throwaway 1MB tmpfs, not the real disk) ---")
    mount_point = "/tmp/jarvis-verify-diskfull"
    subprocess.run(["mkdir", "-p", mount_point], check=True)
    subprocess.run(["sudo", "mount", "-t", "tmpfs", "-o", "size=1m", "tmpfs", mount_point], check=True)
    corrupted = True
    errno_val = None
    try:
        target = Path(mount_point) / "test_output.json"
        try:
            with open(target, "w") as f:
                f.write("x" * 5_000_000)  # 5MB into a 1MB tmpfs
        except OSError as e:
            corrupted = False
            errno_val = e.errno
        results["disk_full"] = {
            "graceful": not corrupted,
            "errno": errno_val,
            "errno_was_enospc": errno_val == 28,
            "note": ("write raised OSError(ENOSPC) as expected -- no half-written file left"
                      if not corrupted else "write did NOT raise -- investigate"),
        }
    finally:
        subprocess.run(["sudo", "umount", mount_point], check=True)
        subprocess.run(["rmdir", mount_point], check=True)


def disk_full_real_pipeline():
    """P8 (REMAINING_WORK.md): disk_full() above only proves Python's own
    OSError(ENOSPC) behavior in *this script's* process -- it says nothing
    about the real pipeline. This mounts a tiny tmpfs directly onto the
    `letters` vertical's real output directory (shadowing, not deleting,
    whatever's already there -- unmounting restores the original files
    exactly), pre-fills it near capacity, then fires a real
    POST /api/dashboard/generate/letters and inspects both the job status
    and whatever file content_generator.py's non-atomic
    `out_path.write_text(...)` left behind."""
    print("--- 4.5 Disk full during a REAL generation job (letters vertical) ---")
    letters_dir = LIVE_ROOT / "automation" / "phase-b" / "stages" / "01_source_content" / "output" / "letters"
    mount_point = str(letters_dir)
    subprocess.run(["sudo", "mount", "-t", "tmpfs", "-o", "size=4k", "tmpfs", mount_point], check=True)
    try:
        # Real letter_*.json files are 250-400 bytes; leave far less than
        # that free so the write can't possibly complete.
        (letters_dir / "_filler").write_bytes(b"x" * 3900)

        r = requests.post(f"{BASE}/api/dashboard/generate/letters", timeout=15)
        started = r.status_code == 200

        status = None
        output_tail = None
        for _ in range(60):  # one real Ollama call -- give it real time
            overview = requests.get(f"{BASE}/api/dashboard/overview", timeout=10).json()
            job = overview.get("jobs", {}).get("letters")
            if job and job.get("status") != "running":
                status = job.get("status")
                output_tail = job.get("output_tail")
                break
            time.sleep(2)

        left_over = [f.name for f in letters_dir.iterdir() if f.name != "_filler"]
        partial_file_bytes = None
        if left_over:
            partial_file_bytes = (letters_dir / left_over[0]).stat().st_size

        results["disk_full_real_pipeline"] = {
            "job_started": started,
            "job_status": status,
            "job_reported_failure": status in ("failed", "error", "timeout"),
            "output_tail": (output_tail or "")[-500:],
            "partial_files_left_behind": left_over,
            "partial_file_bytes": partial_file_bytes,
            # Graceful = the job status honestly says it didn't work. A
            # partial/empty file left on disk is a separate, real finding
            # (write_text() isn't atomic) -- recorded above, not what
            # "graceful" gates on here, since a truncated file the job
            # itself correctly flags as failed isn't silently lying to
            # anyone the way a false "done" would be.
            "graceful": started and status in ("failed", "error", "timeout"),
        }
    finally:
        subprocess.run(["sudo", "umount", mount_point], check=True)


def main():
    # SUPERVISORCTL uses a bare relative "config/supervisord.conf" -- cd to
    # this script's repo root first (same pattern as 01_electron_build.sh /
    # 05_recovery_test.sh) so that resolves correctly regardless of the
    # directory this script happened to be invoked from.
    os.chdir(REPO)
    ollama_down()
    malformed_input()
    call_timeout()
    disk_full()
    disk_full_real_pipeline()
    print(json.dumps(results, indent=2))
    out = REPO / "scripts" / "verify" / "output" / "04_failure_modes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    failing = [k for k, v in results.items() if not v.get("graceful")]
    if failing:
        print(f"FAIL (non-graceful): {failing}")
        sys.exit(1)
    print(f"ALL {len(results)} FAILURE MODES: degrade gracefully")


if __name__ == "__main__":
    main()
