// Tests for hooks/turn-budget.mjs, the PostToolUse turn-budget warning. Each test drives the
// real hook with real-shaped hook input against a throwaway project and a fake home.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (C5):
//   R1 silent unless agent_id is set and agent_type starts with "brigade:"
//   R2 silent when the agent file has no maxTurns
//   E1 soft warning exactly once, at ceil(maxTurns * softFraction)
//   E2 final warning exactly once, at maxTurns - finalReserve
//   E3 each warning appends one line to <cwd>/.brigade/state/turn-budget.jsonl
//   E4 budgets.enabled false is silent
//   I1 exit 0 with no output on any internal error, including garbage stdin
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = path.join(ROOT, 'hooks', 'turn-budget.mjs')

function setup({ config = null, brigadeDir = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-budget-'))
  const project = path.join(base, 'project')
  fs.mkdirSync(project)
  if (brigadeDir) fs.mkdirSync(path.join(project, '.brigade'))
  if (config) fs.writeFileSync(path.join(project, 'brigade.config.json'), JSON.stringify(config))
  const home = path.join(base, 'home')
  fs.mkdirSync(home)
  return { project, home, data: path.join(base, 'data'), base }
}

function fire(env, input, { raw = null, pluginRoot = ROOT } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw ?? JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: env.project, ...input }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: env.home, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: env.data },
  })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

const cook = (id = 'agent1') => ({ agent_id: id, agent_type: 'brigade:brigade-cook' }) // maxTurns 60
const context = (out) => JSON.parse(out).hookSpecificOutput.additionalContext
const stateLines = (env) => {
  const f = path.join(env.project, '.brigade', 'state', 'turn-budget.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
}

// Runs calls 1..n and returns the outputs of the calls that spoke, keyed by call number.
function run(env, input, n) {
  const spoke = {}
  for (let i = 1; i <= n; i++) {
    const r = fire(env, input)
    assert.equal(r.status, 0)
    if (r.out) spoke[i] = r.out
  }
  return spoke
}

test('R1 main-session input is silent', () => {
  const env = setup()
  const spoke = run(env, {}, 60)
  assert.deepEqual(spoke, {})
  assert.deepEqual(stateLines(env), [])
})

test('R1 a non-brigade agent is silent, and so is an agent_type without agent_id', () => {
  const env = setup()
  assert.deepEqual(run(env, { agent_id: 'x1', agent_type: 'other:brigade-cook' }, 60), {})
  assert.deepEqual(run(env, { agent_type: 'brigade:brigade-cook' }, 60), {})
  assert.deepEqual(run(env, { agent_id: 'x2' }, 60), {})
})

test('R2 a brigade agent with no agent file is silent', () => {
  const env = setup()
  assert.deepEqual(run(env, { agent_id: 'n1', agent_type: 'brigade:no-such-agent' }, 60), {})
})

test('R2 an agent file with no maxTurns is silent', () => {
  const env = setup()
  const root = path.join(env.base, 'plugin')
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true })
  fs.writeFileSync(path.join(root, 'agents', 'plain.md'), '---\nname: plain\n---\nbody\n')
  const spoke = {}
  for (let i = 1; i <= 30; i++) {
    const r = fire(env, { agent_id: 'p1', agent_type: 'brigade:plain' }, { pluginRoot: root })
    assert.equal(r.status, 0)
    if (r.out) spoke[i] = r.out
  }
  assert.deepEqual(spoke, {})
})

test('E1 soft warning fires exactly once, at call 45 of 60, with the specified text', () => {
  const env = setup()
  const spoke = run(env, cook(), 56)
  assert.deepEqual(Object.keys(spoke), ['45'])
  const text = context(spoke[45])
  assert.equal(JSON.parse(spoke[45]).hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.match(text, /^Turn budget: you have used 45 of 60 turns\. Wrap up now: stop new work, commit what passes, and write your artifact\./)
  assert.match(text, /status blocked, is the expected outcome; never claim done, skip the gate, or weaken a test to finish\.$/)
})

test('E2 final warning fires exactly once, at call 57 of 60', () => {
  const env = setup()
  const spoke = run(env, cook(), 60)
  assert.deepEqual(Object.keys(spoke), ['45', '57'])
  assert.equal(context(spoke[57]), 'Final turns: write your report or brief now and stop.')
})

test('E1 counters are per agent_id and the heavy agent uses its own maxTurns', () => {
  const env = setup()
  run(env, cook('a'), 44)
  const heavy = { agent_id: 'h', agent_type: 'brigade:brigade-cook-heavy' } // maxTurns 80, soft 60
  const spoke = run(env, heavy, 60)
  assert.deepEqual(Object.keys(spoke), ['60'])
  assert.match(context(spoke[60]), /used 60 of 80 turns/)
  assert.match(context(fire(env, cook('a')).out), /used 45 of 60 turns/)
})

test('E1 config softFraction and finalReserve move the warning points', () => {
  const env = setup({ config: { budgets: { softFraction: 0.5, finalReserve: 10 } } })
  const spoke = run(env, cook(), 60)
  assert.deepEqual(Object.keys(spoke), ['30', '50'])
})

test('E3 each warning appends one state line when .brigade exists', () => {
  const env = setup()
  run(env, cook(), 60)
  const lines = stateLines(env)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines.map((l) => [l.event, l.count]), [['soft', 45], ['final', 57]])
  for (const l of lines) {
    assert.equal(l.agent_id, 'agent1')
    assert.equal(l.agent_type, 'brigade:brigade-cook')
    assert.equal(l.maxTurns, 60)
    assert.ok(!Number.isNaN(Date.parse(l.at)))
  }
})

test('E3 no .brigade directory means no state file, and the warning still fires', () => {
  const env = setup({ brigadeDir: false })
  const spoke = run(env, cook(), 45)
  assert.deepEqual(Object.keys(spoke), ['45'])
  assert.equal(fs.existsSync(path.join(env.project, '.brigade')), false)
})

test('E4 budgets.enabled false is silent and writes no state', () => {
  const env = setup({ config: { budgets: { enabled: false } } })
  assert.deepEqual(run(env, cook(), 60), {})
  assert.deepEqual(stateLines(env), [])
})

test('I1 garbage stdin exits 0 with no output', () => {
  const env = setup()
  for (const raw of ['', 'not json', '{"agent_id":', '[]', 'null', '\u0000\u0001']) {
    const r = fire(env, {}, { raw })
    assert.equal(r.status, 0, JSON.stringify(raw))
    assert.equal(r.out, '')
  }
})

test('I1 an unwritable counter directory exits 0 with no output', () => {
  const env = setup()
  fs.writeFileSync(env.data, 'a file, not a directory')
  const spoke = run(env, cook(), 50)
  assert.deepEqual(spoke, {})
})

test('doctor rejects out-of-range budgets', () => {
  const env = setup({ config: { budgets: { softFraction: 1.5, finalReserve: 0, enabled: 'yes' } } })
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brigade-config'), 'doctor'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: env.home, BRIGADE_PROJECT_DIR: env.project },
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr + r.stdout, /budgets\.softFraction/)
  assert.match(r.stderr + r.stdout, /budgets\.finalReserve/)
  assert.match(r.stderr + r.stdout, /budgets\.enabled/)
})
