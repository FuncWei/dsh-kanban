/**
 * dsh-kanban sidecar integration test.
 *
 * Boots the sidecar against a temp board root and exercises the reused
 * Hermes kanban engine + our DSH dispatcher glue over HTTP:
 *   board init → create → link → comment → bulk transition → dispatch tick
 *   (dry-run) → delete → boards list.
 *
 * Requires `uv` on PATH (or set DSH_KANBAN_PYTHON). Skipped otherwise.
 * Run: node --test tests/sidecar.test.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR_DIR = resolve(HERE, '..', 'sidecar')
const HAS_UV = process.env.DSH_KANBAN_PYTHON || !spawnSync('uv', ['--version'], { stdio: 'ignore' }).error

test('sidecar: full card lifecycle over HTTP', { skip: !HAS_UV && 'uv not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-kanban-test-'))
  const token = 'test-token-123'
  const port = 18766
  const pythonCmd = process.env.DSH_KANBAN_PYTHON
    ? [...process.env.DSH_KANBAN_PYTHON.split(/\s+/).filter(Boolean), 'main.py']
    : ['uv', 'run', '--with-requirements', join(SIDECAR_DIR, 'requirements.txt'), '--', 'python', 'main.py']
  const child = spawn(pythonCmd[0], pythonCmd.slice(1), {
    cwd: SIDECAR_DIR,
    env: {
      ...process.env,
      DSH_KANBAN_ROOT: root,
      DSH_KANBAN_TOKEN: token,
      DSH_KANBAN_PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000) })

  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try { data = await res.json() } catch { /* empty */ }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
    return data
  }

  try {
    // Wait for health.
    let healthy = false
    for (let i = 0; i < 240 && !healthy; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/kanban`)
        healthy = res.ok
      } catch { /* retry */ }
      if (!healthy) await new Promise((r) => setTimeout(r, 500))
    }
    assert.equal(healthy, true, `sidecar did not become healthy. stderr: ${stderr}`)

    // 1. Board exists with 8 visible columns.
    const board = await api('GET', '/api/plugins/kanban/board')
    const names = board.columns.map((c) => c.name)
    assert.deepEqual(names, ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'])

    // 2. Create parent + child.
    const parent = await api('POST', '/api/plugins/kanban/tasks', { title: 'Parent 任务', assignee: 'Agent A' })
    const child = await api('POST', '/api/plugins/kanban/tasks', { title: 'Child 任务', parents: [parent.task.id] })
    assert.equal(parent.task.assignee, 'agent a', 'assignee normalizes to lowercase')
    assert.ok(child.task.id, 'child created')

    // 3. Link + comment.
    await api('POST', '/api/plugins/kanban/links', { parent_id: parent.task.id, child_id: child.task.id })
    await api('POST', `/api/plugins/kanban/tasks/${parent.task.id}/comments`, { body: 'note', author: 'tester' })
    const detail = await api('GET', `/api/plugins/kanban/tasks/${parent.task.id}`)
    assert.equal(detail.comments.length, 1)
    assert.deepEqual(detail.links.children, [child.task.id])

    // 4. Bulk transition parent -> doing -> done with result.
    await api('POST', '/api/plugins/kanban/tasks/bulk', { ids: [parent.task.id], status: 'running' })
    await api('POST', '/api/plugins/kanban/tasks/bulk', { ids: [parent.task.id], status: 'done', result: 'finished', summary: 'all good' })
    const doneDetail = await api('GET', `/api/plugins/kanban/tasks/${parent.task.id}`)
    assert.equal(doneDetail.task.status, 'done')
    assert.equal(doneDetail.task.result, 'finished')

    // 5. Dispatch tick (dry-run): child has a ready-eligible state but no
    //    assignee — the engine must report it skipped, not crash.
    const tick = await api('POST', '/api/plugins/kanban/dsh/tick', { dry_run: true, max: 4 })
    assert.equal(typeof tick.spawned, 'object')
    assert.equal(tick.skipped_locked, false)

    // 6. Delete child; boards list intact.
    await api('DELETE', `/api/plugins/kanban/tasks/${child.task.id}`)
    const boards = await api('GET', '/api/plugins/kanban/boards')
    assert.equal(boards.current, 'default')
    assert.equal(boards.boards.length, 1)
  } finally {
    child.kill('SIGTERM')
    setTimeout(() => rmSync(root, { recursive: true, force: true }), 500)
  }
})
