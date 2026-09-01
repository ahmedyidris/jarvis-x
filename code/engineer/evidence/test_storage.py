import os
from pathlib import Path

import pytest

from code.engineer.evidence import storage


# --- dir_size_bytes ---------------------------------------------------

def test_dir_size_bytes_sums_files(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"x" * 100)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.txt").write_bytes(b"y" * 50)
    assert storage.dir_size_bytes(tmp_path) == 150


def test_dir_size_bytes_returns_none_for_missing_path(tmp_path):
    assert storage.dir_size_bytes(tmp_path / "missing") is None


def test_dir_size_bytes_does_not_double_count_symlinks(tmp_path):
    real = tmp_path / "real.txt"
    real.write_bytes(b"z" * 10)
    (tmp_path / "link.txt").symlink_to(real)
    assert storage.dir_size_bytes(tmp_path) == 10


def test_dir_size_bytes_returns_none_for_permission_denied(tmp_path):
    """Permission-denied paths (e.g., chmod 000) should return None, not 0."""
    locked_dir = tmp_path / "locked"
    locked_dir.mkdir()
    (locked_dir / "file.txt").write_bytes(b"x" * 50)
    # Remove read+execute permissions
    try:
        locked_dir.chmod(0o000)
        assert storage.dir_size_bytes(locked_dir) is None
    finally:
        # Restore permissions so pytest's cleanup can remove the directory
        locked_dir.chmod(0o755)


# --- _downloads_path ----------------------------------------------------

def test_downloads_path_prefers_chromeos_mount_when_present(tmp_path):
    marker = tmp_path / "Downloads"
    marker.mkdir()
    assert storage._downloads_path(marker) == marker


def test_downloads_path_falls_back_to_home_when_chromeos_mount_absent(tmp_path):
    marker = tmp_path / "does-not-exist"
    assert storage._downloads_path(marker) == Path.home() / "Downloads"


# --- _scan_backup_files ---------------------------------------------------

def test_scan_backup_files_finds_bak_variants(tmp_path):
    (tmp_path / "app.py.bak").write_bytes(b"a" * 10)
    (tmp_path / "app.py.bak2").write_bytes(b"b" * 20)
    (tmp_path / "app.py").write_bytes(b"c" * 30)  # not a match
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 2
    assert result["total_bytes"] == 30


def test_scan_backup_files_skips_git_and_node_modules(tmp_path):
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    (git_dir / "x.bak").write_bytes(b"a" * 10)
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 0


# --- collect ---------------------------------------------------------

def test_collect_reports_candidate_sizes(tmp_path, monkeypatch):
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "f.txt").write_bytes(b"x" * 42)
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("test-candidate", candidate_dir)])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert evidence["disk_usage"]["total_bytes"] > 0
    assert evidence["candidates"]["test-candidate"]["size_bytes"] == 42
    # tmp_path is on the same filesystem as / in normal (non-bind-mount) test envs
    assert evidence["candidates"]["test-candidate"]["on_root_filesystem"] is True
    assert "backup_files" in evidence


def test_collect_marks_missing_candidate_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("missing", tmp_path / "nope")])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert "unavailable" in evidence["candidates"]["missing"]


def test_collect_percent_used_uses_used_over_used_plus_free(tmp_path, monkeypatch):
    """Regression test for the wrong-denominator bug: shutil.disk_usage()'s
    used/free don't sum to total (root-reserved space), so percent_used
    must be used/(used+free) -- matching `df` -- not used/total."""
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)

    class _FakeUsage:
        total = 74840010752
        used = 67852038144
        free = 5805117440

    monkeypatch.setattr(storage.shutil, "disk_usage", lambda path: _FakeUsage())
    evidence = storage.collect()
    # used/total would give 90.7 (the old, wrong formula); df reports 93%.
    assert evidence["disk_usage"]["percent_used"] == 92.1


# --- _on_root_filesystem ---------------------------------------------------

def test_on_root_filesystem_true_when_same_device(monkeypatch, tmp_path):
    path_a = tmp_path / "a"
    path_b = tmp_path / "b"

    class _FakeStat:
        def __init__(self, st_dev):
            self.st_dev = st_dev

    def fake_os_stat(path, *args, **kwargs):
        return _FakeStat(1) if str(path) == str(path_a) else _FakeStat(2)

    monkeypatch.setattr(os, "stat", fake_os_stat)
    assert storage._on_root_filesystem(path_a, root_dev=1) is True
    assert storage._on_root_filesystem(path_b, root_dev=1) is False
