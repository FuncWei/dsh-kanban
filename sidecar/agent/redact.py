"""Compat shim for the Hermes kanban sidecar (MIT reuse).

The real ``agent.redact`` module redacts secrets from provider output before
durable storage. The sidecar implements the same intent with conservative
regexes — API keys, bearer tokens, and AWS-style access keys. Used by
``kanban_db.redact_review_value`` for review handoffs.

See NOTICE.md at the plugin root for attribution (MIT, Nous Research).
"""

from __future__ import annotations

import re

_API_KEY_RE = re.compile(r"(?i)\b(sk-[A-Za-z0-9]{8,}|api[_-]?key[\"'=:\s]+[A-Za-z0-9_\-]{12,}|ghp_[A-Za-z0-9]{20,})\b")
_BEARER_RE = re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{10,}")
_AWS_RE = re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{16}\b")


def redact_sensitive_text(text: str, force: bool = False) -> str:
    """Redact common secret shapes from *text*."""
    if not isinstance(text, str) or not text:
        return text
    out = _API_KEY_RE.sub("[REDACTED]", text)
    out = _BEARER_RE.sub(r"\1[REDACTED]", out)
    out = _AWS_RE.sub("[REDACTED]", out)
    return out
