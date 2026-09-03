# Tool-Calling Reply Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give jarvis-x's `/api/ask` a real tool-calling loop — a keyword tool router, a text-step planner, a regex/LLM step resolver, and a tool-result digest pass — wired to two real tools (`getWeather`, `getSystemStats`) proxying the already-running jarvis-dashboard backend, so the small-model (`qwen2.5:3b`) tier stops being limited to raw single-shot completion.

**Architecture:** A new `code/reply/` package orchestrates router → planner → tool execution → digest → final synthesis, calling back into `hermes.py`'s existing `ask()` for every LLM call (so the audit trail stays single-sourced). `hermes.py`'s `ask()` gets two additive optional parameters (`timeout`, `log`) so scaffolding calls can use a short timeout and skip being written to the `conversations` table — logging them there would corrupt `build_context()`'s next-turn history replay. `app.py`'s `/api/ask` calls `reply.engine.handle()` in place of its direct `hermes.ask()` call; the return type and failure mode (raises `HermesBackendError`) are unchanged, so no other code in `app.py` needs to change.

**Tech Stack:** Python 3, FastAPI (existing), `requests` (already in `venv-ai`), pytest, `unittest.mock`.

**Spec:** `docs/superpowers/specs/2026-09-01-tool-calling-reply-engine-design.md`

## Global Constraints

- Every new LLM call must fail open: timeout, exception, or empty response → the pipeline collapses to today's exact single-call `hermes.ask(question, model, system=system_msg)` behavior. Never worse than baseline.
- Scaffolding calls (planner, resolver's LLM fallback, digest) MUST pass `log=False` to `ask()` — logging them to `conversations` corrupts `build_context()`'s next-turn history replay.
- The fast-path skip (no matched tools AND question ≤8 words) must add zero LLM calls beyond today's single one.
- `app.py`'s `/api/ask` response shape (`question/response/tier/model/voice/audio`) does not change.
- No changes to `code/agent.js`, `code/planner.js`, `code/router.js` (dormant JS path) or to `code/router.py` (tier→model/voice resolution — unrelated to the new `tool_router.py`).
- Tests use pytest, live alongside the existing root-level `test_*.py` convention.

---

### Task 1: Extend `hermes.py`'s `ask()` with `timeout` and `log` parameters

**Files:**
- Modify: `hermes.py:239-308` (the `ask()` method)
- Test: `test_hermes_ask_timeout_and_log.py` (new, root level, matching `test_app_generation_lock.py`'s existing convention)

**Interfaces:**
- Produces: `HermesCore.ask(self, question, model="qwen2.5:7b", context=True, turns=3, system=None, timeout=300, log=True) -> str`. `timeout` overrides the subprocess timeout (was hardcoded 300). `log=False` skips the `INSERT INTO conversations` call entirely (both the success path and `_record_failure`).

- [ ] **Step 1: Write the failing tests**

```python
# test_hermes_ask_timeout_and_log.py
import subprocess
import sqlite3
from unittest.mock import patch, MagicMock
import hermes as hermes_module


def _fake_curl_result(response_text="ok"):
    result = MagicMock()
    result.returncode = 0
    result.stdout = '{"response": "%s"}' % response_text
    result.stderr = ""
    return result


def test_ask_passes_custom_timeout_to_subprocess():
    core = hermes_module.HermesCore()
    try:
        with patch("subprocess.run", return_value=_fake_curl_result()) as mock_run:
            core.ask("hi", model="qwen2.5:3b", context=False, timeout=5, log=False)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == 5
    finally:
        core.close()


def test_ask_default_timeout_is_300():
    core = hermes_module.HermesCore()
    try:
        with patch("subprocess.run", return_value=_fake_curl_result()) as mock_run:
            core.ask("hi", model="qwen2.5:3b", context=False, log=False)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == 300
    finally:
        core.close()


def test_ask_log_false_does_not_insert_conversation():
    core = hermes_module.HermesCore()
    try:
        before = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        with patch("subprocess.run", return_value=_fake_curl_result("scaffold output")):
            core.ask("scaffolding prompt", model="qwen2.5:3b", context=False, log=False)
        after = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        assert after == before
    finally:
        core.close()


def test_ask_log_true_still_inserts_conversation():
    core = hermes_module.HermesCore()
    try:
        before = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        with patch("subprocess.run", return_value=_fake_curl_result("real answer")):
            core.ask("real question", model="qwen2.5:3b", context=False, log=True)
        after = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        assert after == before + 1
    finally:
        core.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest test_hermes_ask_timeout_and_log.py -v` (from `~/jarvis-x`)
Expected: FAIL — `timeout`/`log` are not accepted keyword arguments yet (`TypeError: ask() got an unexpected keyword argument`).

- [ ] **Step 3: Implement the minimal change**

In `hermes.py`, change the `ask()` signature and body:

```python
    def ask(self, question, model="qwen2.5:7b", context=True, turns=3, system=None, timeout=300, log=True):
        """Query model and store result.

        Raises HermesBackendError if Ollama itself failed or was unreachable
        (curl non-zero exit, timeout, or an unparseable/malformed response) --
        this is a hard backend failure, not an ordinary answer, so it must
        not come back as a plain string a caller could mistake for one.

        `timeout` overrides the subprocess timeout (default 300s) -- callers
        making short-lived scaffolding calls (planning, tool-step resolution,
        result digesting) should pass a much shorter value so a stuck small
        model doesn't stall the whole request.

        `log` controls whether this call is written to the `conversations`
        table. Must be False for scaffolding calls: build_context() replays
        the most recent rows from this table as "prior turns" for the NEXT
        request, so logging a planner's raw step list or a digest's
        compressed tool blurb here would surface as if it were the
        assistant's last real reply.
        """
        logger.info(f"Querying {model}...")
        start = datetime.now()

        try:
            cmd = [
                "curl", "-sS", "http://localhost:11434/api/generate",
                "-d", json.dumps({
                    "model": model,
                    "prompt": ((system + "\n\n") if system else "") + (self.build_context(question, turns) if context else question),
                    "stream": False
                })
            ]
            if str(model).startswith("registry:"):
                cmd = ["node", str(Path(__file__).parent / "code" / "providers" / "cli.js"),
                       model.split(":", 1)[1],
                       self.build_context(question, turns) if context else question]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)

            if result.returncode != 0:
                msg = result.stderr.strip() or f"curl exited {result.returncode} with no stderr"
                if log:
                    self._record_failure(question, model, latency_ms, msg)
                raise HermesBackendError(msg)

            response_data = json.loads(result.stdout)
            response = response_data.get("response", "No response").strip()

        except subprocess.TimeoutExpired:
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)
            if log:
                self._record_failure(question, model, latency_ms, f"Query timeout ({timeout}s)")
            raise HermesBackendError(f"Query timeout ({timeout}s)")
        except json.JSONDecodeError as e:
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)
            msg = f"Ollama returned unparseable response: {e}"
            if log:
                self._record_failure(question, model, latency_ms, msg)
            raise HermesBackendError(msg)

        if log:
            self.db.execute("""
                INSERT INTO conversations (timestamp, user_input, response, model, latency_ms)
                VALUES (?, ?, ?, ?, ?)
            """, (
                datetime.now().isoformat(),
                question,
                response,
                model,
                latency_ms
            ))
            self.db.commit()

        logger.info(f"[{latency_ms}ms] {model}")
        return _strip_think(response)
```

(Only the timeout literal `300`/`5` in the two `except` message strings and the `subprocess.run` call, plus the two `if log:` guards, are new — the rest of the method body is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest test_hermes_ask_timeout_and_log.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full existing test suite to confirm no regression**

Run: `~/venv-ai/bin/python3 -m pytest test_app_generation_lock.py -v` (the one other root-level test file that might touch `hermes.py`/`app.py` behavior)
Expected: PASS, unchanged from before this task.

- [ ] **Step 6: Commit**

```bash
cd ~/jarvis-x
git add hermes.py test_hermes_ask_timeout_and_log.py
git commit -m "feat(hermes): add optional timeout/log params to ask()

Additive, backward-compatible: both default to today's exact
behavior (timeout=300, log=True). Needed so the reply engine's
scaffolding LLM calls can use a short timeout and skip polluting
the conversations table that build_context() replays as
next-turn history."
```

---

### Task 2: Tool interface + `getWeather` + `getSystemStats` tools

**Files:**
- Create: `code/reply/__init__.py` (empty)
- Create: `code/reply/tools/__init__.py` (empty)
- Create: `code/reply/tools/base.py`
- Create: `code/reply/tools/weather.py`
- Create: `code/reply/tools/system_stats.py`
- Test: `code/reply/tools/test_weather.py`
- Test: `code/reply/tools/test_system_stats.py`

**Interfaces:**
- Produces: `Tool` ABC (`name: str`, `description: str`, `property_keys: tuple[str, ...]`, `execute(self, args: dict) -> dict`). `WeatherTool()` and `SystemStatsTool()` instances, both `property_keys = ()` (the dashboard backend takes no query params for either endpoint). `execute()` never raises — network/HTTP failures return `{"error": "..."}`.

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/tools/test_weather.py
import requests
from unittest.mock import patch, MagicMock
from code.reply.tools.weather import WeatherTool


def test_weather_success():
    tool = WeatherTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"temp_c": "28", "condition": "Sunny", "city": "Cairo"}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert result == {"temp_c": "28", "condition": "Sunny", "city": "Cairo"}


def test_weather_backend_returns_error_shape():
    tool = WeatherTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"error": "wttr.in unreachable"}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert "error" in result


def test_weather_connection_failure():
    tool = WeatherTool()
    with patch("requests.get", side_effect=requests.ConnectionError("refused")):
        result = tool.execute({})
    assert "error" in result
    assert "unavailable" in result["error"]
```

```python
# code/reply/tools/test_system_stats.py
import requests
from unittest.mock import patch, MagicMock
from code.reply.tools.system_stats import SystemStatsTool


def test_system_stats_success():
    tool = SystemStatsTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"cpu_load": [0.1, 0.2, 0.1], "cpu_count": 4}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert result["cpu_count"] == 4


def test_system_stats_connection_failure():
    tool = SystemStatsTool()
    with patch("requests.get", side_effect=requests.Timeout("slow")):
        result = tool.execute({})
    assert "error" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/tools/ -v` (from `~/jarvis-x`)
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/tools/base.py
from abc import ABC, abstractmethod


class Tool(ABC):
    """A tool the reply engine can route to, plan against, and execute.

    `property_keys` declares the argument names this tool accepts -- the
    resolver filters unknown keys against this before dispatch. An empty
    tuple means the tool takes no arguments (both v1 tools: the dashboard
    backend they proxy has no per-request parameters).
    """

    name: str
    description: str
    property_keys: tuple = ()

    @abstractmethod
    def execute(self, args: dict) -> dict:
        """Run the tool. Must not raise -- catch failures internally and
        return {"error": "..."} so callers never need to guard execute()."""
        raise NotImplementedError
```

```python
# code/reply/tools/weather.py
import requests

from code.reply.tools.base import Tool

WEATHER_URL = "http://127.0.0.1:8002/api/weather"


class WeatherTool(Tool):
    name = "getWeather"
    description = "Get current weather conditions for the configured city."
    property_keys = ()

    def execute(self, args: dict) -> dict:
        try:
            resp = requests.get(WEATHER_URL, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            return {"error": f"weather backend unavailable: {e}"}
        if "error" in data:
            return {"error": f"weather backend error: {data['error']}"}
        return data
```

```python
# code/reply/tools/system_stats.py
import requests

from code.reply.tools.base import Tool

SYSTEM_STATS_URL = "http://127.0.0.1:8002/api/system"


class SystemStatsTool(Tool):
    name = "getSystemStats"
    description = "Get current CPU load, memory, disk usage, and uptime for this machine."
    property_keys = ()

    def execute(self, args: dict) -> dict:
        try:
            resp = requests.get(SYSTEM_STATS_URL, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            return {"error": f"system stats backend unavailable: {e}"}
```

Also create the two empty `__init__.py` files (`code/reply/__init__.py`, `code/reply/tools/__init__.py`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/tools/ -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/__init__.py code/reply/tools/
git commit -m "feat(reply): add Tool interface and getWeather/getSystemStats tools

Proxy jarvis-x's own jarvis-dashboard backend (127.0.0.1:8002) --
no new external dependency, both tools take no arguments."
```

---

### Task 3: Keyword tool router

**Files:**
- Create: `code/reply/tool_router.py`
- Test: `code/reply/test_tool_router.py`

**Interfaces:**
- Consumes: `Tool` (Task 2) — reads `.name` off each tool in the input list.
- Produces: `route(question: str, tools: list) -> list` — returns the subset of `tools` whose name matched a keyword, in the same relative order as the input `tools` list. Returns `[]` when nothing matches.

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/test_tool_router.py
from code.reply.tool_router import route
from code.reply.tools.weather import WeatherTool
from code.reply.tools.system_stats import SystemStatsTool

TOOLS = [WeatherTool(), SystemStatsTool()]


def test_routes_weather_keyword_english():
    matched = route("what's the weather like today?", TOOLS)
    assert [t.name for t in matched] == ["getWeather"]


def test_routes_weather_keyword_arabic():
    matched = route("الجو عامل ازاي دلوقتي", TOOLS)
    assert [t.name for t in matched] == ["getWeather"]


def test_routes_system_stats_keyword():
    matched = route("how much memory is this machine using", TOOLS)
    assert [t.name for t in matched] == ["getSystemStats"]


def test_no_match_returns_empty():
    matched = route("tell me a joke", TOOLS)
    assert matched == []


def test_both_match_preserves_input_order():
    matched = route("check cpu and weather", TOOLS)
    assert [t.name for t in matched] == ["getWeather", "getSystemStats"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_tool_router.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply.tool_router'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/tool_router.py
"""Keyword-based tool router.

v1 deliberately skips embedding-based relevance filtering (isair/jarvis's
approach, needed to scale past 30+ tools) -- with 2 tools a static keyword
map is sufficient. Revisit as its own future slice once the tool catalogue
actually grows; see the design spec's Non-goals.
"""

KEYWORDS = {
    "getWeather": (
        "weather", "temperature", "forecast", "rain", "sunny", "cloudy",
        "humidity", "hot outside", "cold outside",
        "الجو", "الطقس", "حرارة", "الدنيا حر", "الدنيا برد",
    ),
    "getSystemStats": (
        "cpu", "memory", "ram", "disk", "storage", "uptime", "load average",
        "system stats", "processor",
    ),
}


def route(question: str, tools: list) -> list:
    q = question.lower()
    matched_names = {
        name for name, keywords in KEYWORDS.items()
        if any(kw in q for kw in keywords)
    }
    return [t for t in tools if t.name in matched_names]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_tool_router.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/tool_router.py code/reply/test_tool_router.py
git commit -m "feat(reply): add keyword-based tool router"
```

---

### Task 4: Planner

**Files:**
- Create: `code/reply/planner.py`
- Test: `code/reply/test_planner.py`

**Interfaces:**
- Consumes: `Tool` (Task 2, for `.name`/`.description`/`.property_keys`); `HermesCore.ask(question, model, context=False, system=..., timeout=5, log=False)` (Task 1) — treated as an injected dependency (`hermes` parameter) so tests can stub it; `HermesBackendError` (from `hermes` module).
- Produces: `plan_query(question: str, tools: list, model: str, hermes) -> list[str]`. Returns `[]` on any failure (timeout, exception, empty/unparseable response) or when every parsed step is `"stop"`. Returns `["Reply to the user."]` verbatim when the model decides no tool is needed. Otherwise returns up to 5 cleaned text steps.

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/test_planner.py
from unittest.mock import MagicMock
from code.reply.planner import plan_query
from code.reply.tools.weather import WeatherTool
import hermes as hermes_module

TOOLS = [WeatherTool()]


def test_plan_query_no_tools_returns_empty_without_calling_llm():
    hermes = MagicMock()
    result = plan_query("what is 2+2", [], model="qwen2.5:3b", hermes=hermes)
    assert result == []
    hermes.ask.assert_not_called()


def test_plan_query_parses_tool_step():
    hermes = MagicMock()
    hermes.ask.return_value = "1. getWeather"
    result = plan_query("what's the weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["getWeather"]
    hermes.ask.assert_called_once()
    _, kwargs = hermes.ask.call_args
    assert kwargs["context"] is False
    assert kwargs["log"] is False
    assert kwargs["timeout"] <= 10


def test_plan_query_reply_only_step():
    hermes = MagicMock()
    hermes.ask.return_value = "Reply to the user."
    result = plan_query("tell me a joke", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["Reply to the user."]


def test_plan_query_strips_bullets_numbering_and_quotes():
    hermes = MagicMock()
    hermes.ask.return_value = '- "getWeather"\n2) Reply to the user.'
    result = plan_query("weather then reply", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["getWeather", "Reply to the user."]


def test_plan_query_caps_at_five_steps():
    hermes = MagicMock()
    hermes.ask.return_value = "\n".join(f"step {i}" for i in range(10))
    result = plan_query("many steps", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert len(result) == 5


def test_plan_query_all_stop_returns_empty():
    hermes = MagicMock()
    hermes.ask.return_value = "stop"
    result = plan_query("weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == []


def test_plan_query_fails_open_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = plan_query("weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_planner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply.planner'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/planner.py
"""Text-step planner, isair/jarvis-style: the model emits plain-text steps
rather than relying on native LLM function-calling (small models like
qwen2.5:3b don't use that reliably -- see the design spec's Non-goals)."""
import re

from hermes import HermesBackendError

MAX_STEPS = 5
PLANNER_TIMEOUT_SEC = 5

_BULLET_RE = re.compile(r"^[\-\*•]\s*")
_NUMBER_RE = re.compile(r"^\d+[\.\)]\s*")


def plan_query(question: str, tools: list, model: str, hermes) -> list:
    if not tools:
        return []

    catalog = "\n".join(
        f"- {t.name}({','.join(t.property_keys)}): {t.description}" for t in tools
    )
    system = (
        "You are a planning assistant. Given a user question and a catalogue "
        "of available tools, output ONLY an ordered list of short imperative "
        "steps, one per line, at most 5 steps. For a tool step, use the exact "
        "form toolName key='value' using only that tool's declared argument "
        "keys (omit arguments entirely for a tool that takes none). If no "
        "tool is needed, output exactly: Reply to the user.\n\n"
        f"Available tools:\n{catalog}"
    )

    try:
        raw = hermes.ask(
            question, model=model, context=False, system=system,
            timeout=PLANNER_TIMEOUT_SEC, log=False,
        )
    except HermesBackendError:
        return []

    steps = _parse_steps(raw)
    if not steps:
        return []
    if all(s.strip().lower() == "stop" for s in steps):
        return []
    return steps[:MAX_STEPS]


def _parse_steps(raw: str) -> list:
    steps = []
    for line in raw.splitlines():
        line = line.strip().strip("`")
        line = _BULLET_RE.sub("", line)
        line = _NUMBER_RE.sub("", line)
        line = line.strip().strip("\"'")
        if not line:
            continue
        if len(line) > 200:
            line = line[:197] + "..."
        steps.append(line)
    return steps
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_planner.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/planner.py code/reply/test_planner.py
git commit -m "feat(reply): add text-step planner (isair-style, no native function-calling)"
```

---

### Task 5: Resolver

**Files:**
- Create: `code/reply/resolver.py`
- Test: `code/reply/test_resolver.py`

**Interfaces:**
- Consumes: `Tool` (Task 2); `HermesCore.ask(..., context=False, log=False, timeout=5)` (Task 1) as an injected `hermes` parameter; `HermesBackendError`.
- Produces: `resolve_next_tool_call(step: str, tools: list, model: str, hermes) -> dict | None`. Returns `{"name": str, "arguments": dict}` or `None` (synthesis step, unknown tool, or unresolvable — caller falls back to the chat model taking the turn normally).

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/test_resolver.py
from unittest.mock import MagicMock
from code.reply.resolver import resolve_next_tool_call
from code.reply.tools.weather import WeatherTool
import hermes as hermes_module

TOOLS = [WeatherTool()]


def test_fast_path_resolves_bare_tool_call_without_llm():
    hermes = MagicMock()
    result = resolve_next_tool_call("getWeather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}
    hermes.ask.assert_not_called()


def test_synthesis_step_returns_none_without_llm():
    hermes = MagicMock()
    result = resolve_next_tool_call("Reply to the user.", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None
    hermes.ask.assert_not_called()


def test_unknown_tool_name_falls_back_to_llm_and_llm_says_null():
    hermes = MagicMock()
    hermes.ask.return_value = "null"
    result = resolve_next_tool_call("frobnicate", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None
    hermes.ask.assert_called_once()


def test_llm_fallback_resolves_valid_json():
    hermes = MagicMock()
    hermes.ask.return_value = '{"name": "getWeather", "arguments": {}}'
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}


def test_llm_fallback_invalid_json_returns_none():
    hermes = MagicMock()
    hermes.ask.return_value = "not json at all"
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None


def test_resolver_fails_open_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None


def test_unknown_arg_keys_filtered_out():
    hermes = MagicMock()
    hermes.ask.return_value = '{"name": "getWeather", "arguments": {"bogus_key": "x"}}'
    result = resolve_next_tool_call("get weather with bogus arg", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_resolver.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply.resolver'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/resolver.py
"""Resolve one planner step into a concrete tool call. Regex fast-path for
fully-concrete steps (no LLM call); LLM fallback otherwise -- isair/jarvis's
approach for keeping small models on-rails without native function-calling."""
import json
import re

from hermes import HermesBackendError

RESOLVER_TIMEOUT_SEC = 5

_STEP_RE = re.compile(r"^(\w+)\s*(.*)$")
_KV_RE = re.compile(r"(\w+)\s*=\s*['\"]([^'\"]*)['\"]")


def resolve_next_tool_call(step: str, tools: list, model: str, hermes) -> dict:
    step = step.strip()
    if not step or step.lower().startswith("reply to the user"):
        return None

    by_name = {t.name: t for t in tools}
    fast = _try_fast_path(step, by_name)
    if fast is not None:
        return fast

    return _resolve_via_llm(step, tools, by_name, model, hermes)


def _try_fast_path(step: str, by_name: dict):
    if "<" in step:
        return None  # unresolved placeholder -- needs the LLM path
    match = _STEP_RE.match(step)
    if not match:
        return None
    name, rest = match.group(1), match.group(2)
    tool = by_name.get(name)
    if tool is None:
        return None
    kvs = dict(_KV_RE.findall(rest))
    if not set(kvs.keys()) <= set(tool.property_keys):
        return None  # an arg the tool doesn't declare -- let the LLM sort it out
    return {"name": tool.name, "arguments": kvs}


def _resolve_via_llm(step: str, tools: list, by_name: dict, model: str, hermes):
    catalog = "\n".join(
        f"- {t.name}({','.join(t.property_keys)}): {t.description}" for t in tools
    )
    system = (
        "Resolve this single plan step into ONE tool call as JSON: "
        '{"name": "<tool name>", "arguments": {...}}. Use only tool names '
        "and argument keys from the catalogue below. If the step is not a "
        "concrete tool call, output exactly: null\n\n"
        f"Available tools:\n{catalog}"
    )
    try:
        raw = hermes.ask(
            step, model=model, context=False, system=system,
            timeout=RESOLVER_TIMEOUT_SEC, log=False,
        )
    except HermesBackendError:
        return None

    raw = raw.strip().strip("`")
    if raw.lower() in ("null", ""):
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None

    tool = by_name.get(parsed.get("name"))
    if tool is None:
        return None
    args = parsed.get("arguments") or {}
    args = {k: v for k, v in args.items() if k in tool.property_keys}
    return {"name": tool.name, "arguments": args}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_resolver.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/resolver.py code/reply/test_resolver.py
git commit -m "feat(reply): add tool-call resolver (regex fast-path + LLM fallback)"
```

---

### Task 6: Tool-result digest

**Files:**
- Create: `code/reply/digest.py`
- Test: `code/reply/test_digest.py`

**Interfaces:**
- Consumes: `HermesCore.ask(..., context=False, log=False, timeout=5)` (Task 1) as injected `hermes`; `HermesBackendError`.
- Produces: `tool_result_digest(tool_name: str, result: dict, question: str, model: str, hermes) -> str`. Always returns a `"TOOL RESULT (<tool_name>): ..."` string, never raises.

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/test_digest.py
from unittest.mock import MagicMock
from code.reply.digest import tool_result_digest
import hermes as hermes_module


def test_short_result_passes_through_without_llm_call():
    hermes = MagicMock()
    result = {"temp_c": "28", "condition": "Sunny"}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "28" in out
    hermes.ask.assert_not_called()


def test_long_result_triggers_llm_compression():
    hermes = MagicMock()
    hermes.ask.return_value = "It's sunny and 28C."
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out == "TOOL RESULT (getWeather): It's sunny and 28C."
    hermes.ask.assert_called_once()
    _, kwargs = hermes.ask.call_args
    assert kwargs["log"] is False


def test_long_result_fails_open_to_truncation_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "..." in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_digest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply.digest'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/digest.py
"""Compress a large tool result into a short attributed note before it
reaches the synthesis call. Short results pass through unchanged."""
import json

from hermes import HermesBackendError

DIGEST_THRESHOLD_CHARS = 400
DIGEST_TIMEOUT_SEC = 5


def tool_result_digest(tool_name: str, result: dict, question: str, model: str, hermes) -> str:
    raw = json.dumps(result, ensure_ascii=False)
    if len(raw) <= DIGEST_THRESHOLD_CHARS:
        return f"TOOL RESULT ({tool_name}): {raw}"

    system = (
        f"Compress the following {tool_name} tool result into one short "
        "attributed fact relevant to the user's question. Do not add "
        "information not present in the data."
    )
    prompt = f"Question: {question}\n\n{tool_name} raw result:\n{raw}"
    try:
        summary = hermes.ask(
            prompt, model=model, context=False, system=system,
            timeout=DIGEST_TIMEOUT_SEC, log=False,
        )
    except HermesBackendError:
        summary = raw[:DIGEST_THRESHOLD_CHARS] + "..."
    return f"TOOL RESULT ({tool_name}): {summary}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_digest.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/digest.py code/reply/test_digest.py
git commit -m "feat(reply): add tool-result digest pass for large tool outputs"
```

---

### Task 7: Engine — orchestration and fast-path skip

**Files:**
- Create: `code/reply/engine.py`
- Test: `code/reply/test_engine.py`

**Interfaces:**
- Consumes: `tool_router.route()` (Task 3), `planner.plan_query()` (Task 4), `resolver.resolve_next_tool_call()` (Task 5), `digest.tool_result_digest()` (Task 6), `Tool.execute()` (Task 2), `HermesCore.ask()` (Task 1).
- Produces: `handle(question: str, model: str, system_msg: str, hermes) -> str`. Same return type and failure mode (raises `HermesBackendError`) as a direct `hermes.ask(question, model, system=system_msg)` call — a drop-in replacement.

- [ ] **Step 1: Write the failing tests**

```python
# code/reply/test_engine.py
from unittest.mock import MagicMock, patch
from code.reply import engine
import hermes as hermes_module


def test_fast_path_skip_for_trivial_message():
    hermes = MagicMock()
    hermes.ask.return_value = "hi there"
    result = engine.handle("hi", model="qwen2.5:3b", system_msg="SYS", hermes=hermes)
    assert result == "hi there"
    # Exactly one call: no planner/resolver/digest calls for a trivial,
    # tool-free message.
    hermes.ask.assert_called_once_with("hi", "qwen2.5:3b", system="SYS")


def test_planner_says_reply_only_falls_through_to_plain_ask():
    hermes = MagicMock()
    hermes.ask.side_effect = ["Reply to the user.", "a normal chat answer"]
    # Contains "weather", so tool_router.route() returns a non-empty list --
    # the fast-path skip requires *no* matched tools, so this is routed to
    # the planner instead of being skipped; the planner then decides no
    # tool call is actually needed.
    result = engine.handle(
        "what do you think about the weather philosophically speaking",
        model="qwen2.5:3b", system_msg="SYS", hermes=hermes,
    )
    assert result == "a normal chat answer"


def test_full_tool_round_trip():
    hermes = MagicMock()
    # 1: planner call -> plan; 2: final synthesis call -> answer.
    # getWeather resolves via the resolver's regex fast-path (no extra
    # hermes.ask call), and the result is short enough to skip the digest
    # LLM call too, so exactly 2 hermes.ask calls happen in total.
    hermes.ask.side_effect = ["getWeather", "It's 28C and sunny in Cairo."]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.return_value = {"temp_c": "28", "condition": "Sunny"}
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "It's 28C and sunny in Cairo."
    assert hermes.ask.call_count == 2
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL RESULT (getWeather)" in final_call_kwargs.kwargs["system"]
    assert "ACTION PLAN" in final_call_kwargs.kwargs["system"]


def test_tool_execution_error_becomes_note_not_crash():
    hermes = MagicMock()
    hermes.ask.side_effect = ["getWeather", "sorry, I couldn't check the weather"]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.return_value = {"error": "weather backend unavailable: timeout"}
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "sorry, I couldn't check the weather"
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL_ERROR" in final_call_kwargs.kwargs["system"]


def test_planner_failure_falls_open_to_plain_ask():
    hermes = MagicMock()
    hermes.ask.side_effect = [
        hermes_module.HermesBackendError("planner timed out"),
        "a normal chat answer",
    ]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "a normal chat answer"
    assert hermes.ask.call_count == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'code.reply.engine'`

- [ ] **Step 3: Write the minimal implementation**

```python
# code/reply/engine.py
"""Orchestrates the tool-calling loop: fast-path skip -> tool router ->
planner -> resolve/execute -> digest -> final synthesis. A drop-in
replacement for a direct hermes.ask(question, model, system=system_msg)
call -- same return type, same HermesBackendError failure mode."""
from hermes import HermesBackendError
from code.reply import tool_router, planner, resolver, digest
from code.reply.tools.weather import WeatherTool
from code.reply.tools.system_stats import SystemStatsTool

FAST_PATH_MAX_WORDS = 8

ALL_TOOLS = [WeatherTool(), SystemStatsTool()]


def handle(question: str, model: str, system_msg: str, hermes) -> str:
    candidate_tools = tool_router.route(question, ALL_TOOLS)

    if not candidate_tools and len(question.split()) <= FAST_PATH_MAX_WORDS:
        return hermes.ask(question, model, system=system_msg)

    steps = planner.plan_query(question, candidate_tools, model, hermes)
    if not steps or (len(steps) == 1 and steps[0].strip().lower() == "reply to the user."):
        return hermes.ask(question, model, system=system_msg)

    result_blocks = []
    for step in steps:
        call = resolver.resolve_next_tool_call(step, candidate_tools, model, hermes)
        if call is None:
            continue
        tool = next((t for t in candidate_tools if t.name == call["name"]), None)
        if tool is None:
            continue
        try:
            raw_result = tool.execute(call["arguments"])
        except Exception as e:
            raw_result = {"error": str(e)}
        if "error" in raw_result:
            result_blocks.append(f"TOOL_ERROR: {tool.name} unavailable ({raw_result['error']})")
            continue
        result_blocks.append(
            digest.tool_result_digest(tool.name, raw_result, question, model, hermes)
        )

    plan_block = "ACTION PLAN:\n" + "\n".join(f"- {s}" for s in steps)
    full_system = system_msg + "\n\n" + plan_block
    if result_blocks:
        full_system += "\n\n" + "\n".join(result_blocks)

    return hermes.ask(question, model, system=full_system)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/venv-ai/bin/python3 -m pytest code/reply/test_engine.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/jarvis-x
git add code/reply/engine.py code/reply/test_engine.py
git commit -m "feat(reply): add engine orchestrating router -> planner -> resolver -> digest -> synthesis"
```

---

### Task 8: Wire the engine into `app.py`'s `/api/ask`

**Files:**
- Modify: `app.py:12-16` (imports), `app.py:144` (the `hermes.ask()` call site)
- Test: `test_api_ask_reply_engine_integration.py` (new, root level)

**Interfaces:**
- Consumes: `code.reply.engine.handle()` (Task 7).
- Produces: nothing new — `/api/ask`'s response shape is unchanged.

- [ ] **Step 1: Write the failing test**

This is an integration test against the real FastAPI app with Ollama and the `:8002` backend both stubbed, covering the three paths the spec calls out: fast-path skip, a real tool round-trip, and the fail-open path.

```python
# test_api_ask_reply_engine_integration.py
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import app as app_module

client = TestClient(app_module.app)


def _fake_curl(response_text):
    result = MagicMock()
    result.returncode = 0
    result.stdout = '{"response": "%s"}' % response_text
    result.stderr = ""
    return result


def test_ask_trivial_message_fast_path(tmp_path):
    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", return_value=_fake_curl("hi there")):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "hi", "tier": "local"})
    assert resp.status_code == 200
    assert resp.json()["response"] == "hi there"


def test_ask_real_tool_round_trip():
    responses = iter(["getWeather", "It's sunny and 28C in Cairo."])

    def fake_run(cmd, **kwargs):
        return _fake_curl(next(responses))

    fake_weather_resp = MagicMock()
    fake_weather_resp.json.return_value = {"temp_c": "28", "condition": "Sunny"}
    fake_weather_resp.raise_for_status.return_value = None

    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", side_effect=fake_run), \
         patch("requests.get", return_value=fake_weather_resp):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "what's the weather today", "tier": "local"})
    assert resp.status_code == 200
    assert "28" in resp.json()["response"] or "sunny" in resp.json()["response"].lower()


def test_ask_planner_timeout_falls_back_to_plain_answer():
    import subprocess

    call_count = {"n": 0}

    def fake_run(cmd, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout", 5))
        return _fake_curl("a normal chat answer")

    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", side_effect=fake_run):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "what's the weather today", "tier": "local"})
    assert resp.status_code == 200
    assert resp.json()["response"] == "a normal chat answer"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest test_api_ask_reply_engine_integration.py -v` (from `~/jarvis-x`)
Expected: FAIL on the tool-round-trip and planner-timeout tests — `/api/ask` still calls `hermes.ask()` directly, so no planner/resolver call ever happens and the mocked `subprocess.run` side effects don't line up. (The trivial-message test may already pass; that's expected and fine to leave green.)

- [ ] **Step 3: Write the minimal implementation**

In `app.py`, add the import alongside the existing local-module imports:

```python
from code.router import Router
from code.tts_engine import get_engine
from code.stt_engine import get_engine as get_stt_engine
from code.reply import engine as reply_engine
import hermes as hermes_module
```

Then in the `ask()` route handler, replace the single call:

```python
            response = hermes.ask(req.question, model, system=system_msg)
```

with:

```python
            response = reply_engine.handle(req.question, model, system_msg, hermes)
```

No other line in `ask()` changes — the `try`/`except HermesBackendError`/`finally: hermes.close()` structure around it is untouched, since `reply_engine.handle()` raises the same `HermesBackendError` on the final synthesis call's failure.

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest test_api_ask_reply_engine_integration.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `~/venv-ai/bin/python3 -m pytest -v` (from `~/jarvis-x`, root-level test files plus `code/reply/`)
Expected: PASS, all tests from Tasks 1-8 plus any pre-existing root-level tests.

- [ ] **Step 6: Manual smoke test against the real running app**

With the real `app.py` running (via supervisord or `venv-ai/bin/uvicorn app:app --host 127.0.0.1 --port 8000`) and the real `jarvis-dashboard` backend running on `:8002`:

```bash
curl -s -X POST http://127.0.0.1:8000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "what is the weather right now", "tier": "local"}' | python3 -m json.tool
```

Expected: a `response` field that actually reflects live weather data (not a generic non-answer), confirming the router → planner → resolver → tool → digest → synthesis chain fired against the real backend, not just mocks.

- [ ] **Step 7: Commit**

```bash
cd ~/jarvis-x
git add app.py test_api_ask_reply_engine_integration.py
git commit -m "feat(app): wire reply engine into /api/ask

/api/ask now routes through code/reply/engine.py's tool-calling
loop instead of calling hermes.ask() directly. Response shape and
failure mode (HermesBackendError -> 503) are unchanged."
```

## Self-Review Notes

- **Spec coverage:** Architecture (Task 8's wiring), all 6 `code/reply/` components (Tasks 2-7), the `hermes.py` `timeout`/`log` extension surfaced during planning and fixed in the spec (Task 1), error handling (fail-open tests throughout, `TOOL_ERROR` handling in Task 7), testing (unit tests per module Tasks 2-6, integration test Task 8) are all covered by a task.
- **Type consistency checked:** `Tool.property_keys` (Task 2) is read identically in `tool_router` (Task 3, only `.name`), `planner` (Task 4), `resolver` (Task 5), and `engine` (Task 7). `hermes.ask()`'s new `timeout`/`log` kwargs (Task 1) are consumed identically by name in Tasks 4, 5, and 6. `resolve_next_tool_call()`'s return shape (`{"name", "arguments"}` or `None`) matches how Task 7's `engine.py` destructures it.
- **No placeholders:** every step has runnable code, not a description of code.
