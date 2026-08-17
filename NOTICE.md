# Third-Party Notices

dsh-kanban reuses, with gratitude, the kanban implementation from
**Hermes Agent** by **Nous Research** (https://github.com/NousResearch/hermes-agent),
licensed under the **MIT License** (© 2025-2026 Nous Research).

The following files in `sidecar/` are copied from or derived from the Hermes
Agent repository (paths relative to the Hermes Agent repo root):

| In dsh-kanban | From Hermes Agent | Note |
|---|---|---|
| `sidecar/hermes_cli/kanban_db.py` | `hermes_cli/kanban_db.py` | copied (SQLite board engine) |
| `sidecar/hermes_cli/kanban_diagnostics.py` | `hermes_cli/kanban_diagnostics.py` | copied |
| `sidecar/hermes_cli/sqlite_util.py` | `hermes_cli/sqlite_util.py` | copied |
| `sidecar/hermes_cli/sqlite_safe_read.py` | `hermes_cli/sqlite_safe_read.py` | copied |
| `sidecar/hermes_cli/_subprocess_compat.py` | `hermes_cli/_subprocess_compat.py` | copied |
| `sidecar/hermes_cli/__init__.py` | `hermes_cli/__init__.py` | copied (docstring only) |
| `sidecar/hermes_constants.py` | `hermes_constants.py` | copied |
| `sidecar/toolsets.py` | `toolsets.py` | copied |
| `sidecar/plugin_api.py` | `plugins/kanban/dashboard/plugin_api.py` | copied (WS auth helper relies on the upstream fallback path) |
| `sidecar/web/dist/index.js` | `plugins/kanban/dashboard/dist/index.js` | copied (board UI) |
| `sidecar/web/dist/style.css` | `plugins/kanban/dashboard/dist/style.css` | copied |

Compat shims written by the dsh-kanban project (small, self-contained,
documented in each file): `sidecar/hermes_cli/{hermes_state,profiles,config}.py`,
`sidecar/agent/{memory_manager,redact}.py`, `sidecar/main.py`,
`sidecar/web/kanban.html`.

React 18 UMD in `sidecar/web/vendor/` is distributed under the MIT License
(© Meta Platforms, Inc. and affiliates).

## MIT License (Hermes Agent)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
