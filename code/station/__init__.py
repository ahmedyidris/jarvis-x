"""The Station: Jarvis X's own multi-agent desk (handoff Priority 3).

config/agents.yaml is the roster. Each agent gets one worker thread, a
transcript and a task log under logs/station/<id>/, and four HTTP endpoints
under /api/station (see api.py). Agents write text only: no tools, no
shell, no files.

app.py mounts it with one call (local-owned file -- see docs/STATION.md):

    from code.station import mount_station
    mount_station(app, require_token, Path(__file__).parent)
"""
from pathlib import Path


def mount_station(app, require_token, repo_root):
    """Build the station from the repo, start its workers, and put its routes
    FIRST in the app's route table.

    First, not appended: app.py ends with a catch-all GET /{full_path:path}
    (the SPA fallback), and routes match in order, so a router included
    after it would never see a GET. The handoff's fix 7 was this exact bug
    for /v1. Moving the station's own routes to the front is safe because
    every one of them starts with /api/station, which nothing else claims.
    """
    from code.station.api import make_router
    from code.station.worker import Station

    station = Station.from_repo(Path(repo_root))
    station.start()
    before = len(app.router.routes)
    app.include_router(make_router(station, require_token))
    added = app.router.routes[before:]
    del app.router.routes[before:]
    app.router.routes[0:0] = added
    return station
