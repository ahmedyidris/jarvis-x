"""Cross-domain regression test: proves the storage and file_intel domains'
merged findings don't duplicate each other.

No other test in the branch ever looks at both domains' actual findings
together (each domain's own tests only ever see its own evidence in
isolation), which is precisely how the duplicate backup-file finding
(Finding #2) survived four individual task reviews. This test mirrors the
real overlap -- JARVIS_X_ROOT sits under HOME_DIR -- with a fake home
directory containing a fake jarvis-x repo subdirectory and a single stray
.bak file, then runs both domains' real collect()/run_rules() and confirms
only one backup-clutter finding fires, not two.
"""
from code.engineer import diagnose, diagnose_file_intel
from code.engineer.evidence import file_intel, storage


def test_storage_and_file_intel_do_not_double_report_the_same_backup_file(tmp_path, monkeypatch):
    home_dir = tmp_path / "home"
    home_dir.mkdir()

    repo_dir = home_dir / "jarvis-x"
    repo_dir.mkdir()
    (repo_dir / "app.py.bak").write_bytes(b"x" * 100)

    monkeypatch.setattr(storage, "JARVIS_X_ROOT", repo_dir)
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [])

    monkeypatch.setattr(file_intel, "HOME_DIR", home_dir)
    monkeypatch.setattr(file_intel, "CACHE_PATHS", [])

    storage_evidence = storage.collect()
    storage_findings = diagnose.run_rules(storage_evidence, previous=None)

    file_intel_evidence = file_intel.collect()
    file_intel_findings = diagnose_file_intel.run_rules(file_intel_evidence, previous=None)

    merged = storage_findings + file_intel_findings

    backup_findings = [f for f in merged if "backup" in f.issue.lower()]
    assert len(backup_findings) == 1
    assert backup_findings[0].issue == "Stale backup files found across your home directory"
