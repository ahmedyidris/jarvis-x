"""/api/station -- the four endpoints the handoff named, plus a task list.

    GET  /api/station/agents                     list, with live status
    POST /api/station/agents/{id}/chat           talk; waits for the answer
    GET  /api/station/agents/{id}/transcript     what was said
    POST /api/station/agents/{id}/task           queue work; returns at once
    GET  /api/station/agents/{id}/tasks          where queued work stands

Every route sits behind app.py's require_token, passed in rather than
imported: app.py is local-owned, and taking the dependency as an argument
means this module never imports app.py (which starts services on import).
"""
from concurrent.futures import TimeoutError as FutureTimeout

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from code.station.worker import ModelError, StationStopped, UnknownAgent

MAX_TEXT = 8000


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_TEXT)


class TaskBody(BaseModel):
    task: str = Field(min_length=1, max_length=MAX_TEXT)


def make_router(station, require_token):
    router = APIRouter(prefix="/api/station", dependencies=[Depends(require_token)])

    def known(agent_id):
        try:
            return station.agent(agent_id)
        except UnknownAgent:
            raise HTTPException(status_code=404, detail=f"no agent '{agent_id}' in config/agents.yaml")

    def stopped():
        return HTTPException(status_code=503, detail="kill switch engaged (.jarvis-x-STOP) -- agents will not run")

    @router.get("/agents")
    def list_agents():
        return {"agents": station.status(), "stopped": bool(station.is_stopped())}

    # Plain `def`, not `async def`: FastAPI runs these on its threadpool, so a
    # chat blocking on its agent's worker never stalls the event loop that
    # serves the rest of app.py.
    @router.post("/agents/{agent_id}/chat")
    def chat(agent_id: str, body: ChatBody):
        known(agent_id)
        try:
            return station.chat(agent_id, body.message.strip())
        except StationStopped:
            raise stopped()
        except ModelError as e:
            raise HTTPException(status_code=502, detail=f"model unavailable: {e}")
        except FutureTimeout:
            raise HTTPException(status_code=504, detail="still working -- the answer will appear in the transcript")

    @router.get("/agents/{agent_id}/transcript")
    def transcript(agent_id: str, limit: int = Query(50, ge=1, le=500)):
        known(agent_id)
        return {"agent": agent_id, "turns": station.store.transcript(agent_id, limit=limit)}

    @router.post("/agents/{agent_id}/task", status_code=202)
    def task(agent_id: str, body: TaskBody):
        known(agent_id)
        try:
            return station.submit_task(agent_id, body.task.strip())
        except StationStopped:
            raise stopped()

    @router.get("/agents/{agent_id}/tasks")
    def tasks(agent_id: str, limit: int = Query(50, ge=1, le=500)):
        known(agent_id)
        return {"agent": agent_id, "tasks": station.store.tasks(agent_id, limit=limit)}

    return router
