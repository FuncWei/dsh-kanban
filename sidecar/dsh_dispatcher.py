"""dsh-kanban dispatcher glue (our code, not from Hermes).

Reuses the Hermes kanban engine's dispatcher seam — ``kanban_db.dispatch_once``
accepts a ``spawn_fn(task, workspace_path, board) -> Optional[int]`` callback
and handles claim locks, stale-claim reclaim, crash detection, failure
counting with circuit-breaker auto-block, and max-concurrency. This module
plugs a **DSH worker** into that seam:

  * ``spawn_fn`` launches ``<worker cmd> "<prompt>"`` (default:
    ``dsh --profile headless``) with the card's workspace as cwd and returns
    the worker PID.
  * a monitor thread heartbeats running cards (``heartbeat_worker``) and, on
    worker exit, records completion (``complete_task`` with stdout tail as
    result) or failure (``_record_task_failure`` with stderr tail) — the
    DSH-native equivalent of the Hermes gateway dispatcher loop.

See NOTICE.md for Hermes attribution (MIT, Nous Research).
"""

from __future__ import annotations

import logging
import os
import shlex
import subprocess
import threading
import time
from typing import Optional

from hermes_cli import kanban_db

log = logging.getLogger(__name__)

WORKER_CMD = os.environ.get("DSH_KANBAN_WORKER_CMD", "dsh --profile headless")
MAX_WORKERS = int(os.environ.get("DSH_KANBAN_MAX_WORKERS", "4"))
HEARTBEAT_SECONDS = 15
TAIL_CHARS = 4000


def _tail(text: str, limit: int = TAIL_CHARS) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[-limit:]


class DshWorkerRunner:
    """Spawns and supervises DSH CLI workers for claimed kanban tasks."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._workers: dict[str, dict] = {}  # task_id -> {proc, board, last_hb}
        self._stop = threading.Event()

    # -- dispatcher seam -----------------------------------------------------
    def spawn_fn(self, task, workspace_path: Optional[str], board: Optional[str]) -> Optional[int]:
        """Launch one DSH headless worker for *task*; return its PID."""
        prompt = f"Task: {task.title}\n\n{task.body or ''}\n\n"
        prompt += (
            "Work on this task to completion. Your final message must state "
            "the outcome: DONE plus a short summary of what was produced, or "
            "BLOCKED plus the reason."
        )
        try:
            cmd = shlex.split(WORKER_CMD) + [prompt]
        except ValueError:
            cmd = WORKER_CMD.split() + [prompt]
        cwd = workspace_path if workspace_path else None
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
        except Exception as exc:
            log.error("dsh-kanban: worker spawn failed for %s: %s", task.id, exc)
            return None
        with self._lock:
            self._workers[task.id] = {
                "proc": proc,
                "board": board,
                "last_hb": time.time(),
            }
        log.info("dsh-kanban: spawned worker pid=%s for %s", proc.pid, task.id)
        return proc.pid

    # -- supervision ---------------------------------------------------------
    def monitor_forever(self, poll_seconds: float = 2.0) -> None:
        """Heartbeat running workers and finalize them on exit."""
        while not self._stop.wait(poll_seconds):
            self._monitor_once()

    def _monitor_once(self) -> None:
        with self._lock:
            snapshot = list(self._workers.items())
        now = time.time()
        for task_id, entry in snapshot:
            proc = entry["proc"]
            board = entry["board"]
            rc = proc.poll()
            if rc is None:
                if now - entry["last_hb"] >= HEARTBEAT_SECONDS:
                    try:
                        conn = kanban_db.connect(board=board)
                        try:
                            if kanban_db.heartbeat_worker(conn, task_id, note="dsh worker alive"):
                                entry["last_hb"] = now
                        finally:
                            conn.close()
                    except Exception as exc:
                        log.warning("dsh-kanban: heartbeat for %s failed: %s", task_id, exc)
                continue
            # Worker exited — finalize.
            self._finalize(task_id, board, proc, rc)
            with self._lock:
                self._workers.pop(task_id, None)

    def _finalize(self, task_id: str, board, proc, rc: int) -> None:
        try:
            out = _tail(proc.stdout.read().decode("utf-8", "replace"))
        except Exception:
            out = ""
        try:
            err = _tail(proc.stderr.read().decode("utf-8", "replace"))
        except Exception:
            err = ""
        try:
            conn = kanban_db.connect(board=board)
            try:
                if rc == 0:
                    kanban_db.complete_task(
                        conn,
                        task_id,
                        result=out or "completed",
                        summary=out[:400] if out else None,
                    )
                    log.info("dsh-kanban: %s completed (rc=0)", task_id)
                else:
                    kanban_db._record_task_failure(
                        conn,
                        task_id,
                        error=err or out or f"worker exited with code {rc}",
                        outcome="failed",
                        release_claim=True,
                        end_run=True,
                    )
                    log.warning("dsh-kanban: %s failed (rc=%s)", task_id, rc)
            finally:
                conn.close()
        except Exception as exc:
            log.error("dsh-kanban: finalize for %s failed: %s", task_id, exc)

    def stop(self) -> None:
        self._stop.set()


runner = DshWorkerRunner()


def dispatch_tick(board: Optional[str] = None, max_n: int = MAX_WORKERS, dry_run: bool = False) -> dict:
    """Run one dispatcher tick with DSH workers as the spawn backend."""
    conn = kanban_db.connect(board=board)
    try:
        result = kanban_db.dispatch_once(
            conn,
            spawn_fn=runner.spawn_fn,
            max_spawn=max_n,
            dry_run=dry_run,
            board=board,
        )
        return {
            "spawned": getattr(result, "spawned", []),
            "reclaimed": getattr(result, "reclaimed", []),
            "crashed": getattr(result, "crashed", []),
            "stale": getattr(result, "stale", []),
            "timed_out": getattr(result, "timed_out", []),
            "promoted": getattr(result, "promoted", []),
            "auto_blocked": getattr(result, "auto_blocked", []),
            "skipped_locked": getattr(result, "skipped_locked", False),
        }
    finally:
        conn.close()


def start_monitor() -> threading.Thread:
    thread = threading.Thread(target=runner.monitor_forever, name="dsh-kanban-monitor", daemon=True)
    thread.start()
    return thread
