"""Triage agent — covers HF's Token Classification (entity extraction) and
Zero-Shot Classification (severity/category) tasks via a prompted local LLM
instead of separate fine-tuned pipelines, to stay light on this hardware.
See sentinel/README.md#hf-task-mapping for the swap-in path to real HF
models (e.g. dslim/bert-base-NER) when running off this Chromebook.
"""
from agents.llm import get_llm
from agents.util import extract_json

PROMPT = """You are an SRE triage assistant. Given the incident text below, extract:
- entities: services, error codes, HTTP status codes, regions/hosts mentioned
- severity: one of sev1, sev2, sev3, sev4 (sev1 = full outage, sev4 = minor/cosmetic)
- category: one of database, network, application, infra, unknown

Respond with ONLY a JSON object like:
{{"entities": {{"services": [], "error_codes": [], "regions": []}}, "severity": "sev2", "category": "database"}}

Incident:
\"\"\"{incident}\"\"\"
"""


def triage_node(state: dict) -> dict:
    llm = get_llm()
    resp = llm.invoke(PROMPT.format(incident=state["raw_input"]))
    parsed = extract_json(resp.content)
    return {
        "entities": parsed.get("entities", {}),
        "severity": parsed.get("severity", "unknown"),
        "category": parsed.get("category", "unknown"),
    }
