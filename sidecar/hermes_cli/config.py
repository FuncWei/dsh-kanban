"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_cli/config.py`` loads the full Hermes config.yaml (yaml,
migrations, profile overlays). The kanban engine only calls ``load_config``
to derive diagnostics thresholds; every missing key falls back to the
diagnostics engine's ``DEFAULT_CONFIG``. An empty dict preserves that
behaviour, and the DSH plugin can extend this module's env override later.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

import json
import os

_CONFIG_ENV = "DSH_KANBAN_CONFIG_JSON"


def load_config() -> dict:
    """Return the (empty) runtime config; DSH_KANBAN_CONFIG_JSON overrides."""
    raw = os.environ.get(_CONFIG_ENV, "")
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}
