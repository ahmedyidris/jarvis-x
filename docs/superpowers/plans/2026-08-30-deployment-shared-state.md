# Deployment Shared-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `DECISION_RECORD_deployment-target.md`'s three tracked "dual-target requires going forward" follow-ups, per the explicit decision to bind-mount and share state between the Electron desktop `.deb` and the ghcr Docker container, rather than running them as independent instances.

**Architecture:** Item 1 (state sharing) is a `docker-compose.yml` volume-mount addition — the two deployment targets already share `~/.jarvis-x/.env` (confirmed already correctly bind-mounted); this plan extends that to the kill-switch file, which today resolves to a path *relative to each install's own code root* (`code/guard.js`: `path.join(__dirname, '..', '.jarvis-x-STOP')`; `app.py`: `Path(__file__).parent / ".jarvis-x-STOP"`) and is therefore NOT currently shared even though both installs' `.env` already is. Item 2 (guard parity) is already satisfied — verified, not built — by the Dockerfile's existing `COPY . .` with no `.dockerignore` excluding `code/guard.js`. Item 3 (conflict visibility) is a small heartbeat file plus a pure decision function, following the same "advisory, log a warning, don't hard-block" shape already used for P7's generation-lock (`app.py`'s `_generation_job_in_progress()`).

**Tech Stack:** Python 3.11 (`app.py`, FastAPI `startup` event), Docker Compose YAML, Markdown documentation.

**Spec:** `DECISION_RECORD_deployment-target.md`'s "What 'dual-target' requires going forward" section (3 numbered items) is the spec this plan implements — quoted verbatim in each task below.

## Global Constraints

- Do not touch `code/guard.js` — it is Edit-denied by this project's own guardrail config (`~/.claude/settings.json` deny list) and is self-protection-critical. Every change in this plan works around it via configuration (bind mounts, env vars), never by editing it.
- Do not attempt to `docker build` or `docker-compose up` the real jarvis-x image on this machine — confirmed 6.3GB free disk, image is documented at 12-15GB+, and this exact disk-exhaustion failure mode is already documented in `docs/obsidian-vault/decisions/docker-single-container.md` ("disk was at 8.5GB free... a real build of this size risked exhausting disk on a live, in-use system"). `docker-compose.yml`/`docker/supervisord.conf` changes are verified by direct reading and `docker-compose config` (schema-only, no image pull/build) in this session; a real end-to-end run is a manual follow-up for a machine with headroom, noted as such in each task.
- Keep the conflict-detection mechanism advisory (log a warning), not a hard block — matches this project's existing P7 precedent (`app.py`'s `_generation_job_in_progress()` fails fast with a 503 for *known, self-inflicted* contention; this is a *different*, less certain signal — cross-machine/cross-container clock and networking assumptions are weaker — so a hard block here risks a false-positive denial of service to a legitimate single-instance user for a scenario DECISION_RECORD itself only asks be "flagged," not prevented).
- New env var: `JARVIS_DEPLOYMENT` (`"desktop"` or `"container"`), set in `config/supervisord.conf` and `docker/supervisord.conf` respectively — this is how the heartbeat mechanism tells the two label apart. Default to `"unknown"` if unset (e.g. a bare `python3 app.py` outside supervisord) rather than crashing.

---

### Task 1: Share the kill-switch file between the two deployment targets

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- No code interfaces — this is a volume-mount-only change. Task 2 depends on the *same* directory (`.jarvis-x-STOP`'s parent) existing and being bind-mounted, so it can add its own heartbeat file alongside the kill-switch file in that same shared location.

- [ ] **Step 1: Confirm the exact host and container paths the kill-switch resolves to**

Run: `cd /home/ahmedyidris/jarvis-x && grep -n "STOP_FILE" code/guard.js app.py`
Expected output confirms both resolve to "the app's own code root" — on bare metal that's `/home/ahmedyidris/jarvis-x/.jarvis-x-STOP` (since `guard.js` lives at `<repo>/code/guard.js`, `path.join(__dirname, '..', ...)` is `<repo>/.jarvis-x-STOP`; `app.py` lives at `<repo>/app.py`, `Path(__file__).parent` is the same `<repo>/`). Inside the container, the app code is copied to `/app` (`Dockerfile`'s `WORKDIR /app` + `COPY . .`), so the equivalent path is `/app/.jarvis-x-STOP`.

- [ ] **Step 2: Add the bind mount**

In `docker-compose.yml`, in the `volumes:` list (after the existing `.env` mount), add:

```yaml
      # Kill switch: same file the bare-metal desktop install checks
      # (code/guard.js, app.py -- both resolve this relative to their own
      # code root, i.e. the real repo directory on the host, /app in the
      # container). Sharing this file, not giving the container its own
      # independent one, is what makes "stop Jarvis" from either install
      # actually stop both -- DECISION_RECORD_deployment-target.md item 2.
      - ${HOME}/jarvis-x/.jarvis-x-STOP:/app/.jarvis-x-STOP
```

Note: this is a bind mount of a *file*, not a directory. Docker creates the file on the host as an empty file/directory if it doesn't exist yet at container start — but the desktop install's kill-switch semantics are "file exists = stopped" (`code/guard.js`: `fs.existsSync(STOP_FILE)`), so an accidentally-auto-created empty file would incorrectly start the container in a permanently-stopped state. Guard against this explicitly in Step 3.

- [ ] **Step 3: Ensure the host file exists (as absent, i.e. not-stopped) before first compose-up**

Run: `test -e ~/jarvis-x/.jarvis-x-STOP && echo "EXISTS -- would start stopped" || echo "absent -- safe default"`
Expected: `absent -- safe default` (confirms the current bare-metal install isn't mid-kill-switch). If it prints `EXISTS`, stop and ask before proceeding — that means Jarvis is currently deliberately halted and this change shouldn't paper over that.

Document this pre-check as a one-line comment directly above the bind mount added in Step 2 (already included in that step's YAML block above — no separate edit needed, just confirms the comment is doing real work, not decoration).

- [ ] **Step 4: Validate the compose file schema (no build/run)**

Run: `cd /home/ahmedyidris/jarvis-x && docker-compose config --quiet && echo "valid"`
Expected: `valid`, no YAML/schema errors. This does not pull or build the image (per Global Constraints, no build/run on this machine).

- [ ] **Step 5: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add docker-compose.yml
git commit -m "docker: bind-mount the kill switch so desktop + container share it

DECISION_RECORD_deployment-target.md item 1/2: both code/guard.js and
app.py resolve .jarvis-x-STOP relative to their own code root (the real
repo dir on bare metal, /app in the container) -- previously two
independent files, so stopping one install never stopped the other.
Bind-mounts the host's real file into the container at the same
relative path so 'stopped' means the same thing in both places.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6 (manual, on a machine with disk headroom — not run this session):** `docker-compose up`, then from the host `touch ~/jarvis-x/.jarvis-x-STOP` and confirm `curl http://127.0.0.1:8001/api/status` (or the container's `/api/killswitch`) reports stopped; `rm ~/jarvis-x/.jarvis-x-STOP` and confirm it un-stops. This is the real end-to-end proof Steps 1-5 can't provide on this machine's 6.3GB free disk.

---

### Task 2: Advisory dual-instance conflict warning

**Files:**
- Modify: `app.py`
- Modify: `config/supervisord.conf` (add `JARVIS_DEPLOYMENT="desktop"` to the `hermes-api` program's `environment=` line)
- Modify: `docker/supervisord.conf` (add `JARVIS_DEPLOYMENT="container"` to the `hermes-api` program's `environment=` line)
- Test: `test_app_dual_instance_warning.py`

**Interfaces:**
- Consumes: `STOP_FILE: Path` (already exists in `app.py`, line 26 — the shared kill-switch path from Task 1, used here only to locate the shared directory both deployments already have access to; this task does not touch the kill-switch's own logic).
- Produces: `HEARTBEAT_FILE: Path` (module-level, `STOP_FILE.parent / ".jarvis-x-instances.json"`), `record_heartbeat(path: Path, label: str, now: datetime) -> None`, `check_dual_instance_conflict(path: Path, my_label: str, now: datetime, freshness_seconds: int = 90) -> str | None` (returns a human-readable warning string if the *other* label's last-recorded heartbeat is within `freshness_seconds` of `now`, else `None`).

- [ ] **Step 1: Write the failing tests**

```python
"""
Tests for app.py's advisory dual-instance conflict warning
(DECISION_RECORD_deployment-target.md item 3: "No conflict-detection
today if both the desktop app and a container are live against the
same ~/.jarvis-x/ state simultaneously -- flagged, not solved."
This makes it solved, advisory-only -- logs a warning, never blocks a
request, matching this project's existing P7 generation-lock precedent
of visibility over hard blocking for a self-inflicted, non-catastrophic
overlap).
"""
import json
from datetime import datetime, timedelta

import app as app_module


def test_record_heartbeat_writes_own_label(tmp_path):
    path = tmp_path / "instances.json"
    now = datetime(2026, 8, 30, 12, 0, 0)

    app_module.record_heartbeat(path, "desktop", now)

    data = json.loads(path.read_text())
    assert data["desktop"]["last_heartbeat"] == now.isoformat()


def test_record_heartbeat_preserves_other_labels(tmp_path):
    path = tmp_path / "instances.json"
    t1 = datetime(2026, 8, 30, 12, 0, 0)
    t2 = t1 + timedelta(seconds=5)

    app_module.record_heartbeat(path, "desktop", t1)
    app_module.record_heartbeat(path, "container", t2)

    data = json.loads(path.read_text())
    assert data["desktop"]["last_heartbeat"] == t1.isoformat()
    assert data["container"]["last_heartbeat"] == t2.isoformat()


def test_no_conflict_when_file_absent(tmp_path):
    path = tmp_path / "instances.json"
    now = datetime(2026, 8, 30, 12, 0, 0)
    assert app_module.check_dual_instance_conflict(path, "desktop", now) is None


def test_no_conflict_when_only_own_label_present(tmp_path):
    path = tmp_path / "instances.json"
    now = datetime(2026, 8, 30, 12, 0, 0)
    app_module.record_heartbeat(path, "desktop", now)
    assert app_module.check_dual_instance_conflict(path, "desktop", now) is None


def test_conflict_when_other_label_heartbeat_is_fresh(tmp_path):
    path = tmp_path / "instances.json"
    t1 = datetime(2026, 8, 30, 12, 0, 0)
    app_module.record_heartbeat(path, "container", t1)

    warning = app_module.check_dual_instance_conflict(
        path, "desktop", t1 + timedelta(seconds=30), freshness_seconds=90
    )

    assert warning is not None
    assert "container" in warning


def test_no_conflict_when_other_label_heartbeat_is_stale(tmp_path):
    path = tmp_path / "instances.json"
    t1 = datetime(2026, 8, 30, 12, 0, 0)
    app_module.record_heartbeat(path, "container", t1)

    warning = app_module.check_dual_instance_conflict(
        path, "desktop", t1 + timedelta(seconds=200), freshness_seconds=90
    )

    assert warning is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest test_app_dual_instance_warning.py -v`
Expected: FAIL — `AttributeError: module 'app' has no attribute 'record_heartbeat'`.

- [ ] **Step 3: Write minimal implementation**

In `app.py`, near `STOP_FILE` (after line 26):

```python
HEARTBEAT_FILE = STOP_FILE.parent / ".jarvis-x-instances.json"
MY_DEPLOYMENT = os.environ.get("JARVIS_DEPLOYMENT", "unknown")


def record_heartbeat(path: Path, label: str, now: datetime) -> None:
    """Record that `label` (this process's deployment identity -- "desktop"
    or "container") is alive as of `now`. Read-modify-write so recording
    one label's heartbeat never erases another's."""
    data = {}
    if path.exists():
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            data = {}
    data[label] = {"last_heartbeat": now.isoformat()}
    path.write_text(json.dumps(data))


def check_dual_instance_conflict(
    path: Path, my_label: str, now: datetime, freshness_seconds: int = 90
) -> str | None:
    """DECISION_RECORD_deployment-target.md item 3: advisory-only warning
    (never blocks a request) if a DIFFERENT deployment label's heartbeat
    was recorded within `freshness_seconds` of `now` -- both are live
    against the same shared state at roughly the same time. Ignores
    `my_label`'s own heartbeat and any heartbeat older than the freshness
    window (a container left running idle for months shouldn't flag
    against a desktop app used today)."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    for label, info in data.items():
        if label == my_label:
            continue
        try:
            last = datetime.fromisoformat(info["last_heartbeat"])
        except (KeyError, ValueError):
            continue
        if (now - last).total_seconds() <= freshness_seconds:
            return (
                f"Another Jarvis-X instance ('{label}') was active "
                f"{int((now - last).total_seconds())}s ago against this same "
                f"shared state — DECISION_RECORD_deployment-target.md item 3"
            )
    return None
```

Wire it into `/api/ask`, right after the existing P7 `busy` check (both are advisory pre-checks at the top of the same handler):

```python
    record_heartbeat(HEARTBEAT_FILE, MY_DEPLOYMENT, datetime.now())
    conflict = check_dual_instance_conflict(HEARTBEAT_FILE, MY_DEPLOYMENT, datetime.now())
    if conflict:
        logger.warning(conflict)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest test_app_dual_instance_warning.py -v`
Expected: 6 passed.

- [ ] **Step 5: Run the full existing app.py test suite to confirm no regression**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest test_app_generation_lock.py test_app_dual_instance_warning.py -v`
Expected: all passed (12 total: 7 from the existing P7 suite + these new 6, minus any renumbering — count what's actually collected, but zero failures).

- [ ] **Step 6: Add the `JARVIS_DEPLOYMENT` env var to both supervisord configs**

In `config/supervisord.conf`, `[program:hermes-api]`'s `environment=` line (if none exists, add one) — append `,JARVIS_DEPLOYMENT="desktop"`.

In `docker/supervisord.conf`, `[program:hermes-api]` has no `environment=` line today — add: `environment=JARVIS_DEPLOYMENT="container"`.

- [ ] **Step 7: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add app.py test_app_dual_instance_warning.py config/supervisord.conf docker/supervisord.conf
git commit -m "ask: advisory warning when desktop + container are both live (P deployment item 3)

DECISION_RECORD_deployment-target.md item 3: no conflict-detection
existed if both delivery paths ran against the same shared state
simultaneously. Adds a small heartbeat file (shared location, same dir
as the now-shared kill switch) and a freshness check -- logs a warning,
never blocks a request, same advisory-not-gating philosophy as P7's
_generation_job_in_progress().

TDD: test_app_dual_instance_warning.py written first, watched fail
(missing record_heartbeat/check_dual_instance_conflict), then made to
pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Write `DEPLOY.md`

**Files:**
- Create: `DEPLOY.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write the file**

```markdown
# Deploying Jarvis X

Two delivery paths, both canonical, neither superseding the other
(`DECISION_RECORD_deployment-target.md`, 2026-08-24):

- **Electron `.deb`/AppImage** — interactive desktop use (chat, dashboard).
  Build: `cd electron && npm run build` (targets `.deb` + AppImage via
  `electron-builder`). Already built and verified working; artifacts in
  `electron/dist/`.
- **Docker image on GHCR** — headless path, positioned for the eventual
  robot-deployment goal. Built and pushed automatically by
  `.github/workflows/docker-build.yml` (`workflow_dispatch`) to
  `ghcr.io/ahmedyidris/jarvis-x:latest` — **do not `docker build` this
  locally on a disk-constrained machine**: it needs ~12-15GB and this
  project has twice hit a real disk-exhaustion abort building it locally
  (see `docs/obsidian-vault/decisions/docker-single-container.md`). CI
  runs on GitHub-hosted runners specifically because of this.

## Why one container, not two Compose services

`code/local.js`, `code/vision.js`, and `hermes.py` all call Ollama at a
hardcoded `127.0.0.1:11434`/`localhost:11434` — no `OLLAMA_HOST` override
exists. A two-service Compose split (app + sibling `ollama` service) would
make the app's `localhost` unreachable from a different container by
hostname. See `docs/obsidian-vault/decisions/docker-single-container.md`
for the full reasoning and the `OLLAMA_HOST` future path if true service
separation is ever wanted.

## Shared state between the two paths

Both paths run against the same real host state, bind-mounted into the
container (`docker-compose.yml`):

| What | Host path | Shared? |
|---|---|---|
| Secrets/env | `~/.jarvis-x/.env` | Yes — bind-mounted read-only |
| Kill switch | `~/jarvis-x/.jarvis-x-STOP` | Yes — bind-mounted (see Task 1 of `docs/superpowers/plans/2026-08-30-deployment-shared-state.md`) |
| Ollama models | `/usr/share/ollama/.ollama` | Yes — bind-mounted (avoids re-downloading ~8.1GB) |
| Guard/audit code (`code/guard.js`) | baked into the image via `COPY . .` | Same code, not a stripped build — no `.dockerignore` excludes it |
| Dual-instance visibility | `~/jarvis-x/.jarvis-x-instances.json` | Advisory heartbeat file — logs a warning if both paths are live at once, doesn't block either (see Task 2 of the same plan) |

Toggling the kill switch from either install (`POST /api/killswitch`, or
`touch ~/jarvis-x/.jarvis-x-STOP` by hand) halts both. There is no hard
lock preventing both from running concurrently against the same state —
by design (see the deployment-shared-state plan's Global Constraints for
why this stays advisory) — but each request logs a warning if the other
path's heartbeat is fresh.

## Bringing up the container

```bash
cp bootstrap/env.template ~/.jarvis-x/.env   # fill in real values first
docker-compose up
curl http://127.0.0.1:8001/api/status        # 8001, not 8000 -- see docker-compose.yml's port comment
```
```

- [ ] **Step 2: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add DEPLOY.md
git commit -m "docs: add DEPLOY.md, referenced by Dockerfile but never written

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** DECISION_RECORD item 1 (state sharing) → Task 1. Item 2 (guard parity) → verified already true via `COPY . .`/no `.dockerignore`, documented in Task 3's `DEPLOY.md` rather than re-implemented (nothing to build — it already works). Item 3 (conflict visibility) → Task 2. The dangling `DEPLOY.md` reference in `Dockerfile`'s own top comment → Task 3. Covered.

**2. Placeholder scan:** No TBD/TODO; every step has complete code or exact commands. Checked.

**3. Type consistency:** `record_heartbeat(path: Path, label: str, now: datetime) -> None` and `check_dual_instance_conflict(path: Path, my_label: str, now: datetime, freshness_seconds: int = 90) -> str | None` are used with matching signatures in both the test file and the `/api/ask` wiring. `HEARTBEAT_FILE`/`MY_DEPLOYMENT` are defined once (Task 2 Step 3) and referenced, not redefined, elsewhere. Consistent.
