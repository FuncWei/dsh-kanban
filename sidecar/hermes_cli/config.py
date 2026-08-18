"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_cli/config.py`` loads the full Hermes config.yaml (yaml,
migrations, profile overlays). The kanban engine only calls ``load_config``
(for diagnostics thresholds) and ``load_config``/``save_config`` (for the
orchestration knobs under the ``kanban`` key). This shim persists the
config as a small JSON file at ``<root>/config.json`` (no yaml dependency),
with ``DSH_KANBAN_CONFIG_JSON`` as a last-resort override for read-only
deployments that want to seed defaults without a writable store.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

_CONFIG_ENV = "DSH_KANBAN_CONFIG_JSON"


def _config_path() -> Path:
    root = os.environ.get("HERMES_HOME") or os.environ.get("DSH_KANBAN_ROOT", "")
    if root:
        return Path(root) / "config.json"
    return Path.home() / ".hermes" / "config.json"


def load_config() -> dict:
    """Return the runtime config: disk file first, env override as fallback."""
    path = _config_path()
    try:
        if path.is_file():
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
    except Exception:
        pass
    raw = os.environ.get(_CONFIG_ENV, "")
    if raw:
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else {}
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    """Persist the config dict to ``<root>/config.json`` (atomic write)."""
    if not isinstance(cfg, dict):
        cfg = {}
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix="cfg-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
