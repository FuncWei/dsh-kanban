# dsh-kanban · DSH 任务看板

DeepSeek Harness 原生多智能体任务看板插件。**完整复用 Hermes（Nous Research，MIT）的看板引擎与界面**，接入 DSH 的 web 服务器与模型工具体系，由 DSH headless worker 执行卡片任务。

> 对标 Hermes Kanban：9 列看板、多 board、评论/附件/链接/事件流、运行记录、诊断与恢复动作、认领锁 + 熔断重试、实时 WebSocket 更新——全部原生可用。

## 特性

- **9 列看板**：triage / todo / scheduled / ready / running / blocked / review / done / archived，支持拖拽、多选批量流转
- **完整卡片**：正文、负责人、优先级、依赖（父子卡）、租户、workspace、模型覆盖、目标模式
- **卡片抽屉**：评论、附件、链接、事件时间线、运行记录、诊断（含一键恢复动作）、worker 日志
- **多 board**：每个 board 独立 SQLite（WAL），可在界面创建/切换
- **模型工具**（对话里直接管卡）：`kanban_board` / `kanban_task_create` / `kanban_task_get` / `kanban_task_update` / `kanban_task_comment` / `kanban_task_link` / `kanban_task_unlink` / `kanban_task_delete` / `kanban_dispatch`
- **DSH 原生派发器**：`kanban_dispatch` 认领 ready 卡片并启动 `dsh --profile headless` worker 执行；引擎自带认领锁、心跳、崩溃回收、连续失败熔断自动转 blocked、最大并发控制
- **实时更新**：`/events` WebSocket 推送看板事件流

## 安装

```sh
dsh plugin --profile <name> add @funcwei/dsh-kanban
# 或 GitHub 源：
# dsh plugin --profile <name> add github:FuncWei/dsh-kanban
```

首次使用时插件会自动启动 sidecar（自动用 `uv` 拉取 Python 依赖；无 uv 时回退到 `python3 -m venv`）。然后**重启 `dsh web`**，浏览器打开：

- 看板界面：`http://127.0.0.1:3080/kanban`（或点侧栏「任务看板」按钮）
- 数据目录：`<DSH_HOME>/storages/kanban/`（默认 `~/.dsh/storages/kanban/`）

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_KANBAN_WORKER_CMD` | `dsh --profile headless` | 派发 worker 的启动命令 |
| `DSH_KANBAN_MAX_WORKERS` | `4` | 全局并发 worker 上限 |
| `DSH_KANBAN_PYTHON` | 自动探测 uv/python3 | sidecar 的 Python 解释器 |
| `DSH_KANBAN_ROOT` | `<DSH_HOME>/storages/kanban` | 看板数据目录 |

## 使用

1. 对话里说「建一张卡：整理本周公众号选题」→ agent 调 `kanban_task_create`
2. 卡片进入 ready 列后，调 `kanban_dispatch`（或让 agent 调）→ DSH headless worker 认领执行，看板上实时看到 running → done 与运行记录
3. worker 最终消息写 DONE/BLOCKED；非零退出计入失败次数，连续失败自动转 blocked 并给出诊断恢复动作

## 架构

```
DSH web 服务器
 ├─ /kanban                  → 看板界面（Hermes 前端原样 + SDK shim）
 ├─ /api/plugins/kanban/*    → REST 代理（Hermes plugin_api 原样）
 ├─ /api/plugins/kanban/events → WebSocket 代理（实时事件）
 └─ 9 个模型工具
        ↓ token + 127.0.0.1
Sidecar（uv 启动的 FastAPI）
 ├─ hermes_cli/kanban_db.py          (MIT, 原样)
 ├─ hermes_cli/kanban_diagnostics.py (MIT, 原样)
 ├─ plugin_api.py                    (MIT, 原样)
 ├─ dsh_dispatcher.py                (本插件：DSH worker 派发 glue)
 └─ SQLite: <DSH_HOME>/storages/kanban/
```

## 许可

MIT。Sidecar 复用 Nous Research Hermes Agent（MIT）的看板实现，详见 `NOTICE.md`。
