# dsh-kanban architecture

```
                    DeepSeek Harness (web profile)
 ┌──────────────────────────────────────────────────────────────┐
 │  Browser (DSH Web GUI)                                        │
 │   ├─ sidebar footer action 「任务看板」 → /kanban (new tab)     │
 │   └─ agent tools: kanban_board / kanban_task_create / …       │
 └───────────────┬──────────────────────────────────────────────┘
                 │ same-origin HTTP + WebSocket upgrade
 ┌───────────────▼──────────────────────────────────────────────┐
 │  DSH web server (plugins/host/webserver)                      │
 │   ├─ prefix /kanban                     → proxyHttp           │
 │   ├─ prefix /api/plugins/kanban         → proxyHttp           │
 │   ├─ upgrade /api/plugins/kanban/events → proxyUpgrade (raw)  │
 │   └─ tools.register: 9 defineTool tools  → sidecarJson        │
 └───────────────┬──────────────────────────────────────────────┘
                 │ 127.0.0.1:<random> + Authorization: Bearer <token>
 ┌───────────────▼──────────────────────────────────────────────┐
 │  Sidecar (Python, uv-bootstrapped FastAPI)                    │
 │   ├─ main.py            boot, token gate, /kanban page        │
 │   ├─ plugin_api.py      Hermes REST API (45 routes, MIT)      │
 │   ├─ dsh_dispatcher.py  DSH worker dispatch glue (ours)       │
 │   ├─ hermes_cli/kanban_db.py        board engine (MIT, verbatim)
 │   ├─ hermes_cli/kanban_diagnostics.py (MIT, verbatim)         │
 │   ├─ compat shims      hermes_state / profiles / config /     │
 │   │                    agent.memory_manager / agent.redact    │
 │   └─ SQLite (WAL)      <DSH_HOME>/storages/kanban/            │
 └───────────────┬──────────────────────────────────────────────┘
                 │ spawn (cwd = card workspace_path)
 ┌───────────────▼──────────────────────────────────────────────┐
 │  DSH headless workers:  dsh --profile headless "<card prompt>"│
 │   exit 0 → complete_task(result=stdout tail)                  │
 │   exit N → _record_task_failure (circuit breaker → blocked)   │
 └──────────────────────────────────────────────────────────────┘
```

## Trust model

- The sidecar binds **127.0.0.1 only**; every `/api/*` request must carry the
  per-process bearer token (`DSH_KANBAN_TOKEN`), which the DSH plugin
  generates randomly and injects server-side. The board page receives the
  token inline (same trust level as the DSH GUI itself, which is loopback).
- The DSH web server proxies `/kanban` and `/api/plugins/kanban/*` to the
  sidecar, so the browser never talks to the sidecar port directly.

## Dispatch lifecycle

1. `kanban_dispatch` (tool) or `POST /dsh/tick` runs
   `kanban_db.dispatch_once(spawn_fn=…)` — the Hermes engine performs
   stale-claim reclaim, crash detection (worker PID liveness), ready
   promotion, and claim + spawn under its single-writer dispatch lock.
2. `spawn_fn` launches `dsh --profile headless "<title>\n<body>…"` with the
   card's workspace as cwd and returns the worker PID.
3. A monitor thread heartbeats running cards (`heartbeat_worker`, 15 s) and
   finalizes exits: rc=0 → `complete_task` (stdout tail becomes the result);
   rc≠0 → `_record_task_failure` → consecutive failures trip the breaker and
   the card moves to `blocked` with a diagnostic + recovery action.
4. Cards can also be claimed and finished by the agent itself through the
   model tools (`kanban_task_update` to `running`, then `done` with a
   result) — the board records every transition in `task_events`.

## Why a sidecar instead of a port

The Hermes kanban engine is ~12k lines of Python (SQLite schema, state
machine, dispatcher, diagnostics). It is MIT-licensed, self-contained
(stdlib sqlite3 + one toolset registry), and its REST API + board UI are
plugin-shaped already. Bundling the verbatim code in a sidecar reuses all of
it with zero logic porting; the DSH plugin is a thin integration layer
(~700 lines) owning process lifecycle, proxying, model tools and the
DSH-native worker backend. See NOTICE.md for attribution.
