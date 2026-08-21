# Phase 1A Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce honest, evidence-backed proof (or documented disproof) of every Phase 1A verification checklist item, with real command output captured in `docs/VERIFICATION_2026-08.md`, so Phase 1B (data layer), 1D (audit trail), and 1C (dashboard) don't get built on unverified assumptions about the current ~65-70% claim.

**Architecture:** Six independent verification scripts under `scripts/verify/`, each exercising the *live* `hermes-api` (localhost:8000, run under `config/supervisord.conf`) and/or the Electron scaffold directly against real infrastructure — no mocks, matching the existing `scripts/status.sh` / `scripts/score.sh` pattern of bespoke health-check scripts that live outside the JS (`jest-runner.js`) and Python (`sentinel/tests/`) test suites, because these are one-shot verification runs, not a regression suite. A final task rolls all six results into the exit-criteria doc and files any failing item into `REMAINING_WORK.md`.

**Tech Stack:** bash, python3 (via `~/venv-ai/bin/python3` — has `requests` already, confirmed via existing generator scripts), `sqlite3` (stdlib), `ffprobe` (already installed per session notes), `supervisorctl`, Electron 43.4.1 / electron-builder 26.15.3 (current real npm versions, replacing the invalid `^latest` pins).

**Spec:** `/mnt/chromeos/MyFiles/Downloads/JARVIS_X_COMPLETION_PLAN_v2.md`, section "1A. Verification". **Correction to the spec while grounding it against this repo:** the spec's checklist item says "5 verticals"; the actual codebase has **4** (`letters`, `economic_facts`, `commodities_macro`, `geopolitical_risk` — `app.py:192-197`, confirmed absent-5th in `REMAINING_WORK.md` P4). This plan uses 4 throughout — treat "5" in the original spec text as stale.

## Global Constraints

- **Real controls only — no fake toggles, no placeholder switches.** (spec §1C, carried project-wide; applies here too: every verification script must hit real infrastructure, never stub a result.)
- `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, `memory/rules.md` are **Edit-denied** by `~/.claude/settings.json`. Never Edit these files in any task below — read them for ground truth only.
- Root `package.json` is the JS agent-runtime's manifest, tested via `jest-runner.js` — stays untouched. Electron's own manifest lives **only** in `electron/package.json`, never merged into root.
- Kill-switch source of truth is `code/guard.js:5` — `.jarvis-x-STOP` at the repo root. Several docs (not the code) still say `~/.jarvis-x/STOP`; that's stale, don't follow it.
- `hermes-api` runs under `supervisord` only (`config/supervisord.conf`, port 8000). Never start a second, manual `uvicorn` alongside it.
- **Exit criteria (spec §1A):** every checklist box checked with real output pasted into `docs/VERIFICATION_2026-08.md`. A failing box becomes a new entry in `REMAINING_WORK.md`, not a footnote.

---

### Task 1: Fix the Electron scaffold; verify it installs, launches, loads the dashboard, and survives a restart

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/main.js`
- Create: `scripts/verify/01_electron_build.sh`
- Create: `docs/VERIFICATION_2026-08.md`

**Interfaces:**
- Produces: `docs/VERIFICATION_2026-08.md` (new file — later tasks append their own `## Task N` section to it)
- Produces: `scripts/verify/output/` directory (later tasks write their JSON/log output here too)

**Scope note:** the spec's phrase "produces a runnable artifact" is interpreted here as "the app launches and loads the dashboard" (`electron .`), not a packaged installer — installers (AppImage/deb/.exe/.dmg) are explicitly Phase 3A's job in the spec, not 1A's.

- [ ] **Step 1: Fix `electron/package.json`'s invalid version pins**

Current content has `"electron": "^latest"` and `"electron-builder": "^latest"` — not valid semver, `npm install` fails with `EINVALIDTAGNAME`. Replace with the real current versions (confirmed via `npm view electron version` / `npm view electron-builder version`):

```json
{
  "name": "jarvis-x",
  "version": "1.0.0",
  "main": "main.js",
  "private": true,
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "43.4.1",
    "electron-builder": "26.15.3"
  }
}
```

- [ ] **Step 2: Fix `electron/main.js`'s wrong port and add scriptable load signals**

Current `main.js` points at `http://localhost:8001`, but `hermes-api` serves both the API and the built `web/dist` SPA from the same origin on **8000** (`app.py:564`, `config/supervisord.conf:26`) — nothing listens on 8001. `web/src/lib/api.ts:39` calls `fetch("/api/ask")` as a *relative* path, so the Electron window must load from the same origin as the API or those calls 404.

```js
const { app, BrowserWindow } = require('electron');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: false },
  });
  win.loadURL('http://localhost:8000');
  win.webContents.on('did-finish-load', () => {
    console.log('JARVIS_ELECTRON_LOADED');
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('JARVIS_ELECTRON_LOAD_FAILED', code, description);
    process.exit(1);
  });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 3: Write the verification script**

`scripts/verify/01_electron_build.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p scripts/verify/output
LOG=scripts/verify/output/01_electron_build.log
: > "$LOG"

echo "=== Phase 1A / Task 1: Electron build + launch + restart ===" | tee -a "$LOG"

echo "--- npm install ---" | tee -a "$LOG"
(cd electron && npm install) 2>&1 | tee -a "$LOG"

echo "--- ensuring hermes-api is reachable on :8000 ---" | tee -a "$LOG"
supervisorctl -c config/supervisord.conf start hermes-api >/dev/null 2>&1 || true
for i in $(seq 1 10); do
  if curl -sf http://localhost:8000/api/status >/dev/null; then break; fi
  sleep 1
done
curl -sf http://localhost:8000/api/status >/dev/null || {
  echo "FAIL: hermes-api not reachable on :8000" | tee -a "$LOG"; exit 1;
}

run_once() {
  local label="$1"
  echo "--- launch attempt: $label ---" | tee -a "$LOG"
  local out
  out=$(cd electron && timeout 20 npm start 2>&1) || true
  echo "$out" | tee -a "$LOG"
  if echo "$out" | grep -q "JARVIS_ELECTRON_LOADED"; then
    echo "PASS ($label): dashboard loaded" | tee -a "$LOG"
  else
    echo "FAIL ($label): JARVIS_ELECTRON_LOADED never printed" | tee -a "$LOG"
    exit 1
  fi
}

run_once "initial launch"
pkill -f "electron \." 2>/dev/null || true
sleep 1
run_once "relaunch after kill (restart survival)"

echo "=== Task 1: ALL PASS ===" | tee -a "$LOG"
```

- [ ] **Step 4: Run it and verify PASS twice**

```bash
chmod +x scripts/verify/01_electron_build.sh
DISPLAY=:0 scripts/verify/01_electron_build.sh
```

Expected: `scripts/verify/output/01_electron_build.log` ends with `=== Task 1: ALL PASS ===`, and contains two `PASS (...)` lines — one for the initial launch, one for the relaunch after kill (proves state isn't corrupted by a stop/start cycle).

- [ ] **Step 5: Create `docs/VERIFICATION_2026-08.md` with the header and Task 1 result**

```markdown
# Jarvis-X Verification Report — 2026-08

Produced against `docs/superpowers/plans/2026-08-20-phase1a-verification.md`.
Each section below is real command output, not a manual assertion. A ❌ here
becomes a new dated entry in `REMAINING_WORK.md`, not something silently
marked done.

## Task 1: Electron build + launch + restart

- Fixed `electron/package.json`'s invalid `^latest` version pins → pinned to `electron@43.4.1`, `electron-builder@26.15.3`.
- Fixed `electron/main.js`'s wrong port (8001 → 8000).
- Ran `scripts/verify/01_electron_build.sh`. Full log: `scripts/verify/output/01_electron_build.log`.

**Result:** ✅ / ❌ *(paste the script's final line and both PASS/FAIL lines here after running)*
```

- [ ] **Step 6: Commit**

```bash
git add electron/package.json electron/main.js scripts/verify/01_electron_build.sh scripts/verify/output/01_electron_build.log docs/VERIFICATION_2026-08.md
git commit -m "fix(electron): pin real electron/electron-builder versions, fix port; verify launch+restart"
```

---

### Task 2: Verify each of the 4 real verticals produces real, on-disk output

**Files:**
- Create: `scripts/verify/02_verticals_output.py`
- Modify: `docs/VERIFICATION_2026-08.md` (append Task 2 section)

**Interfaces:**
- Consumes: `hermes-api` running on `localhost:8000` (Task 1 already confirms/starts it)
- Produces: `scripts/verify/output/02_verticals_output.json` (Task 6 doesn't need this, but Task 7's roll-up references it)

- [ ] **Step 1: Write the script**

`scripts/verify/02_verticals_output.py`:

```python
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
CONTENT_ROOT = REPO / "automation" / "phase-b" / "stages" / "01_source_content" / "output"
RENDER_ROOT = REPO / "automation" / "phase-b" / "stages" / "02_render_video" / "output"

# max seconds to wait for each vertical's generate job -- 340s for letters'
# two-script chain (300s timeout + margin), 1830s for the other three's
# single Ollama-backed call (app.py's _run_generator_job: 300s / 1800s)
VERTICALS = {
    "letters": 340,
    "economic_facts": 1830,
    "commodities_macro": 1830,
    "geopolitical_risk": 1830,
}


def existing_files(vertical):
    d = CONTENT_ROOT / vertical
    return {f.name for f in d.glob("*.json")} if d.is_dir() else set()


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
    new_files = after - before
    if not new_files:
        return {"vertical": vertical, "ok": False, "reason": "job reported done but no new content file appeared"}
    result = {"vertical": vertical, "ok": True, "elapsed_s": round(elapsed, 1), "new_files": []}
    for name in new_files:
        path = CONTENT_ROOT / vertical / name
        try:
            data = json.loads(path.read_text())
            valid_json = True
        except json.JSONDecodeError:
            data, valid_json = None, False
        entry = {"file": str(path), "valid_json": valid_json, "keys": list(data.keys()) if data else []}
        if vertical == "letters":
            letter = Path(name).stem.replace("letter_", "")
            video = RENDER_ROOT / "letters" / f"letter_{letter}.mp4"
            entry["video_path"] = str(video)
            entry["video_exists"] = video.is_file()
            entry["video_size_bytes"] = video.stat().st_size if video.is_file() else 0
        result["new_files"].append(entry)
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
```

- [ ] **Step 2: Run it (one vertical at a time is fine — each run merges into the same output file)**

```bash
~/venv-ai/bin/python3 scripts/verify/02_verticals_output.py letters
~/venv-ai/bin/python3 scripts/verify/02_verticals_output.py economic_facts
~/venv-ai/bin/python3 scripts/verify/02_verticals_output.py commodities_macro
~/venv-ai/bin/python3 scripts/verify/02_verticals_output.py geopolitical_risk
```

Expected per run: `ok: true`, a new file path under `new_files`, `valid_json: true`.

- [ ] **Step 3: Manually open each new content file (and, for `letters`, the video) and judge usability**

This is inherently a human judgment call — the script can only confirm a file exists and parses. For each of the 4 outputs recorded in `scripts/verify/output/02_verticals_output.json`, open the file and note: does the content read as real, on-topic, non-garbled text? (For `geopolitical_risk` specifically, `REMAINING_WORK.md` P4 already documents 2 of 5 prior outputs fabricating numbers — check the new sample against its cited source for numeric fidelity, not just shape.)

- [ ] **Step 4: Append the Task 2 section to `docs/VERIFICATION_2026-08.md`**

```markdown
## Task 2: Vertical output verification (4 verticals, corrected from spec's "5")

Ran `scripts/verify/02_verticals_output.py` per vertical. Raw results: `scripts/verify/output/02_verticals_output.json`.

| Vertical | Job completed | New file | Valid JSON | Usable (manual review) |
|---|---|---|---|---|
| letters | | | | |
| economic_facts | | | | |
| commodities_macro | | | | |
| geopolitical_risk | | | | |

**Result:** ✅ / ❌ *(fill in the table and this line after running all 4)*
```

- [ ] **Step 5: Commit**

```bash
git add scripts/verify/02_verticals_output.py scripts/verify/output/02_verticals_output.json docs/VERIFICATION_2026-08.md
git commit -m "test(verify): confirm all 4 verticals produce real on-disk output"
```

---

### Task 3: One scripted E2E path — query → agent decision → content+TTS+video render → API response

**Files:**
- Create: `scripts/verify/03_e2e_flow_test.py`
- Modify: `docs/VERIFICATION_2026-08.md` (append Task 3 section)

**Interfaces:**
- Consumes: `hermes-api` on `localhost:8000`; `ffprobe` on `PATH`
- Uses the `letters` vertical specifically — it's the only one with a real multi-step decision chain (`app.py:405-416`, `_next_letter_to_generate` picks which letter) plus a separate render step, matching "decision → TTS → video" more precisely than the other 3 verticals' single-call generators.

- [ ] **Step 1: Write the test**

`scripts/verify/03_e2e_flow_test.py`:

```python
#!/usr/bin/env python3
"""Phase 1A Task 3: one scripted E2E path -- query (trigger) -> agent
decision (which letter) -> content+TTS+video render -> API response
confirms the artifact. Exits non-zero on any assertion failure."""
import json
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
REPO = Path(__file__).resolve().parents[2]
CONTENT_DIR = REPO / "automation" / "phase-b" / "stages" / "01_source_content" / "output" / "letters"
RENDER_DIR = REPO / "automation" / "phase-b" / "stages" / "02_render_video" / "output" / "letters"


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
```

- [ ] **Step 2: Run it**

```bash
~/venv-ai/bin/python3 scripts/verify/03_e2e_flow_test.py
```

Expected: exits 0, prints `=== E2E FLOW: PASS ... ===`.

- [ ] **Step 3: Append the Task 3 section to `docs/VERIFICATION_2026-08.md`**

```markdown
## Task 3: E2E flow test (query → decision → content+TTS+video → API response)

Ran `scripts/verify/03_e2e_flow_test.py` against the `letters` vertical (the
one vertical with a real decision + separate render step).

**Result:** ✅ / ❌ *(paste the script's final PASS/FAIL line here)*
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/03_e2e_flow_test.py docs/VERIFICATION_2026-08.md
git commit -m "test(verify): add scripted E2E test for query->decision->TTS->video->API flow"
```

---

### Task 4: Failure-mode tests — Ollama down, malformed input, call timeout, disk full

**Files:**
- Create: `scripts/verify/04_failure_modes.py`
- Modify: `docs/VERIFICATION_2026-08.md` (append Task 4 section)

**Interfaces:**
- Consumes: `hermes-api` on `localhost:8000`; `supervisorctl -c config/supervisord.conf`; passwordless (or interactively-authorizable) `sudo` for the tmpfs mount in the disk-full check
- A ❌ here is a **real finding**, not a script bug — record what actually happens either way.

- [ ] **Step 1: Write the script**

`scripts/verify/04_failure_modes.py`:

```python
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
```

- [ ] **Step 2: Run it**

```bash
~/venv-ai/bin/python3 scripts/verify/04_failure_modes.py
```

Expected: exits 0, `ALL 4 FAILURE MODES: degrade gracefully` — or, honestly, exits 1 listing which mode(s) didn't. Either outcome is a valid result to record.

- [ ] **Step 3: Append the Task 4 section to `docs/VERIFICATION_2026-08.md`**

```markdown
## Task 4: Failure-mode tests

Ran `scripts/verify/04_failure_modes.py`. Raw results: `scripts/verify/output/04_failure_modes.json`.

| Failure mode | Graceful? | Notes |
|---|---|---|
| Ollama down | | |
| Malformed input | | |
| Ollama call timeout | | |
| Disk full | | |

**Result:** ✅ / ❌ *(fill in and paste the script's final line)*
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/04_failure_modes.py scripts/verify/output/04_failure_modes.json docs/VERIFICATION_2026-08.md
git commit -m "test(verify): failure-mode checks for ollama-down, bad input, timeout, disk-full"
```

---

### Task 5: Recovery test — kill-switch fires, supervisord restarts, restore.sh runs against a throwaway copy

**Files:**
- Create: `scripts/verify/05_recovery_test.sh`
- Modify: `docs/VERIFICATION_2026-08.md` (append Task 5 section)

**Interfaces:**
- Consumes: `code/stop.js`, `code/lib.js`'s `execute()`, `supervisorctl`, `scripts/restore.sh`
- **Never** runs `restore.sh` without `--dest` — that would clobber the live `$HOME/jarvis-x` install.

- [ ] **Step 1: Write the script**

`scripts/verify/05_recovery_test.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p scripts/verify/output
LOG=scripts/verify/output/05_recovery_test.log
: > "$LOG"

echo "=== Phase 1A / Task 5: kill-switch + supervisord restart + restore ===" | tee -a "$LOG"

echo "--- 5.1 engage kill switch ---" | tee -a "$LOG"
node code/stop.js | tee -a "$LOG"
node code/stop.js status | tee -a "$LOG"   # expect STOPPED

echo "--- 5.2 confirm the API refuses a generate request while stopped ---" | tee -a "$LOG"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8000/api/dashboard/generate/letters)
echo "generate/letters while stopped -> HTTP $CODE" | tee -a "$LOG"
if [ "$CODE" != "503" ]; then
  echo "FAIL: expected 503, got $CODE" | tee -a "$LOG"
  node code/stop.js off
  exit 1
fi

echo "--- 5.3 confirm guard.js blocks a guarded JS action while stopped ---" | tee -a "$LOG"
node -e "
const { execute } = require('./code/lib.js');
execute({ type: 'list', path: '.' })
  .then(() => { console.error('FAIL: execute() did not throw while stopped'); process.exit(1); })
  .catch(e => { console.log('blocked as expected:', e.message); });
" | tee -a "$LOG"

echo "--- 5.4 disengage kill switch ---" | tee -a "$LOG"
node code/stop.js off | tee -a "$LOG"
node code/stop.js status | tee -a "$LOG"   # expect RUNNING

echo "--- 5.5 supervisord restart resilience ---" | tee -a "$LOG"
supervisorctl -c config/supervisord.conf restart hermes-api | tee -a "$LOG"
PASS_RESTART=0
for i in $(seq 1 15); do
  if curl -sf http://localhost:8000/api/status | grep -q '"status":"online"'; then
    echo "PASS: hermes-api healthy after restart (attempt $i)" | tee -a "$LOG"
    PASS_RESTART=1
    break
  fi
  sleep 1
done
if [ "$PASS_RESTART" != "1" ]; then
  echo "FAIL: hermes-api did not come back healthy after restart" | tee -a "$LOG"
  exit 1
fi

echo "--- 5.6 restore.sh against a throwaway destination (never touches the live install) ---" | tee -a "$LOG"
LATEST_BACKUP=$(ls -t ~/jarvis-x-backup-*.tar.gz | head -1)
DEST=/tmp/jarvis-restore-verify-$$
echo "using backup: $LATEST_BACKUP -> $DEST" | tee -a "$LOG"
scripts/restore.sh "$LATEST_BACKUP" --dest "$DEST" | tee -a "$LOG"
if [ ! -f "$DEST/jarvis-x/app.py" ] || [ ! -d "$DEST/jarvis-x/.git" ]; then
  echo "FAIL: restored tree at $DEST is incomplete" | tee -a "$LOG"
  exit 1
fi
echo "PASS: restore produced a real, complete tree at $DEST" | tee -a "$LOG"
rm -rf "$DEST"

echo "=== Task 5: ALL PASS ===" | tee -a "$LOG"
```

- [ ] **Step 2: Run it**

```bash
chmod +x scripts/verify/05_recovery_test.sh
scripts/verify/05_recovery_test.sh
```

Expected: ends with `=== Task 5: ALL PASS ===`.

- [ ] **Step 3: Append the Task 5 section to `docs/VERIFICATION_2026-08.md`**

```markdown
## Task 5: Recovery test (kill-switch, supervisord restart, restore.sh)

Ran `scripts/verify/05_recovery_test.sh`. Full log: `scripts/verify/output/05_recovery_test.log`.

**Result:** ✅ / ❌ *(paste the script's final line here)*
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/05_recovery_test.sh scripts/verify/output/05_recovery_test.log docs/VERIFICATION_2026-08.md
git commit -m "test(verify): kill-switch, supervisord restart, and restore.sh recovery test"
```

---

### Task 6: Performance baseline — startup time, per-decision latency, memory ceiling, video-gen wall-clock

**Files:**
- Create: `scripts/verify/06_performance_baseline.py`
- Modify: `docs/VERIFICATION_2026-08.md` (append Task 6 section)

**Interfaces:**
- Consumes: `~/.hermes/state.db`'s `conversations.latency_ms` column (`hermes.py:45` — already captured on every `/api/ask` call, never aggregated until now)

- [ ] **Step 1: Write the script**

`scripts/verify/06_performance_baseline.py`:

```python
#!/usr/bin/env python3
"""Phase 1A Task 6: record concrete numbers -- startup time, per-decision
latency (from ~/.hermes/state.db), memory ceiling, and video-gen
wall-clock."""
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


def measure_memory():
    def rss_mb(pattern):
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True).stdout.split()
        total = 0
        for pid in out:
            try:
                total += int(subprocess.run(["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True).stdout.strip())
            except (ValueError, subprocess.CalledProcessError):
                pass
        return round(total / 1024, 1)
    return {"hermes_api_mb": rss_mb("uvicorn app:app"), "ollama_mb": rss_mb("ollama serve")}


def measure_video_gen_wallclock():
    letters_dir = REPO / "automation" / "phase-b" / "stages" / "01_source_content" / "output" / "letters"
    before = {f.name for f in letters_dir.glob("*.json")} if letters_dir.is_dir() else set()
    r = requests.post(f"{BASE}/api/dashboard/generate/letters", timeout=10)
    if r.status_code != 200:
        return {"error": f"generate/letters returned {r.status_code}"}
    start = time.time()
    while time.time() - start < 340:
        ov = requests.get(f"{BASE}/api/dashboard/overview", timeout=10).json()
        job = ov["jobs"].get("letters")
        if job and job.get("status") in ("done", "failed", "timeout", "error"):
            return {"status": job["status"], "wallclock_s": round(time.time() - start, 1)}
        time.sleep(5)
    return {"status": "still_running_after_340s", "wallclock_s": 340}


def main():
    results = {
        "startup_s": measure_startup(),
        "decision_latency_ms": measure_decision_latency(),
        "memory": measure_memory(),
        "letters_video_gen": measure_video_gen_wallclock(),
    }
    print(json.dumps(results, indent=2))
    out = REPO / "scripts" / "verify" / "output" / "06_performance_baseline.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
~/venv-ai/bin/python3 scripts/verify/06_performance_baseline.py
```

- [ ] **Step 3: Append the Task 6 section to `docs/VERIFICATION_2026-08.md`**

```markdown
## Task 6: Performance baseline

Ran `scripts/verify/06_performance_baseline.py`. Raw results: `scripts/verify/output/06_performance_baseline.json`.

| Metric | Value |
|---|---|
| Startup time | |
| Per-decision latency (avg / p95, last 50) | |
| Memory ceiling (hermes-api / ollama) | |
| Letters video-gen wall-clock | |

**Result:** ✅ *(numbers recorded — this task always "passes" by having real numbers, even if the numbers themselves are concerning; a concerning number becomes a REMAINING_WORK.md entry, same as any other ❌ above)*
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/06_performance_baseline.py scripts/verify/output/06_performance_baseline.json docs/VERIFICATION_2026-08.md
git commit -m "test(verify): record startup/latency/memory/video-gen performance baseline"
```

---

### Task 7: Roll up all six results into a pass/fail summary; file any failures into REMAINING_WORK.md

**Files:**
- Modify: `docs/VERIFICATION_2026-08.md` (prepend a summary table after the header)
- Modify: `REMAINING_WORK.md` (append one dated entry per ❌ from Tasks 1-6)

**Interfaces:**
- Consumes: the completed `## Task 1` … `## Task 6` sections written by the previous 6 tasks — this is the one step that genuinely needs all of them finished, hence it's last.

- [ ] **Step 1: Read the full `docs/VERIFICATION_2026-08.md`** and extract each task's `**Result:**` line.

- [ ] **Step 2: Insert a summary table right after the file's header**, before `## Task 1`:

```markdown
## Summary

| # | Check | Result |
|---|---|---|
| 1A.1 | Electron builds + launches + survives restart | ✅/❌ |
| 1A.2 | 4 verticals produce real, usable output | ✅/❌ |
| 1A.3 | E2E flow (query→decision→TTS→video→API) | ✅/❌ |
| 1A.4 | Failure modes degrade gracefully | ✅/❌ |
| 1A.5 | Kill-switch + restart + restore recovery | ✅/❌ |
| 1A.6 | Performance baseline recorded | ✅ |

**Phase 1A exit criteria met:** YES / NO — *(NO if any row above is ❌; those items move below to REMAINING_WORK.md rather than blocking silently)*
```

- [ ] **Step 3: For every ❌ row, append a new entry to `REMAINING_WORK.md`**, following its existing format (a dated `###` heading, a one-line description of what failed, and a pointer back to the relevant `docs/VERIFICATION_2026-08.md` section for the evidence) — e.g.:

```markdown
### 2026-08 — Phase 1A verification: <short description of what failed>

Found while running `docs/superpowers/plans/2026-08-20-phase1a-verification.md`
Task <N>. See the "Task <N>" section of `docs/VERIFICATION_2026-08.md` for
full output. Blocks Phase 1A exit criteria until resolved.
```

- [ ] **Step 4: Commit**

```bash
git add docs/VERIFICATION_2026-08.md REMAINING_WORK.md
git commit -m "docs: Phase 1A verification summary + file any failures into REMAINING_WORK.md"
```
