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
