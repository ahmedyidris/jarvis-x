"""Storage/space evidence collection (Observe) for the storage domain.

Collects raw facts only -- no diagnosis happens here. See
code/engineer/diagnose.py for the rules that turn this into findings.
"""
import os
import re
import shutil
from pathlib import Path

JARVIS_X_ROOT = Path(__file__).resolve().parents[3]  # .../jarvis-x/

_BACKUP_PATTERN = re.compile(r"\.bak\d*$")
_SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def dir_size_bytes(path: Path) -> int | None:
    """Total size in bytes of all regular files under `path`, or None if
    `path` doesn't exist or is not readable. Unreadable files/dirs are skipped, not raised."""
    if not path.exists():
        return None
    if not os.access(path, os.R_OK | os.X_OK):
        return None
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for name in files:
            fp = Path(root) / name
            try:
                if fp.is_file() and not fp.is_symlink():
                    total += fp.stat().st_size
            except OSError:
                continue
    return total


def _downloads_path(chromeos_marker: Path | None = None) -> Path:
    """ChromeOS Crostini mounts the host Downloads folder at a fixed path;
    native Linux uses ~/Downloads. Prefer whichever exists."""
    marker = chromeos_marker if chromeos_marker is not None else Path("/mnt/chromeos/MyFiles/Downloads")
    if marker.exists():
        return marker
    return Path.home() / "Downloads"


CANDIDATE_PATHS: list[tuple[str, Path]] = [
    ("jarvis-x repo", JARVIS_X_ROOT),
    ("venv-ai", Path.home() / "venv-ai"),
    ("Ollama models", Path("/usr/share/ollama/.ollama/models")),
    ("~/.cache", Path.home() / ".cache"),
    ("~/.npm", Path.home() / ".npm"),
    ("apt archive cache", Path("/var/cache/apt/archives")),
    ("Downloads", _downloads_path()),
]


def _scan_backup_files(root: Path) -> dict:
    """Find files matching *.bak / *.bak<N> under `root`, skipping .git,
    node_modules, and __pycache__ for speed."""
    matches: list[str] = []
    total = 0
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if _BACKUP_PATTERN.search(name):
                fp = Path(dirpath) / name
                try:
                    if fp.is_file() and not fp.is_symlink():
                        matches.append(str(fp))
                        total += fp.stat().st_size
                except OSError:
                    continue
    return {"count": len(matches), "total_bytes": total, "paths": matches}


def collect() -> dict:
    """Observe: gather storage/space evidence. Makes no changes."""
    usage = shutil.disk_usage("/")
    disk_usage = {
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "percent_used": round(usage.used / usage.total * 100, 1),
    }

    candidates: dict[str, dict] = {}
    for label, path in CANDIDATE_PATHS:
        size = dir_size_bytes(path)
        if size is None:
            candidates[label] = {"path": str(path), "unavailable": "path does not exist or is unreadable"}
        else:
            candidates[label] = {"path": str(path), "size_bytes": size}

    return {
        "disk_usage": disk_usage,
        "candidates": candidates,
        "backup_files": _scan_backup_files(JARVIS_X_ROOT),
    }
