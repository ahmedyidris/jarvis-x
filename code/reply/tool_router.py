"""Keyword-based tool router.

v1 deliberately skips embedding-based relevance filtering (isair/jarvis's
approach, needed to scale past 30+ tools) -- with 2 tools a static keyword
map is sufficient. Revisit as its own future slice once the tool catalogue
actually grows; see the design spec's Non-goals.
"""
import re

# Short, collision-prone keywords that substring-match inside unrelated
# words (e.g. "ram" inside "program", "grammar", "diagram", "parameter").
# These use word-boundary regex matching instead of plain substring `in`.
_WORD_KEYS = {"ram", "cpu", "disk", "load"}


def _hit(kw: str, q: str) -> bool:
    if kw in _WORD_KEYS:
        return re.search(rf"\b{re.escape(kw)}\b", q) is not None
    return kw in q


KEYWORDS = {
    "getWeather": (
        "weather", "temperature", "forecast", "rain", "sunny", "cloudy",
        "humidity", "hot outside", "cold outside",
        "الجو", "الطقس", "حرارة", "الدنيا حر", "الدنيا برد",
    ),
    "getSystemStats": (
        "cpu", "memory", "ram", "disk", "storage", "uptime", "load average",
        "system stats", "processor",
        "معالج", "المعالج", "ذاكرة", "الرامات", "تخزين", "القرص", "مساحة التخزين",
    ),
}


def route(question: str, tools: list) -> list:
    q = question.lower()
    matched_names = {
        name for name, keywords in KEYWORDS.items()
        if any(_hit(kw, q) for kw in keywords)
    }
    return [t for t in tools if t.name in matched_names]
