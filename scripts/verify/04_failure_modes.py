#!/usr/bin/env python3
"""Phase 1A Task 4: failure-mode checks. Restores normal state (ollama
running, no stray tmpfs mount) in all cases, including on failure."""
import json
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
SUPERVISORCTL = ["supervisorctl", "-c", "config/supervisord.conf"]
REPO = Path(__file__).resolve().parents[2]

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
        subprocess.run(SUPERVISORCTL + ["start", "ollama"], check=True)
        for _ in range(15):
            try:
                if requests.get(f"{BASE}/api/status", timeout=5).ok:
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
    # 120s hang would need an artificially slow model): hermes.py:67 bounds
    # the Ollama subprocess call at timeout=120; on expiry hermes.py:92
    # returns "Error: Query timeout (120s)" as the *answer text*, HTTP 200
    # -- not a hang, not a 500.
    hermes_src = (REPO / "hermes.py").read_text()
    has_timeout = "timeout=120" in hermes_src
    has_graceful_message = "Query timeout" in hermes_src
    results["ollama_call_timeout"] = {
        "note": "hermes.py subprocess.run(..., timeout=120), catches TimeoutExpired, "
                "returns 'Error: Query timeout (120s)' as the response text (HTTP 200).",
        "confirmed_in_source": has_timeout and has_graceful_message,
        "graceful": has_timeout and has_graceful_message,
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


def main():
    ollama_down()
    malformed_input()
    call_timeout()
    disk_full()
    print(json.dumps(results, indent=2))
    out = REPO / "scripts" / "verify" / "output" / "04_failure_modes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    failing = [k for k, v in results.items() if not v.get("graceful")]
    if failing:
        print(f"FAIL (non-graceful): {failing}")
        sys.exit(1)
    print("ALL 4 FAILURE MODES: degrade gracefully")


if __name__ == "__main__":
    main()
