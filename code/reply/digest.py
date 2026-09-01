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
