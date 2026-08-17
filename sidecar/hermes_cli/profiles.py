"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_cli/profiles.py`` manages the full Hermes profile system
(yaml config, gateway status, service managers, wrapper scripts). The kanban
engine + dashboard only call a handful of its helpers, so this module
provides faithful equivalents:

  * ``normalize_profile_name`` / ``validate_profile_name`` — canonical id
    rules, same as upstream.
  * ``get_active_profile_name`` — the sidecar's board root is the single
    "default" profile.
  * ``list_profiles`` — the roster the dashboard's orchestration panel
    renders: exactly one ``default`` profile pointing at the board root.
  * ``profile_exists`` / ``get_profile_dir`` / ``resolve_profile_env`` —
    path resolution used by dispatch claim and profile routes.
  * ``read_profile_meta`` / ``write_profile_meta`` — the optional
    `<root>/profile.yaml` description the dashboard's description editor
    uses (parsed without a yaml dependency).

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from hermes_constants import get_hermes_home


@dataclass
class ProfileInfo:
    """Summary information about a profile (subset of upstream's shape)."""

    name: str
    path: Path
    is_default: bool
    gateway_running: bool = False
    model: Optional[str] = None
    provider: Optional[str] = None
    has_env: bool = False
    skill_count: int = 0
    alias_path: Optional[Path] = None
    alias_name: Optional[str] = None
    distribution_name: Optional[str] = None
    distribution_version: Optional[str] = None
    distribution_source: Optional[str] = None
    description: str = ""
    description_auto: bool = False
    extra: dict = field(default_factory=dict)


def _default_home() -> Path:
    return Path(get_hermes_home())


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
    """The sidecar has a single board root — always ``default``."""
    return "default"


def get_profile_dir(name: str) -> Path:
    """Resolve a profile name to its HERMES_HOME directory."""
    canon = normalize_profile_name(name)
    if canon == "default":
        return _default_home()
    return _default_home() / "profiles" / canon


def profile_exists(name: str) -> bool:
    """Whether *name* names a spawnable assignee.

    The upstream Hermes engine uses this to refuse to auto-spawn tasks
    whose assignee is not a real Hermes profile (its worker is
    ``hermes -p <assignee>``). In the DSH sidecar the worker command is
    fixed (``dsh --profile headless``) and the assignee is a routing
    label, not a host profile — so any well-formed name is spawnable.
    ``default`` always exists by construction.
    """
    canon = normalize_profile_name(name)
    if canon == "default":
        return True
    try:
        validate_profile_name(canon)
    except ValueError:
        return False
    return True


def resolve_profile_env(profile_name: str) -> str:
    """Resolve a profile name to a HERMES_HOME path string."""
    canon = normalize_profile_name(profile_name)
    validate_profile_name(canon)
    profile_dir = get_profile_dir(canon)
    if canon != "default" and not profile_dir.is_dir():
        raise FileNotFoundError(
            f"Profile '{canon}' does not exist."
        )
    return str(profile_dir)


def _meta_path(profile_dir: Path) -> Path:
    return Path(profile_dir) / "profile.yaml"


def read_profile_meta(profile_dir: Path) -> dict:
    """Read the optional profile description from ``profile.yaml``."""
    try:
        text = _meta_path(profile_dir).read_text(encoding="utf-8")
    except OSError:
        return {}
    meta: dict = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("description:"):
            meta["description"] = line.split(":", 1)[1].strip().strip("'\"")
        elif line.startswith("description_auto:"):
            meta["description_auto"] = line.split(":", 1)[1].strip().lower() == "true"
    return meta


def write_profile_meta(
    profile_dir: Path,
    *,
    description: Optional[str] = None,
    description_auto: Optional[bool] = None,
) -> None:
    """Persist profile description fields (additive, minimal yaml-ish)."""
    path = _meta_path(profile_dir)
    lines = []
    if path.exists():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
    kept = [ln for ln in lines if not ln.strip().startswith(("description:", "description_auto:"))]
    if description is not None:
        kept.append(f"description: {description!r}")
    if description_auto is not None:
        kept.append(f"description_auto: {'true' if description_auto else 'false'}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")


def list_profiles() -> List[ProfileInfo]:
    """Return the roster: one ``default`` profile at the board root."""
    home = _default_home()
    meta = read_profile_meta(home)
    return [
        ProfileInfo(
            name="default",
            path=home,
            is_default=True,
            has_env=(home / ".env").exists(),
            description=meta.get("description", ""),
            description_auto=bool(meta.get("description_auto", False)),
        )
    ]
