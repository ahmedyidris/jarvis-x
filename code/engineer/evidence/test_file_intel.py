from code.engineer.evidence import file_intel

# --- dir_size_bytes ---------------------------------------------------

def test_dir_size_bytes_sums_files(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"x" * 100)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.txt").write_bytes(b"y" * 50)
    assert file_intel.dir_size_bytes(tmp_path) == 150


def test_dir_size_bytes_returns_none_for_missing_path(tmp_path):
    assert file_intel.dir_size_bytes(tmp_path / "missing") is None


def test_dir_size_bytes_returns_none_for_permission_denied(tmp_path):
    locked_dir = tmp_path / "locked"
    locked_dir.mkdir()
    (locked_dir / "secret.txt").write_bytes(b"x" * 10)
    locked_dir.chmod(0o000)
    try:
        assert file_intel.dir_size_bytes(locked_dir) is None
    finally:
        locked_dir.chmod(0o755)


# --- _scan_backup_files ---------------------------------------------------

def test_scan_backup_files_finds_bak_variants(tmp_path):
    (tmp_path / "app.py.bak").write_bytes(b"a" * 10)
    (tmp_path / "app.py.bak2").write_bytes(b"b" * 20)
    (tmp_path / "app.py").write_bytes(b"c" * 30)  # not a match
    result = file_intel._scan_backup_files(tmp_path)
    assert result["count"] == 2
    assert result["total_bytes"] == 30


def test_scan_backup_files_skips_dependency_dirs(tmp_path):
    for skip_dir in ("venv-ai", ".cache", ".npm", ".pyenv", ".rustup", ".cargo", ".venvs", ".git", "node_modules", "__pycache__"):
        d = tmp_path / skip_dir
        d.mkdir()
        (d / "x.bak").write_bytes(b"a" * 10)
    result = file_intel._scan_backup_files(tmp_path)
    assert result["count"] == 0


# --- collect ---------------------------------------------------------

def test_collect_reports_cache_sizes(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "f.txt").write_bytes(b"x" * 42)
    monkeypatch.setattr(file_intel, "CACHE_PATHS", [("test-cache", cache_dir)])
    monkeypatch.setattr(file_intel, "HOME_DIR", tmp_path)
    evidence = file_intel.collect()
    assert evidence["caches"]["test-cache"]["size_bytes"] == 42
    assert "backup_files" in evidence


def test_collect_marks_missing_cache_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(file_intel, "CACHE_PATHS", [("missing", tmp_path / "nope")])
    monkeypatch.setattr(file_intel, "HOME_DIR", tmp_path)
    evidence = file_intel.collect()
    assert "unavailable" in evidence["caches"]["missing"]
