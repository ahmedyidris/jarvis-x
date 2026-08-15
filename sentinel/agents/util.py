"""Small helpers shared by more than one agent node. Pulled out of
triage.py/critic.py/hypothesis.py where they'd started to drift apart as
copy-pasted duplicates -- kept here so a fix applies everywhere at once.
"""
import json
import re


def format_evidence(retrieved: list[dict], show_score: bool = False) -> str:
    if not retrieved:
        return "(none retrieved)"
    if show_score:
        return "\n".join(f"- [{r['score']:.2f}] {r['text'][:300]}" for r in retrieved)
    return "\n".join(f"- {r['text'][:300]}" for r in retrieved)


def extract_json(text: str, default: dict | None = None) -> dict:
    """Pull the first {...} block out of an LLM response and parse it.

    If no JSON-shaped block is found: returns `default` when one was given,
    otherwise raises ValueError. A block that IS found but fails to parse
    always raises json.JSONDecodeError -- callers that want a soft fallback
    for that case should catch it themselves (matches each call site's
    original behavior; critic.py's fallback only ever covered the no-match
    case, not malformed-but-present JSON).
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        if default is not None:
            return default
        raise ValueError(f"No JSON object found in output: {text!r}")
    return json.loads(match.group(0))
