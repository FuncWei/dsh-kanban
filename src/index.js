/**
 * dsh-kanban — server half.
 *
 * Runs the Hermes (MIT) kanban engine + board UI as a local sidecar and
 * exposes it through the DSH web server:
 *
 *   * /kanban                        — the full board UI (9 columns, drawer,
 *                                      comments, attachments, links, runs)
 *   * /api/plugins/kanban/*          — the Hermes REST API (proxied)
 *   * /api/plugins/kanban/events     — WebSocket live-event stream (proxied)
 *
 * and registers model tools so an agent can manage the board from a chat:
 *   kanban_board / kanban_task_create / kanban_task_get / kanban_task_update /
 *   kanban_task_comment / kanban_task_link / kanban_task_unlink /
 *   kanban_task_delete / kanban_dispatch
 *
 * The sidecar owns the SQLite board (<DSH_HOME>/storages/kanban/) and the
 * DSH-native dispatcher: kanban_dispatch claims ready cards and spawns
 * `dsh --profile headless "<prompt>"` workers (configurable via
 * DSH_KANBAN_WORKER_CMD); the sidecar heartbeats and finalizes runs.
 *
 * See NOTICE.md for Hermes attribution (MIT, Nous Research).
 * @module dsh-kanban
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer as createNetServer, connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable Cordis plugin name. */
export const name = 'dsh-kanban'

/** Services required before this plugin activates. */
export const inject = ['webServer', 'tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR_DIR = resolve(HERE, '..', 'sidecar')
const REQUIREMENTS_PATH = join(SIDECAR_DIR, 'requirements.txt')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const BOARD_ROOT = process.env.DSH_KANBAN_ROOT || join(DSH_HOME, 'storages', 'kanban')
const API_PREFIX = '/api/plugins/kanban'

const OK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    summary: { type: 'string', required: true },
  },
}

/** Render a tool result as the model-facing summary text. */
function renderSummary(_args, value) {
  return [{ type: 'text', text: String(value && value.summary ? value.summary : 'done') }]
}

function pick(text, fallback) {
  const t = text === undefined || text === null ? '' : String(text).trim()
  return t || fallback
}

/**
 * Manages the sidecar process: python discovery, venv/uv bootstrap, health
 * poll, and teardown. One manager per plugin instance.
 */
class SidecarManager {
  constructor() {
    this.port = 0
    this.token = randomBytes(24).toString('hex')
    this.child = null
    this.stderrTail = ''
    this.ready = null
    this.stopping = false
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`
  }

  /** Resolve the python invocation that runs sidecar/main.py. */
  resolveCommand() {
    if (process.env.DSH_KANBAN_PYTHON) {
      return [...process.env.DSH_KANBAN_PYTHON.split(/\s+/).filter(Boolean), 'main.py']
    }
    const uv = this.which('uv')
    if (uv) {
      // `uv run` resolves pinned deps (requirements.txt) into an ephemeral env.
      return [uv, 'run', '--with-requirements', REQUIREMENTS_PATH, '--', 'python', 'main.py']
    }
    const py3 = this.which('python3') || this.which('python')
    if (!py3) {
      throw new Error(
        'dsh-kanban: no Python runtime found. Install uv (https://docs.astral.sh/uv) '
        + 'or set DSH_KANBAN_PYTHON to a python binary.',
      )
    }
    // Fallback: one persistent venv inside the board root.
    const venvDir = join(BOARD_ROOT, 'venv')
    const venvPy = join(venvDir, 'bin', 'python')
    if (!existsSync(venvPy)) {
      mkdirSync(venvDir, { recursive: true })
      const created = spawnSync(py3, ['-m', 'venv', venvDir], { stdio: 'inherit' })
      if (created.status !== 0) throw new Error('dsh-kanban: venv creation failed')
      const pip = spawnSync(venvPy, ['-m', 'pip', 'install', '-q', '-r', REQUIREMENTS_PATH], { stdio: 'inherit' })
      if (pip.status !== 0) throw new Error('dsh-kanban: pip install failed')
    }
    return [venvPy, 'main.py']
  }

  which(bin) {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' })
    return probe.error ? null : bin
  }

  async start() {
    if (this.child) return
    const cmd = this.resolveCommand()
    this.port = await new Promise((ok, fail) => {
      const srv = createNetServer()
      srv.on('error', fail)
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port
        srv.close(() => ok(p))
      })
    })
    const env = {
      ...process.env,
      DSH_HOME,
      DSH_KANBAN_ROOT: BOARD_ROOT,
      DSH_KANBAN_TOKEN: this.token,
      DSH_KANBAN_PORT: String(this.port),
    }
    this.stderrTail = ''
    this.child = spawn(cmd[0], cmd.slice(1), {
      cwd: SIDECAR_DIR,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    this.child.stderr.on('data', (d) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-4000)
    })
    this.child.on('exit', () => {
      this.child = null
      // Allow a later request to respawn the sidecar (crash recovery).
      this.ready = null
    })
    await this.waitHealthy()
  }

  async waitHealthy(timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const res = await fetch(`${this.baseUrl}/kanban`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) return
      } catch {
        /* not up yet */
      }
      if (this.stopping || !this.child) throw new Error('dsh-kanban: sidecar exited before healthy')
      if (Date.now() > deadline) {
        throw new Error(
          `dsh-kanban: sidecar failed to become healthy within ${timeoutMs / 1000}s. stderr tail: ${this.stderrTail.slice(-800)}`,
        )
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  /** Lazily start the sidecar; concurrent callers share one promise. */
  ensureReady() {
    if (!this.ready) this.ready = this.start().catch((err) => { this.ready = null; throw err })
    return this.ready
  }

  stop() {
    this.stopping = true
    if (this.child) {
      const child = this.child
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 3000).unref()
      this.child = null
    }
    this.ready = null
  }
}

const manager = new SidecarManager()

/** Send one JSON request to the sidecar; returns the parsed body. */
async function sidecarJson(method, path, body) {
  await manager.ensureReady()
  const res = await fetch(`${manager.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${manager.token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = data && (data.detail || data.error) ? data.detail : `HTTP ${res.status}`
    const message = typeof detail === 'string' ? detail : JSON.stringify(detail)
    throw new Error(`dsh-kanban sidecar: ${message}`)
  }
  return data
}

/** Forward an inbound HTTP request to the sidecar, verbatim (plus auth). */
async function proxyHttp(req, res) {
  try {
    await manager.ensureReady()
  } catch (err) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'dsh-kanban sidecar unavailable', detail: String(err && err.message) }))
    return
  }
  const url = new URL(req.url, 'http://placeholder')
  const headers = { ...req.headers }
  delete headers['connection']
  headers['host'] = `127.0.0.1:${manager.port}`
  headers['authorization'] = `Bearer ${manager.token}`
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: manager.port,
    method: req.method,
    path: url.pathname + url.search,
    headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)
    upRes.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end()
  })
  req.pipe(upstream)
}

/** Forward the /events WebSocket upgrade to the sidecar. */
async function proxyUpgrade(req, socket, head) {
  try {
    await manager.ensureReady()
  } catch {
    socket.destroy()
    return
  }
  const url = new URL(req.url, 'http://placeholder')
  url.searchParams.set('token', manager.token)
  const copy = (name) => (req.headers[name] ? `${name}: ${req.headers[name]}` : null)
  const raw = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: 127.0.0.1:${manager.port}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    copy('sec-websocket-key'),
    copy('sec-websocket-protocol'),
    copy('sec-websocket-extensions'),
    copy('origin'),
    '',
    '',
  ].filter((line) => line !== null).join('\r\n')
  const upstream = netConnect(manager.port, '127.0.0.1', () => {
    upstream.write(raw)
    if (head && head.length) upstream.write(head)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy())
  upstream.on('close', () => socket.destroy())
  socket.pipe(upstream)
  upstream.pipe(socket)
}

/* -------------------------------------------------------------------------- */
/* Model tools                                                                 */
/* -------------------------------------------------------------------------- */

async function toolBoard({ board }) {
  const data = await sidecarJson('GET', `/api/plugins/kanban/board${board ? `?board=${encodeURIComponent(board)}` : ''}`)
  const lines = data.columns.map((col) => {
    const cards = col.tasks.map((t) => `${t.id} [${t.priority >= 0 ? 'p' + t.priority : 'p0'}] ${pick(t.title, 'untitled')}${t.assignee ? ` @${t.assignee}` : ''}`)
    return `${col.name} (${cards.length}): ${cards.length ? '\n    ' + cards.join('\n    ') : '—'}`
  })
  return { ok: true, summary: `Board columns:\n${lines.join('\n')}` }
}

async function toolCreate(args) {
  const payload = {
    title: args.title,
    ...args.body !== undefined ? { body: args.body } : {},
    ...args.assignee !== undefined ? { assignee: args.assignee } : {},
    ...args.priority !== undefined ? { priority: args.priority } : {},
    ...args.parents !== undefined ? { parents: args.parents } : {},
    ...args.triage !== undefined ? { triage: args.triage } : {},
    ...args.workspace_kind !== undefined ? { workspace_kind: args.workspace_kind } : {},
    ...args.workspace_path !== undefined ? { workspace_path: args.workspace_path } : {},
  }
  const qs = args.board ? `?board=${encodeURIComponent(args.board)}` : ''
  const data = await sidecarJson('POST', `/api/plugins/kanban/tasks${qs}`, payload)
  return { ok: true, summary: `Created task ${data.task.id} ("${pick(data.task.title, 'untitled')}", status=${data.task.status})` }
}

async function toolGet({ id, board }) {
  const qs = board ? `?board=${encodeURIComponent(board)}` : ''
  const data = await sidecarJson('GET', `/api/plugins/kanban/tasks/${encodeURIComponent(id)}${qs}`)
  const t = data.task
  const parts = [
    `Task ${t.id}: "${t.title}" status=${t.status} priority=${t.priority ?? 0} assignee=${t.assignee ?? '—'}`,
    t.body ? `Body: ${t.body}` : null,
    t.result ? `Result: ${t.result}` : null,
    t.latest_summary ? `Latest summary: ${t.latest_summary}` : null,
    data.comments.length ? `Comments (${data.comments.length}): ${data.comments.slice(-5).map((c) => `${c.author}: ${c.body}`).join(' | ')}` : null,
    data.runs.length ? `Runs (${data.runs.length}): ${data.runs.slice(-5).map((r) => `${r.status}/${r.outcome ?? '—'}: ${pick(r.summary, '')}`).join(' | ')}` : null,
    data.links.parents.length ? `Parents: ${data.links.parents.join(', ')}` : null,
    data.links.children.length ? `Children: ${data.links.children.join(', ')}` : null,
  ].filter(Boolean)
  return { ok: true, summary: parts.join('\n') }
}

async function toolUpdate(args) {
  const payload = {
    ids: args.ids,
    ...args.status !== undefined ? { status: args.status } : {},
    ...args.assignee !== undefined ? { assignee: args.assignee } : {},
    ...args.priority !== undefined ? { priority: args.priority } : {},
    ...args.result !== undefined ? { result: args.result } : {},
    ...args.summary !== undefined ? { summary: args.summary } : {},
  }
  const qs = args.board ? `?board=${encodeURIComponent(args.board)}` : ''
  const data = await sidecarJson('POST', `/api/plugins/kanban/tasks/bulk${qs}`, payload)
  const results = Array.isArray(data.results) ? data.results : data
  return { ok: true, summary: `Updated ${args.ids.length} task(s): ${JSON.stringify(results).slice(0, 500)}` }
}

async function toolComment({ id, body }) {
  await sidecarJson('POST', `/api/plugins/kanban/tasks/${encodeURIComponent(id)}/comments`, { body, author: 'dsh-agent' })
  return { ok: true, summary: `Commented on ${id}` }
}

async function toolLink({ parent_id, child_id }) {
  await sidecarJson('POST', '/api/plugins/kanban/links', { parent_id, child_id })
  return { ok: true, summary: `Linked ${parent_id} -> ${child_id}` }
}

async function toolUnlink({ parent_id, child_id }) {
  await sidecarJson('DELETE', `/api/plugins/kanban/links?parent_id=${encodeURIComponent(parent_id)}&child_id=${encodeURIComponent(child_id)}`)
  return { ok: true, summary: `Unlinked ${parent_id} -/-> ${child_id}` }
}

async function toolDelete({ id, board }) {
  const qs = board ? `?board=${encodeURIComponent(board)}` : ''
  await sidecarJson('DELETE', `/api/plugins/kanban/tasks/${encodeURIComponent(id)}${qs}`)
  return { ok: true, summary: `Deleted ${id}` }
}

async function toolDispatch({ board, max, dry_run }) {
  const data = await sidecarJson('POST', '/api/plugins/kanban/dsh/tick', {
    board: board ?? null,
    max: max ?? 0,
    dry_run: dry_run ?? false,
  })
  return {
    ok: true,
    summary: `Dispatch tick: spawned=${JSON.stringify(data.spawned)} reclaimed=${data.reclaimed} crashed=${data.crashed} stale=${data.stale} promoted=${data.promoted} auto_blocked=${JSON.stringify(data.auto_blocked)}${data.skipped_locked ? ' (lock held by another dispatcher)' : ''}`,
  }
}

function tool(name_, description, parameters, execute) {
  return defineTool({
    name: name_,
    description,
    parameters,
    output: {
      schema: OK_SCHEMA,
      render: renderSummary,
    },
    execute,
  })
}

const TOOLS = [
  tool('kanban_board', 'Show the kanban board: every column (triage/todo/scheduled/ready/running/blocked/review/done) with its cards (id, title, priority, assignee). Optional board slug selects a specific board.', {
    board: { type: 'string', description: 'Board slug (default board when omitted).' },
  }, toolBoard),
  tool('kanban_task_create', 'Create a kanban card. New cards land in the ready column (or triage when triage=true).', {
    title: { type: 'string', required: true, description: 'Card title.' },
    body: { type: 'string', description: 'Detailed task description.' },
    assignee: { type: 'string', description: 'Assignee (profile/agent name; lowercased).' },
    priority: { type: 'integer', description: 'Numeric priority (0 = default).' },
    parents: { type: 'array', items: { type: 'string' }, description: 'Parent card ids this card depends on.' },
    triage: { type: 'boolean', description: 'Put the card in the triage column instead of ready.' },
    board: { type: 'string', description: 'Board slug.' },
    workspace_kind: { type: 'string', description: 'Workspace kind: scratch | dir | worktree.' },
    workspace_path: { type: 'string', description: 'Working directory for the dispatched worker.' },
  }, toolCreate),
  tool('kanban_task_get', 'Get one card in full: body, result, latest summary, comments, runs, parent/child links.', {
    id: { type: 'string', required: true, description: 'Card id (e.g. t_ab12cd34).' },
    board: { type: 'string', description: 'Board slug.' },
  }, toolGet),
  tool('kanban_task_update', 'Update one or more cards: move status (triage/todo/scheduled/ready/running/blocked/review/done/archived), set assignee, priority, result or summary.', {
    ids: { type: 'array', items: { type: 'string' }, required: true, description: 'Card ids to update.' },
    status: { type: 'string', description: 'New status column.' },
    assignee: { type: 'string', description: 'New assignee (empty string unassigns).' },
    priority: { type: 'integer', description: 'New numeric priority.' },
    result: { type: 'string', description: 'Completion result text.' },
    summary: { type: 'string', description: 'Run summary for handoff.' },
    board: { type: 'string', description: 'Board slug.' },
  }, toolUpdate),
  tool('kanban_task_comment', 'Add a comment to a card (visible in the card drawer).', {
    id: { type: 'string', required: true, description: 'Card id.' },
    body: { type: 'string', required: true, description: 'Comment text.' },
  }, toolComment),
  tool('kanban_task_link', 'Link two cards: child becomes blocked until its parent(s) reach done.', {
    parent_id: { type: 'string', required: true, description: 'Parent card id.' },
    child_id: { type: 'string', required: true, description: 'Child card id.' },
  }, toolLink),
  tool('kanban_task_unlink', 'Remove a parent->child link.', {
    parent_id: { type: 'string', required: true },
    child_id: { type: 'string', required: true },
  }, toolUnlink),
  tool('kanban_task_delete', 'Delete a card.', {
    id: { type: 'string', required: true },
    board: { type: 'string', description: 'Board slug.' },
  }, toolDelete),
  tool('kanban_dispatch', 'Run one dispatcher tick: claim ready cards and spawn DSH headless workers to execute them. Workers report DONE/BLOCKED; the board records runs, heartbeats and failure counts.', {
    board: { type: 'string', description: 'Board slug.' },
    max: { type: 'integer', description: 'Max concurrent workers for this tick.' },
    dry_run: { type: 'boolean', description: 'Report what would be spawned without claiming.' },
  }, toolDispatch),
]

/**
 * Plugin body: register proxy routes, the WS upgrade, model tools, and
 * sidecar lifecycle.
 * @param ctx - plugin context carrying webServer and tools.
 */
export function apply(ctx) {
  const disposers = []
  disposers.push(ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: proxyHttp,
  }), 'dsh-kanban: api proxy'))
  disposers.push(ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/kanban',
    handler: proxyHttp,
  }), 'dsh-kanban: board ui proxy'))
  disposers.push(ctx.effect(() => ctx.webServer.registerUpgrade({
    path: `${API_PREFIX}/events`,
    handler: proxyUpgrade,
  }), 'dsh-kanban: events websocket proxy'))
  for (const t of TOOLS) {
    disposers.push(ctx.effect(() => ctx.tools.register(t), `dsh-kanban: tool ${t.name}`))
  }
  disposers.push(ctx.effect(() => () => manager.stop(), 'dsh-kanban: sidecar lifecycle'))
  return () => disposers.forEach((d) => d())
}
