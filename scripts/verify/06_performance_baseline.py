#!/usr/bin/env python3
"""Phase 1A Task 6: record concrete numbers -- startup time, per-decision
latency (from ~/.hermes/state.db), a point-in-time RSS reading during
active generation (not a true memory ceiling -- see measure_memory()'s
docstring/comments), and video-gen wall-clock."""
import getpass
import json
import sqlite3
import subprocess
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
SUPERVISORCTL = ["supervisorctl", "-c", "config/supervisord.conf"]
DB_PATH = Path.home() / ".hermes" / "state.db"
REPO = Path(__file__).resolve().parents[2]

# hermes-api runs from the MAIN checkout (see config/supervisord.conf's
# `directory=/home/ahmedyidris/jarvis-x`), and app.py derives PHASE_B_ROOT /
# CONTENT_ROOT relative to its own file location -- i.e. the main checkout,
# not this worktree. Real generated letters land under the main checkout's
# automation/phase-b/.../output/letters, so that is where this script must
# look too, or it will diff against a stale/irrelevant copy in the worktree.
MAIN_CHECKOUT = Path("/home/ahmedyidris/jarvis-x")


def measure_startup():
    subprocess.run(SUPERVISORCTL + ["stop", "hermes-api"], check=True)
    time.sleep(1)
    start = time.time()
    subprocess.run(SUPERVISORCTL + ["start", "hermes-api"], check=True)
    while True:
        try:
            if requests.get(f"{BASE}/api/status", timeout=2).ok:
                break
        except requests.exceptions.RequestException:
            pass
        time.sleep(0.5)
    return round(time.time() - start, 2)


def measure_decision_latency():
    conn = sqlite3.connect(str(DB_PATH))
    rows = conn.execute("SELECT latency_ms FROM conversations ORDER BY timestamp DESC LIMIT 50").fetchall()
    conn.close()
    vals = sorted(r[0] for r in rows if r[0] is not None)
    if not vals:
        return {"n": 0, "note": "no conversation rows with latency_ms yet -- run some /api/ask queries first"}
    n = len(vals)
    p95 = vals[min(n - 1, int(n * 0.95))]
    return {"n": n, "min_ms": vals[0], "max_ms": vals[-1], "avg_ms": round(sum(vals) / n, 1), "p95_ms": p95}


def measure_memory(owner):
    # This host's process table is not private to the jarvis-x deployment:
    # `pgrep -f "uvicorn app:app"` / `"ollama serve"` (as in the original
    # brief) also matched an unrelated root-owned pair of processes in a
    # separate Docker container (confirmed via /proc/<pid>/cgroup showing a
    # `/docker/...` path, distinct from this host's own cgroup) that happen
    # to share the same command substrings -- inflating hermes_api_mb by
    # ~190MB and ollama_mb by ~23MB in an initial run. The real jarvis-x
    # services are supervised and run as the current user, so restricting
    # pgrep to that user (`-u`) excludes the unrelated container processes
    # while still matching by command substring.
    #
    # "ollama serve" alone only matches ollama's own long-lived supervisor
    # process -- it does NOT match the separate child process that actually
    # holds a loaded model's weights in memory. Confirmed live via
    # `ps aux | grep -i ollama` while a `letters` generation job was in
    # flight: a second, transient process appeared --
    # `/usr/local/lib/ollama/llama-server --model ... --port 46445 ...` --
    # using ~2.05GB RSS, versus the `ollama serve` supervisor's ~40-60MB.
    # That path still contains the substring "ollama", so broadening the
    # pattern from "ollama serve" to plain "ollama" (still owner-scoped)
    # catches both the supervisor and the runner child without also
    # re-admitting the unrelated Docker container (which is owned by root,
    # already excluded by `-u`).
    def rss_mb(pattern):
        out = subprocess.run(["pgrep", "-u", owner, "-f", pattern], capture_output=True, text=True).stdout.split()
        total = 0
        for pid in out:
            try:
                total += int(subprocess.run(["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True).stdout.strip())
            except (ValueError, subprocess.CalledProcessError):
                pass
        return round(total / 1024, 1)
    return {"hermes_api_mb": rss_mb("uvicorn app:app"), "ollama_mb": rss_mb("ollama")}


def measure_video_gen_wallclock_and_memory():
    """Trigger the `letters` vertical (fastest real generation job, ~60-75s)
    and sample memory once partway through, while a model is actually
    loaded and generating. The original brief called measure_memory() in
    main() *before* this function ran at all -- i.e. before any model had
    ever been loaded -- so its "memory ceiling" numbers were always an idle
    sample, never a ceiling. This still isn't a true ceiling (a single
    sample mid-job, not a peak-over-time observation), just a real
    point-in-time RSS reading taken while generation is actually in
    flight, which is what the returned dict's memory_note says."""
    owner = getpass.getuser()
    letters_dir = MAIN_CHECKOUT / "automation" / "phase-b" / "stages" / "01_source_content" / "output" / "letters"
    before = {f.name for f in letters_dir.glob("*.json")} if letters_dir.is_dir() else set()
    r = requests.post(f"{BASE}/api/dashboard/generate/letters", timeout=10)
    if r.status_code != 200:
        return (
            {"error": f"generate/letters returned {r.status_code}"},
            {"hermes_api_mb": None, "ollama_mb": None, "note": "generate call failed -- memory not sampled during a real job"},
        )
    start = time.time()
    memory_sample = None
    while time.time() - start < 340:
        if memory_sample is None:
            # Sample on the very first pass, before checking job status, so
            # even a fast job (letters has finished in as little as ~58s in
            # practice) is caught mid-flight rather than after it's done.
            memory_sample = measure_memory(owner)
        ov = requests.get(f"{BASE}/api/dashboard/overview", timeout=10).json()
        job = ov["jobs"].get("letters")
        if job and job.get("status") in ("done", "failed", "timeout", "error"):
            return {"status": job["status"], "wallclock_s": round(time.time() - start, 1)}, memory_sample
        time.sleep(5)
    return {"status": "still_running_after_340s", "wallclock_s": 340}, memory_sample


def main():
    letters_video_gen, memory = measure_video_gen_wallclock_and_memory()
    results = {
        "startup_s": measure_startup(),
        "decision_latency_ms": measure_decision_latency(),
        "memory": memory,
        "memory_note": (
            "point-in-time RSS sampled during an active `letters` generation "
            "job (not before -- a model was actually loaded and generating "
            "at sample time), broadened to also match ollama's separate "
            "runner/llama-server child process, not just its own supervisor "
            "process. Not a true ceiling: a single sample, not a peak-over-"
            "time observation."
        ),
        "letters_video_gen": letters_video_gen,
    }
    print(json.dumps(results, indent=2))
    out = REPO / "scripts" / "verify" / "output" / "06_performance_baseline.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
