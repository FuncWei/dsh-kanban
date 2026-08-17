"""dsh-kanban sidecar — run the Hermes (MIT) kanban backend + dashboard standalone.

Reuses, verbatim, the Hermes Agent kanban implementation:
  * hermes_cli/kanban_db.py           — SQLite board engine (schema, state machine,
                                        claim locks, circuit breaker, runs, boards)
  * hermes_cli/kanban_diagnostics.py  — diagnostics + recovery actions
  * hermes_cli/sqlite_util.py         — tiny helper
  * toolsets.py                       — toolset name registry
  * plugin_api.py                     — the full REST API (FastAPI router)
  * web/dist/{index.js,style.css}     — the prebuilt board UI (plain IIFE)

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).

This file is the only "glue" on the Python side:
  * pins HERMES_HOME to the DSH storage dir BEFORE any hermes_cli import,
  * adds a bearer-token gate for /api/* (the WS gate inside plugin_api.py
    already falls back to accept when the Hermes dashboard is absent),
  * serves the board page with the small __HERMES_PLUGIN_SDK__ shim the
    dist bundle expects.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

# --- 1. environment, before any hermes_cli import ----------------------------
_HERE = Path(__file__).parent
DSH_HOME = os.environ.get("DSH_HOME", os.path.expanduser("~/.dsh"))
ROOT = Path(os.environ.get("DSH_KANBAN_ROOT", os.path.join(DSH_HOME, "storages", "kanban")))
TOKEN = os.environ.get("DSH_KANBAN_TOKEN", "")
PORT = int(os.environ.get("DSH_KANBAN_PORT", "0"))

ROOT.mkdir(parents=True, exist_ok=True)
os.environ["HERMES_HOME"] = str(ROOT)
sys.path.insert(0, str(_HERE))

# --- 2. hermes_cli imports (now safe: HERMES_HOME is pinned) -----------------
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import HTMLResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from plugin_api import router as kanban_router  # noqa: E402
from plugin_api import stream_events  # noqa: E402
from dsh_dispatcher import dispatch_tick, start_monitor  # noqa: E402
from pydantic import BaseModel  # noqa: E402


class DshTickBody(BaseModel):
    board: Optional[str] = None
    max: int = 0  # 0 = sidecar default (DSH_KANBAN_MAX_WORKERS, else 4)
    dry_run: bool = False


app = FastAPI(title="dsh-kanban sidecar", docs_url=None, redoc_url=None)


@app.middleware("http")
async def token_gate(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        if TOKEN:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {TOKEN}" and request.query_params.get("token") != TOKEN:
                return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


_HTML = (_HERE / "web" / "kanban.html").read_text(encoding="utf-8")


@app.get("/kanban", response_class=HTMLResponse)
async def kanban_page():
    return _HTML.replace("__DSH_KANBAN_TOKEN__", TOKEN)


@app.post("/api/plugins/kanban/dsh/tick")
async def dsh_tick(payload: DshTickBody):
    """One DSH-native dispatcher tick (claim + spawn DSH headless workers)."""
    return dispatch_tick(board=payload.board, max_n=payload.max or 4, dry_run=payload.dry_run)


app.include_router(kanban_router, prefix="/api/plugins/kanban")
# FastAPI 0.141's deferred included-router matching misses websocket scopes;
# register the one WS route explicitly so the board's live events work.
app.add_api_websocket_route("/api/plugins/kanban/events", stream_events)
app.mount("/kanban/dist", StaticFiles(directory=str(_HERE / "web" / "dist")), name="kanban-dist")
app.mount("/kanban/vendor", StaticFiles(directory=str(_HERE / "web" / "vendor")), name="kanban-vendor")

if __name__ == "__main__":
    import uvicorn

    start_monitor()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
