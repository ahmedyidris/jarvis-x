"""FastAPI entrypoint: POST /incident runs the full agent graph and
returns the trace + final report. Run with:

    uvicorn app.main:app --reload --port 8420
"""
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from app.graph import build_graph

app = FastAPI(title="Sentinel", description="Autonomous incident response copilot")
_graph = build_graph()

# Optional shared-secret auth, unset by default -- set SENTINEL_API_TOKEN to
# require an "X-Sentinel-Token" header on /incident. Same opt-in pattern as
# jarvis-x's app.py.
API_TOKEN = os.environ.get("SENTINEL_API_TOKEN")


def require_token(x_sentinel_token: str = Header(default=None)):
    if API_TOKEN and x_sentinel_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="missing or invalid X-Sentinel-Token header")


class IncidentRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/incident", dependencies=[Depends(require_token)])
def run_incident(req: IncidentRequest):
    try:
        result = _graph.invoke({"raw_input": req.text, "revisions": 0})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"incident graph failed: {e}")
    return result
