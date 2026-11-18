// Tests for the run records brigade-eval keeps beside its results file: each run's reply,
// the files it wrote, and a trace.json naming the tools it called and the files it read and
// wrote. Every test runs the real script in mock mode against a throwaway root, with no API
// key, so nothing reaches the network. Run with `node --test test/scripts/*.test.mjs`.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EVAL = path.join(ROOT, 'scripts', 'brigade-eval')

function writeFile(root, rel, body) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
}

const roots = []
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

// A root with one skill surface and the given cases, plus an empty mock dir.
function fixture(cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-eval-records-'))
  roots.push(root)
  writeFile(root, 'skills/x/SKILL.md', 'A sample skill surface.\n')
  writeFile(root, 'skills/x/evals.json', JSON.stringify(cases))
  fs.mkdirSync(path.join(root, 'mock'))
  return root
}

function run(root, args = [], extraEnv = {}) {
  const env = { ...process.env, BRIGADE_EVAL_ROOT: root, BRIGADE_EVAL_MOCK: path.join(root, 'mock'), ...extraEnv }
  delete env.ANTHROPIC_API_KEY
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k]
  return spawnSync('node', [EVAL, ...args], { encoding: 'utf8', env })
}

const writerCase = {
  name: 'writes-a-plan',
  surface: 'skills/x/SKILL.md',
  prompt: 'plan it',
  assertions: [{ type: 'contains', value: 'plan' }],
}

test('a run keeps its reply, the files it wrote and a trace.json beside the results file', () => {
  const root = fixture([writerCase])
  writeFile(root, 'mock/writes-a-plan.txt', 'Here is the plan.\n')
  writeFile(root, 'mock/writes-a-plan.files/.brigade/config.md', 'source: local\n')
  writeFile(root, 'mock/writes-a-plan.files/notes.txt', 'scratch\n')
  writeFile(
    root,
    'mock/writes-a-plan.tools.json',
    JSON.stringify([
      { tool: 'Read', input: { file_path: 'package.json' } },
      { tool: 'Read', input: { file_path: 'src/login.js' } },
      { tool: 'Grep', input: { pattern: 'test' } },
      { tool: 'Write', input: { file_path: '.brigade/config.md', content: 'source: local\n' } },
      { tool: 'Edit', input: { file_path: 'AGENTS.md', old_string: 'a', new_string: 'b' } },
    ])
  )

  const r = run(root, ['--json'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  const out = JSON.parse(r.stdout)
  const record = out.cases[0].record
  assert.match(record, /^\.brigade\/evals\/eval-[0-9TZ]+\/writes-a-plan\/1$/)

  // The record folder sits beside the results file of the same name.
  const stamp = record.split('/')[2]
  assert.ok(fs.existsSync(path.join(root, '.brigade', 'evals', `${stamp}.json`)), 'results file beside the record')
  const latest = JSON.parse(fs.readFileSync(path.join(root, '.brigade', 'evals', 'latest.json'), 'utf8'))
  assert.equal(latest.cases[0].record, record)

  const dir = path.join(root, record)
  assert.equal(fs.readFileSync(path.join(dir, 'response.txt'), 'utf8'), 'Here is the plan.\n')
  assert.equal(fs.readFileSync(path.join(dir, 'files', '.brigade', 'config.md'), 'utf8'), 'source: local\n')
  assert.equal(fs.readFileSync(path.join(dir, 'files', 'notes.txt'), 'utf8'), 'scratch\n')

  const trace = JSON.parse(fs.readFileSync(path.join(dir, 'trace.json'), 'utf8'))
  assert.deepEqual(trace, {
    case: 'writes-a-plan',
    run: 1,
    backend: 'mock',
    status: 'pass',
    tools: { Read: 2, Grep: 1, Write: 1, Edit: 1 },
    files_read: ['package.json', 'src/login.js'],
    files_written: ['.brigade/config.md', 'AGENTS.md', 'notes.txt'],
  })
})

test('a run with no tool calls or files still gets an empty files dir and an empty trace', () => {
  const root = fixture([writerCase])
  writeFile(root, 'mock/writes-a-plan.txt', 'Just a plan.\n')

  const r = run(root, ['--json'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  const dir = path.join(root, JSON.parse(r.stdout).cases[0].record)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), [])
  const trace = JSON.parse(fs.readFileSync(path.join(dir, 'trace.json'), 'utf8'))
  assert.deepEqual(trace.tools, {})
  assert.deepEqual(trace.files_read, [])
  assert.deepEqual(trace.files_written, [])
})

test('a run that errors before replying still gets a trace naming the error', () => {
  const root = fixture([writerCase]) // no mock reply on purpose
  const r = run(root, ['--json'])
  assert.equal(r.status, 1, r.stderr + r.stdout)
  const result = JSON.parse(r.stdout).cases[0]
  assert.equal(result.status, 'error')
  const dir = path.join(root, result.record)
  assert.ok(!fs.existsSync(path.join(dir, 'response.txt')))
  const trace = JSON.parse(fs.readFileSync(path.join(dir, 'trace.json'), 'utf8'))
  assert.equal(trace.status, 'error')
  assert.match(trace.error, /missing mock response file/)
})

test('a malformed tools file is an error, never read as "no tools"', () => {
  const root = fixture([writerCase])
  writeFile(root, 'mock/writes-a-plan.txt', 'Here is the plan.\n')
  writeFile(root, 'mock/writes-a-plan.tools.json', '{"tool": "Read"}')
  const r = run(root, ['--json'])
  assert.equal(r.status, 1, r.stderr + r.stdout)
  const result = JSON.parse(r.stdout).cases[0]
  assert.equal(result.status, 'error')
  assert.match(result.detail, /invalid mock tools file/)
})

test('a case name with a slash stays inside its own record folder', () => {
  const root = fixture([{ ...writerCase, name: '../escape/me' }])
  writeFile(root, 'mock/../escape/me.txt', 'plan\n')
  const r = run(root, ['--json'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  const record = JSON.parse(r.stdout).cases[0].record
  assert.match(record, /^\.brigade\/evals\/eval-[0-9TZ]+\/[^/]+\/1$/)
  const stampDir = path.join(root, '.brigade', 'evals', record.split('/')[2])
  assert.equal(path.dirname(path.dirname(path.resolve(root, record))), stampDir)
})

test('without a key, a mock or a claude CLI the run still skips cleanly and records nothing', () => {
  const root = fixture([writerCase])
  const r = run(root, [], {
    BRIGADE_EVAL_MOCK: undefined,
    BRIGADE_EVAL_CLAUDE: path.join(root, 'no-such-claude'),
  })
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /skipped/)
  assert.ok(!fs.existsSync(path.join(root, '.brigade')))
})
