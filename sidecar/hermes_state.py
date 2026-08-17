"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_state.py`` is the full SessionDB stack (session schema,
search, portability) and drags in most of the Hermes ``agent`` package. The
kanban sidecar only needs two of its helpers on the board's DB-open path, so
this module provides faithful, self-contained equivalents:

  * ``preflight_db_writability`` — refuse-or-repair read-only DB files before
    the first connection opens (port of Kilo-Org/kilocode#12508).
  * ``apply_wal_with_fallback`` — set ``journal_mode=WAL``, fall back to
    DELETE on WAL-incompatible filesystems; honours ``require_wal``.

``SessionDB`` is stubbed: the kanban engine only imports it on the Hermes
worker-spawn path, which dsh-kanban replaces with the DSH-native dispatcher.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path

from hermes_constants import get_hermes_home

log = logging.getLogger(__name__)


class WalUnsupportedError(RuntimeError):
    """Raised by apply_wal_with_fallback(require_wal=True) on WAL-hostile FS."""


def preflight_db_writability(db_path: Path, *, db_label: str = "state.db") -> None:
    """Repair-or-refuse read-only DB files before the first connection opens.

    * chmod u+rw repair when the file lives inside the Hermes home tree
      (here: the DSH kanban storage root);
    * fail fast with an actionable error naming the exact file otherwise.
    Never deletes or truncates a WAL sidecar.
    """
    raw = str(db_path)
    if raw == ":memory:" or raw.startswith("file:"):
        return

    try:
        home = Path(get_hermes_home()).resolve()
    except Exception:
        home = None

    def _in_repair_scope(p: Path) -> bool:
        if home is None:
            return False
        try:
            return p.resolve().is_relative_to(home)
        except Exception:
            return False

    for p in (db_path, Path(raw + "-wal"), Path(raw + "-shm")):
        if not p.exists():
            continue
        if not os.access(p, os.W_OK):
            if _in_repair_scope(p):
                try:
                    p.chmod(p.stat().st_mode | 0o600)
                    log.warning("%s: repaired permissions on %s (chmod u+rw)", db_label, p)
                    continue
                except Exception as exc:
                    raise OSError(
                        f"{db_label}: cannot repair permissions on {p}: {exc}"
                    ) from exc
            raise OSError(
                f"{db_label}: {p} is not writable by this user; run: "
                f"chmod u+rw {p!s}"
            )
    # Parent directory must be writable for fresh DBs and WAL sidecars.
    parent = db_path.parent
    if not parent.exists():
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            raise OSError(f"{db_label}: cannot create directory {parent}: {exc}") from exc
    if not os.access(parent, os.W_OK):
        raise OSError(f"{db_label}: directory {parent} is not writable by this user")


_WAL_INCOMPAT_MARKERS = (
    "locking protocol",
    "disk i/o error",
    "unable to open database file",
)


def apply_wal_with_fallback(
    conn: sqlite3.Connection,
    *,
    db_label: str = "state.db",
    require_wal: bool = False,
) -> str:
    """Set ``journal_mode=WAL``, falling back to DELETE on failure.

    Returns the journal mode actually set ("wal" or "delete"). On
    WAL-incompatible filesystems (NFS/SMB/FUSE/ZFS) SQLite either raises or
    silently keeps DELETE; the degradation is logged and, unless
    ``require_wal`` is set, DELETE is kept so the board keeps working.
    """
    try:
        mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        lowered = str(mode).lower()
        if lowered != "wal":
            raise sqlite3.OperationalError(f"journal_mode stayed {mode}")
        return "wal"
    except sqlite3.OperationalError as exc:
        err = str(exc).lower()
        marker = next((m for m in _WAL_INCOMPAT_MARKERS if m in err), "")
        if require_wal:
            raise WalUnsupportedError(
                f"{db_label}: WAL is required but unavailable on this "
                f"filesystem ({marker or err})"
            ) from exc
        log.error(
            "%s: WAL unavailable (%s); falling back to DELETE journal mode",
            db_label, marker or err,
        )
        try:
            conn.execute("PRAGMA journal_mode=DELETE")
        except Exception:
            pass
        return "delete"


class SessionDB:  # pragma: no cover - DSH dispatcher replaces this path
    """Stub — the kanban engine imports this only on the Hermes worker-spawn
    path, which dsh-kanban replaces with the DSH-native dispatcher."""

    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "SessionDB is not part of the dsh-kanban sidecar; the Hermes "
            "worker-spawn path is replaced by the DSH-native dispatcher."
        )
