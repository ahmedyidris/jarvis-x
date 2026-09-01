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
