#!/usr/bin/env python3
"""Phase 1A Task 2: prove each of the 4 real verticals produces real output.
Run with: ~/venv-ai/bin/python3 scripts/verify/02_verticals_output.py [vertical ...]
With no args, runs all 4 (can take up to ~1.5h sequentially -- pass specific
vertical names to check one at a time instead).
"""
import json, sys, time
from pathlib import Path
import requests

BASE = "http://localhost:8000"
REPO = Path(__file__).resolve().parents[2]
# hermes-api (per config/supervisord.conf: `directory=/home/ahmedyidris/jarvis-x`,
# `uvicorn app:app`) runs from the MAIN checkout, not from this git worktree --
# app.py's PHASE_B_ROOT is `Path(__file__).parent / "automation" / "phase-b"`,
# i.e. relative to wherever app.py itself lives. This script writes its own
# output (REPO-relative, into this worktree per the task's file layout) but
# must read generated content from where the live service actually writes it.
LIVE_ROOT = Path("/home/ahmedyidris/jarvis-x")
CONTENT_ROOT = LIVE_ROOT / "automation" / "phase-b" / "stages" / "01_source_content" / "output"
RENDER_ROOT = LIVE_ROOT / "automation" / "phase-b" / "stages" / "02_render_video" / "output"

# max seconds to wait for each vertical's generate job -- 340s for letters'
# two-script chain (300s timeout + margin), 1830s for the other three's
# single Ollama-backed call (app.py's _run_generator_job: 300s / 1800s)
VERTICALS = {
    "letters": 340,
    "economic_facts": 1830,
    "commodities_macro": 1830,
    "geopolitical_risk": 1830,
}

# How much of headline_fact/narration_script to snapshot verbatim into this
# script's own output JSON. This is the only durable copy of what a manual
# review actually judged -- the generated files themselves live under the
# main checkout and get unconditionally overwritten by the next run of
# economic_facts/commodities_macro/geopolitical_risk (see existing_files()'s
# docstring). 400 chars comfortably covers every narration_script observed so
# far (all under 300 chars) with margin; if a future narration_script runs
# long enough that a numeric claim near the end gets cut off, raise this.
EXCERPT_LEN = 400


def existing_files(vertical):
    """Snapshot {filename: mtime_ns} for a vertical's content dir.

    Filename-existence alone isn't enough: `letters` mints a new filename
    per run (content_generator.py's _next_letter_to_generate), but
    economic_facts/commodities_macro/geopolitical_risk each iterate a fixed,
    hardcoded SOURCED_FACTS list and generate_and_render_all() unconditionally
    overwrites every one of that list's filenames on every run (confirmed by
    reading geopolitical_risk_generator.py: `out_path.write_text(...)` with
    no existence check, and by their fact-count == existing-file-count in
    the repo). A plain before/after filename-set diff would report 0 new
    files -- a false FAIL -- for those 3 verticals even when the job did
    real work. mtime lets us see the overwrite.
    """
    d = CONTENT_ROOT / vertical
    return {f.name: f.stat().st_mtime_ns for f in d.glob("*.json")} if d.is_dir() else {}


def poll_job(vertical, max_wait):
    start = time.time()
    while time.time() - start < max_wait:
        r = requests.get(f"{BASE}/api/dashboard/overview", timeout=10)
        r.raise_for_status()
        job = r.json()["jobs"].get(vertical)
        if job and job.get("status") in ("done", "failed", "timeout", "error"):
            return job, time.time() - start
        time.sleep(5)
    return None, time.time() - start


def build_entry(vertical, name):
    """Build one new_files[] entry for content file `name` in `vertical`'s
    content dir: JSON validity, a durable excerpt of its key claims, and the
    matching rendered video's existence/size. Pulled out of run_vertical() so
    it can be exercised directly (e.g. against already-generated files)
    without re-triggering a real ~30min generation job."""
    path = CONTENT_ROOT / vertical / name
    try:
        data = json.loads(path.read_text())
        valid_json = True
    except json.JSONDecodeError:
        data, valid_json = None, False
    entry = {"file": str(path), "valid_json": valid_json, "keys": list(data.keys()) if data else []}
    if data:
        # Durable evidence for manual-review claims (numeric fidelity etc.)
        # that outlives the next run overwriting these files on disk.
        if "headline_fact" in data:
            entry["headline_fact_excerpt"] = data["headline_fact"][:EXCERPT_LEN]
        if "narration_script" in data:
            entry["narration_script_excerpt"] = data["narration_script"][:EXCERPT_LEN]
    # Video check for every vertical, not just letters: all 4 verticals'
    # generators (content_generator.py + video_renderer.py for letters;
    # generate_and_render_all() for the other 3) render to the SAME
    # filename stem under RENDER_ROOT/<vertical>/ as the content JSON
    # uses under CONTENT_ROOT/<vertical>/ -- confirmed by listing both
    # dirs for all 4 verticals (e.g. econ_egypt-inflation.json /
    # econ_egypt-inflation.mp4, georisk_us-china-trade-tariffs.json /
    # georisk_us-china-trade-tariffs.mp4, letter_D.json / letter_D.mp4).
    video = RENDER_ROOT / vertical / f"{Path(name).stem}.mp4"
    entry["video_path"] = str(video)
    entry["video_exists"] = video.is_file()
    entry["video_size_bytes"] = video.stat().st_size if video.is_file() else 0
    return entry


def run_vertical(vertical, max_wait):
    before = existing_files(vertical)
    r = requests.post(f"{BASE}/api/dashboard/generate/{vertical}", timeout=10)
    if r.status_code != 200:
        return {"vertical": vertical, "ok": False, "reason": f"POST generate returned {r.status_code}: {r.text}"}
    job, elapsed = poll_job(vertical, max_wait)
    if job is None:
        return {"vertical": vertical, "ok": False, "reason": f"job still running after {elapsed:.0f}s (limit {max_wait}s)"}
    if job["status"] != "done":
        return {"vertical": vertical, "ok": False, "reason": f"job status={job['status']}", "output_tail": job.get("output_tail", "")}
    after = existing_files(vertical)
    new_files = {name for name, mtime in after.items() if name not in before or mtime > before[name]}
    if not new_files:
        return {"vertical": vertical, "ok": False, "reason": "job reported done but no new/changed content file appeared"}
    result = {"vertical": vertical, "ok": True, "elapsed_s": round(elapsed, 1), "new_files": []}
    for name in new_files:
        result["new_files"].append(build_entry(vertical, name))
    return result


def main():
    wanted = sys.argv[1:] or list(VERTICALS.keys())
    unknown = [v for v in wanted if v not in VERTICALS]
    if unknown:
        print(f"unknown vertical(s): {unknown}. Valid: {list(VERTICALS.keys())}")
        sys.exit(2)
    results = []
    for vertical in wanted:
        print(f"--- generating: {vertical} (timeout {VERTICALS[vertical]}s) ---", flush=True)
        res = run_vertical(vertical, VERTICALS[vertical])
        print(json.dumps(res, indent=2), flush=True)
        results.append(res)
    out_dir = REPO / "scripts" / "verify" / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "02_verticals_output.json"
    existing = json.loads(out_path.read_text()) if out_path.is_file() else []
    merged = {r["vertical"]: r for r in existing}
    merged.update({r["vertical"]: r for r in results})
    out_path.write_text(json.dumps(list(merged.values()), indent=2))
    print(f"\nWrote {out_path}")
    failed = [r["vertical"] for r in results if not r["ok"]]
    if failed:
        print(f"FAIL: {failed}")
        sys.exit(1)
    print(f"{len(wanted)} vertical(s): job completed + new content file confirmed on disk")


if __name__ == "__main__":
    main()
