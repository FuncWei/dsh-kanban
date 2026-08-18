"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``hermes_cli/profile_describer.py`` generates a profile
description by asking the auxiliary LLM (``auxiliary.profile_describer``)
to summarise the profile's environment / tooling notes. The DSH sidecar
has a single ``default`` profile with no auxiliary client, so the honest
behaviour is a deterministic, human-reasonable auto description that is
persisted (``description_auto: true``) — the dashboard's "review" badge
then behaves exactly like upstream, minus the LLM round-trip.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from hermes_cli.profiles import (
    get_profile_dir,
    normalize_profile_name,
    profile_exists,
    write_profile_meta,
)


@dataclass
class DescribeOutcome:
    """Shape mirroring upstream's profile describer outcome."""

    ok: bool
    profile_name: str
    reason: str = ""
    description: str = ""


def describe_profile(
    profile_name: str,
    *,
    overwrite: bool = False,
) -> DescribeOutcome:
    """Auto-generate and persist a description for *profile_name*.

    Fail-open by design: the sidecar has no auxiliary LLM, so instead of
    crashing with a 500 we produce a short deterministic description the
    operator can edit right in the dashboard.
    """
    canon = normalize_profile_name(profile_name)
    if canon != "default" and not profile_exists(canon):
        return DescribeOutcome(
            ok=False,
            profile_name=canon,
            reason="profile does not exist",
        )
    # Only overwrite an existing manual description when asked to.
    if not overwrite:
        try:
            from hermes_cli.profiles import read_profile_meta

            meta = read_profile_meta(get_profile_dir(canon))
            if meta.get("description"):
                return DescribeOutcome(
                    ok=True,
                    profile_name=canon,
                    reason="already has a description",
                    description=meta["description"],
                )
        except Exception:
            pass
    description = "默认看板档案 — 由 DSH 自动生成，可在看板内直接编辑。"
    try:
        write_profile_meta(
            get_profile_dir(canon),
            description=description,
            description_auto=True,
        )
    except Exception as exc:  # pragma: no cover - defensive
        return DescribeOutcome(
            ok=False,
            profile_name=canon,
            reason=f"persist failed: {exc}",
        )
    return DescribeOutcome(ok=True, profile_name=canon, description=description)