# dsh-kanban · Task board for DeepSeek Harness

A DeepSeek Harness plugin that brings the full **Hermes kanban board** (Nous
Research, MIT) into DSH: the complete board engine and UI run as a local
sidecar, while DSH adds web-server integration, model tools, and a
**DSH-native dispatcher** that executes cards with `dsh --profile headless`
workers.

> Hermes parity: 9-column board, multiple boards, comments / attachments /
> links / event timeline, run records, diagnostics with recovery actions,
> claim locks + circuit breaker, live updates over WebSocket.

## Features

- **9 columns**: triage / todo / scheduled / ready / running / blocked / review / done / archived — drag & drop, multi-select bulk actions
- **Full cards**: body, assignee, priority, parent/child dependencies, tenant, workspace, model overrides, goal mode
- **Card drawer**: comments, attachments, links, events, runs, diagnostics (with one-click recovery actions), worker logs
- **Multiple boards**: one SQLite (WAL) per board, created/switched from the UI
- **Model tools**: `kanban_board` / `kanban_task_create` / `kanban_task_get` / `kanban_task_update` / `kanban_task_comment` / `kanban_task_link` / `kanban_task_unlink` / `kanban_task_delete` / `kanban_dispatch`
- **DSH-native dispatcher**: claims ready cards and runs `dsh --profile headless` workers; claim locks, heartbeats, crash reclaim, consecutive-failure circuit breaker, max concurrency
- **Live updates**: `/events` WebSocket stream

## Install

```sh
dsh plugin --profile <name> add @funcwei/dsh-kanban
# or from GitHub:
# dsh plugin --profile <name> add github:FuncWei/dsh-kanban
```

The sidecar auto-boots on first use (`uv` preferred; falls back to
`python3 -m venv`). Restart `dsh web`, then open:

- Board UI: `http://127.0.0.1:3080/kanban` (or the sidebar “任务看板” button)
- Data dir: `<DSH_HOME>/storages/kanban/` (default `~/.dsh/storages/kanban/`)

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `DSH_KANBAN_WORKER_CMD` | `dsh --profile headless` | Worker launch command |
| `DSH_KANBAN_MAX_WORKERS` | `4` | Global concurrent-worker cap |
| `DSH_KANBAN_PYTHON` | auto (uv, then python3) | Sidecar Python interpreter |
| `DSH_KANBAN_ROOT` | `<DSH_HOME>/storages/kanban` | Board data directory |

## Architecture

```
DSH web server
 ├─ /kanban                  → board UI (Hermes frontend + SDK shim)
 ├─ /api/plugins/kanban/*    → REST proxy (Hermes plugin_api)
 ├─ /api/plugins/kanban/events → WebSocket proxy (live events)
 └─ 9 model tools
        ↓ token + 127.0.0.1
Sidecar (FastAPI, run by uv)
 ├─ hermes_cli/kanban_db.py          (MIT, verbatim)
 ├─ hermes_cli/kanban_diagnostics.py (MIT, verbatim)
 ├─ plugin_api.py                    (MIT, verbatim)
 ├─ dsh_dispatcher.py                (this plugin: DSH worker dispatch glue)
 └─ SQLite: <DSH_HOME>/storages/kanban/
```

## License

MIT. The sidecar reuses the kanban implementation from Hermes Agent by Nous
Research (MIT) — see `NOTICE.md`.
