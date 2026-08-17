"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_cli/profiles.py`` manages the full Hermes profile system
(yaml config, gateway status, service managers). The kanban engine only
calls two of its helpers, so this module provides faithful equivalents:

  * ``normalize_profile_name`` — canonical profile id (lowercase; the
    ``default`` alias matches case-insensitively), same rules as upstream.
  * ``get_active_profile_name`` — returns ``"default"``: the DSH sidecar
    has a single board root and no Hermes profile layout.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations


def normalize_profile_name(name: str) -> str:
    """Return the canonical profile id used on disk and in CLI ``-p`` argv."""
    if not isinstance(name, str):
        name = str(name)
    stripped = name.strip()
    if not stripped:
        raise ValueError("profile name cannot be empty")
    if stripped.casefold() == "default":
        return "default"
    return stripped.lower()


def validate_profile_name(name: str) -> None:
    """Raise ``ValueError`` if *name* is not a valid profile identifier."""
    if not isinstance(name, str) or not name or name != name.lower():
        raise ValueError(f"invalid profile name: {name!r}")


def get_active_profile_name() -> str:
    """The sidecar has no Hermes profile layout — always ``default``."""
    return "default"
