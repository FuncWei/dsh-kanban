/**
 * dsh-kanban dispatcher test (stub workers).
 *
 * Verifies the DSH-native dispatch lifecycle against the reused Hermes
 * engine, using cheap stub workers instead of real `dsh` processes:
 *
 *   success path: claim -> spawn -> heartbeat -> complete (run + result)
 *   failure path: two consecutive failures trip the circuit breaker and the
 *                 card moves to blocked with a repeated_failures diagnostic.
 *
 * Requires `uv` on PATH (or DSH_KANBAN_PYTHON). Run:
 *   node --test tests/dispatch.test.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR_DIR = resolve(HERE, '..', 'sidecar')
const HAS_UV = process.env.DSH_KANBAN_PYTHON || !spawnSync('uv', ['--version'], { stdio: 'ignore' }).error

function stubScript(name, exitCode) {
  const path = join(tmpdir(), `dsh-kanban-stub-${name}.sh`)
  writeFileSync(path, exitCode === 0
    ? '#!/bin/sh\nsleep 1\necho "DONE: stub completed"\nexit 0\n'
    : '#!/bin/sh\nsleep 1\necho "BLOCKED: stub failed"\nexit 1\n')
  chmodSync(path, 0o755)
  return path
}

async function bootSidecar(root, port, workerCmd) {
  const token = `tok-${port}`
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
      DSH_KANBAN_WORKER_CMD: workerCmd,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const api = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
    return data
  }
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/kanban`)).ok) return { child, api }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill('SIGTERM')
  throw new Error('sidecar did not become healthy')
}

test('dispatch: success path records a completed run', { skip: !HAS_UV && 'uv not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-kanban-disp-ok-'))
  const { child, api } = await bootSidecar(root, 18771, `/bin/sh ${stubScript('ok', 0)}`)
  try {
    const created = await api('POST', '/api/plugins/kanban/tasks', { title: 'ok path', assignee: 'agent-a' })
    const tick = await api('POST', '/api/plugins/kanban/dsh/tick', { max: 4 })
    assert.equal(tick.spawned.length, 1)
    // Wait for the monitor to finalize the exited worker.
    let status = null
    for (let i = 0; i < 30 && status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const d = await api('GET', `/api/plugins/kanban/tasks/${created.task.id}`)
      status = d.task.status
    }
    const d = await api('GET', `/api/plugins/kanban/tasks/${created.task.id}`)
    assert.equal(d.task.status, 'done')
    assert.match(d.task.result, /DONE: stub completed/)
    assert.equal(d.runs.length, 1)
    assert.equal(d.runs[0].outcome, 'completed')
  } finally {
    child.kill('SIGTERM')
    setTimeout(() => rmSync(root, { recursive: true, force: true }), 500)
  }
})

test('dispatch: two failures trip the circuit breaker into blocked', { skip: !HAS_UV && 'uv not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-kanban-disp-fail-'))
  const { child, api } = await bootSidecar(root, 18772, `/bin/sh ${stubScript('fail', 1)}`)
  try {
    const created = await api('POST', '/api/plugins/kanban/tasks', { title: 'fail path', assignee: 'agent-a' })
    for (let round = 0; round < 2; round++) {
      const tick = await api('POST', '/api/plugins/kanban/dsh/tick', { max: 4 })
      assert.equal(tick.spawned.length, 1, `round ${round} spawned`)
      await new Promise((r) => setTimeout(r, 5000))
    }
    const d = await api('GET', `/api/plugins/kanban/tasks/${created.task.id}`)
    assert.equal(d.task.status, 'blocked')
    assert.equal(d.task.consecutive_failures, 2)
    assert.equal(d.runs.length, 2)
    assert.deepEqual(d.runs.map((r) => r.outcome), ['failed', 'gave_up'])
    assert.ok(d.task.diagnostics.some((x) => x.kind === 'repeated_failures'))
  } finally {
    child.kill('SIGTERM')
    setTimeout(() => rmSync(root, { recursive: true, force: true }), 500)
  }
})
