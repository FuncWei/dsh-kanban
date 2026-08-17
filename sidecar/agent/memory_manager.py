"""Compat shim for the Hermes kanban sidecar (MIT reuse).

`hermes_state.py` imports `sanitize_context` from the full Hermes
`agent.memory_manager`. The sidecar does not need the whole agent package —
this module provides the same signature with the same tag-stripping intent:
remove `<memory-context>…</memory-context>` blocks, `[SYSTEM NOTE …]` lines,
and fence tags from worker output before it is stored.

See NOTICE.md at the plugin root for attribution.
"""

import re

_INTERNAL_CONTEXT_RE = re.compile(r"<memory-context>.*?</memory-context>", re.DOTALL)
_INTERNAL_NOTE_RE = re.compile(r"\[SYSTEM NOTE[^\]]*\][^\n]*\n?")
_FENCE_TAG_RE = re.compile(r"</?(memory-context|system-note|internal)[^>]*>")


def sanitize_context(text: str) -> str:
    """Strip injected context blocks, system notes, and fence tags."""
    if not text:
        return text
    text = _INTERNAL_CONTEXT_RE.sub("", text)
    text = _INTERNAL_NOTE_RE.sub("", text)
    text = _FENCE_TAG_RE.sub("", text)
    return text
