"""Shared state schema passed between every node in the incident graph."""
from typing import Any, TypedDict


class IncidentState(TypedDict, total=False):
    raw_input: str            # the alert / log excerpt / on-call description
    entities: dict[str, Any]  # services, error codes, regions extracted by triage
    severity: str             # sev1-sev4
    category: str             # database | network | application | infra | unknown
    retrieved: list[dict]     # top-k similar runbooks/past incidents from the store
    hypothesis: str           # root-cause hypothesis
    critique: dict[str, Any]  # {"grounded": bool, "score": 1-5, "notes": str}
    revisions: int            # how many times hypothesis has been sent back
    report: str               # final markdown incident report
