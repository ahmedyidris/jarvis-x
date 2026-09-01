import pytest

from code.engineer.core import state


@pytest.fixture
def isolated_history(tmp_path, monkeypatch):
    history_dir = tmp_path / "history"
    monkeypatch.setattr(state, "HISTORY_DIR", history_dir)
    return history_dir


def test_last_snapshot_returns_none_when_no_history(isolated_history):
    assert state.last_snapshot("storage") is None


def test_append_then_last_snapshot_roundtrips(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    assert state.last_snapshot("storage") == {"a": 1}


def test_last_snapshot_returns_most_recent_of_multiple(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    state.append_snapshot("storage", {"a": 2})
    assert state.last_snapshot("storage") == {"a": 2}


def test_domains_are_independent(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    assert state.last_snapshot("network") is None


def test_append_creates_history_dir_on_first_use(isolated_history):
    assert not isolated_history.exists()
    state.append_snapshot("storage", {"a": 1})
    assert isolated_history.exists()


# --- resilience to truncated/malformed history lines ---------------------

def test_last_snapshot_returns_none_when_only_line_is_truncated(isolated_history):
    isolated_history.mkdir(parents=True)
    path = state._history_path("storage")
    # Simulates an ENOSPC-interrupted or ^C-interrupted write: no closing braces.
    path.write_text('{"timestamp": "2026-01-01T00:00:00", "evidence": {"a": 1}')
    assert state.last_snapshot("storage") is None


def test_last_snapshot_walks_back_past_truncated_trailing_line(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    state.append_snapshot("storage", {"a": 2})
    path = state._history_path("storage")
    with path.open("a") as f:
        f.write('{"timestamp": "2026-01-01T00:00:00", "evidence": {"a": 3}')  # truncated, no trailing newline
    # Must walk backward past the bad line and return the last *valid* one,
    # not just catch-and-give-up on the truly-last line.
    assert state.last_snapshot("storage") == {"a": 2}
