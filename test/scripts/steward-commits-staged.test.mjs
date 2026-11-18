// Tests for the staged-work commit step in the execute workflow: when a cook's commit was
// refused and it left its packet's files staged, a steward commits them before the inspector
// looks. Each test runs the generated workflows/brigade-execute.js with an agent() stub that
// answers by label prefix, the way the WORKFLOW SMOKE run in test/regression.sh loads it.
//   E1 a commit agent runs after every done cook, before the inspector, as a steward
//   E2 ok: true goes on to inspection and landing as normal
//   E3 ok: false blocks the item with the exact reason and inspects nothing
//   E4 the setup and land stewards say they never commit except in that step
//   I1 a cook that committed itself sees the same run apart from the one look
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'workflows', 'brigade-execute.js'), 'utf8')
  .replace('export const meta', 'const meta')

const WORKTREE = '/path/to/repo/.brigade/worktrees/d--a'
const REPORT_PATH = '/path/to/dish/reports/a-cook.md'
const PACKET = '## Packet: a\n- **files:**\n  - src/a.js (edit)\n'
const EXCEPT = 'except the staged-work commit step'

const pass = () => ({ verdict: 'PASS', verdictPath: '/path/to/dish/reports/a-verdict.md', trivialOnly: false, findings: [] })
const fail = () => ({ verdict: 'FAIL', verdictPath: '/path/to/dish/reports/a-verdict.md', trivialOnly: false, findings: [{ id: 'F1', severity: 'high', location: 'x.js:1', summary: 'broken' }] })
const done = { status: 'done', attempt: 1, branch: 'wip/d/a', reportPath: REPORT_PATH, filesChanged: ['src/a.js'], summary: 's' }

// Runs the workflow for one item. `script` maps a label prefix to a list of answers handed out
// in order; the last answer repeats. Every call is recorded with its label, prompt and options.
async function run(script) {
  const calls = []
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const answer = (prefix) => {
    const q = queues[prefix]
    if (!q || !q.length) throw new Error(`no scripted answer for ${prefix}`)
    return q.length > 1 ? q.shift() : q[0]
  }
  const agent = async (prompt, opts) => {
    calls.push({ label: opts.label, prompt, opts })
    const label = opts.label
    if (label.startsWith('steward-create:')) return { ok: true, detail: 'created' }
    if (label.startsWith('steward-land:')) return { ok: true, detail: 'landed', landedRange: 'a..b', reconstructed: [] }
    if (label.startsWith('probe:')) return { exists: true, valid: true, detail: 'ok' }
    for (const prefix of ['cook:', 'commit:', 'inspect:']) {
      if (label.startsWith(prefix)) return answer(prefix)
    }
    throw new Error(`unexpected agent call ${label}`)
  }
  const args = {
    dishDir: '/path/to/dish', repoRoot: '/path/to/repo', now: '2026-01-01T00:00:00Z', tier: 'two-star',
    deliverySlug: 'd', deliveryBranch: 'feat/d', gate: ['true'], maxParallel: 1, overrides: {}, promptOverrides: {},
    items: [{ slug: 'a', status: 'todo', dependsOn: [], heavy: false, packet: PACKET }],
  }
  const fn = new Function('args', 'phase', 'log', 'agent', 'parallel', 'pipeline', 'workflow', SRC)
  const ledger = await fn(args, () => {}, () => {}, agent, async (t) => Promise.all(t.map((f) => f())), undefined, undefined)
  const labels = calls.map((c) => c.label)
  const count = (re) => labels.filter((l) => re.test(l)).length
  const prompt = (label) => calls.find((c) => c.label === label).prompt
  return { ledger, item: ledger.items[0], calls, labels, count, prompt }
}

const committedOk = { ok: true, detail: 'abc1234 Implement a' }

test('E1: a steward commit agent runs after the done cook and before the inspector', async () => {
  const { labels, calls, prompt } = await run({ 'cook:': [done], 'commit:': [committedOk], 'inspect:': [pass()] })
  assert.ok(labels.indexOf('cook:a:0') < labels.indexOf('commit:a:0'))
  assert.ok(labels.indexOf('commit:a:0') < labels.indexOf('inspect:a:0'))
  const call = calls.find((c) => c.label === 'commit:a:0')
  const steward = calls.find((c) => c.label === 'steward-create:a').opts.agentType
  assert.equal(call.opts.agentType, steward)
  assert.deepEqual(call.opts.schema.required, ['ok', 'detail'])
  const p = prompt('commit:a:0')
  assert.ok(p.includes(`head -20 '${REPORT_PATH}'`))
  assert.match(p, /committed: false/)
  assert.ok(p.includes(`git -C '${WORKTREE}' diff --cached --name-only`))
  assert.ok(p.includes(`git -C '${WORKTREE}' log --oneline -1`))
  assert.ok(p.includes("'Implement a'"))
  assert.ok(p.includes(PACKET), 'the packet and its file list ride in the prompt')
  assert.match(p, /not in it, commit nothing: return ok: false with detail naming every\s+path/)
  assert.match(p, /'nothing to commit'/)
})

test('E1 adversarial: the commit command names each staged path after -- and never -a or .', async () => {
  const { prompt } = await run({ 'cook:': [done], 'commit:': [committedOk], 'inspect:': [pass()] })
  const p = prompt('commit:a:0')
  const commitLines = p.split('\n').filter((line) => /git\b.*\bcommit\b/.test(line) && line.includes(' -m '))
  assert.equal(commitLines.length, 1, commitLines.join('\n'))
  const line = commitLines[0]
  assert.ok(line.includes(`git -C '${WORKTREE}' commit -m '<message>' -- '<path 1>' '<path 2>' ...`), line)
  assert.doesNotMatch(line, /\s-a\b|--all|\s\.(\s|$)|\*/)
  assert.match(p, /Never use -a, --all, \., a wildcard, a\s+directory/)
  assert.match(p, /never run git add/)
})

test('E2: ok: true goes on to inspection and lands as normal', async () => {
  const { item, count } = await run({ 'cook:': [done], 'commit:': [committedOk], 'inspect:': [pass()] })
  assert.equal(item.status, 'done')
  assert.equal(item.blockedReason, null)
  assert.equal(count(/^inspect:a:0$/), 1)
  assert.equal(count(/^steward-land:a$/), 1)
})

test('E2: each rung gets its own commit step before its own inspector', async () => {
  const { labels, item } = await run({ 'cook:': [done], 'commit:': [committedOk], 'inspect:': [fail(), pass()] })
  assert.equal(item.status, 'done')
  assert.deepEqual(labels.filter((l) => /^(cook|commit|inspect):/.test(l)), ['cook:a:0', 'commit:a:0', 'inspect:a:0', 'cook:a:1', 'commit:a:1', 'inspect:a:1'])
})

test('E3: ok: false blocks with the exact reason, keeps the worktree and inspects nothing', async () => {
  const { item, count } = await run({ 'cook:': [done], 'commit:': [{ ok: false, detail: 'staged path not in the packet: .env' }] })
  assert.equal(item.status, 'blocked')
  assert.equal(item.blockedReason, `commit refused twice; staged work kept in ${WORKTREE}`)
  assert.equal(count(/^inspect:/), 0)
  assert.equal(count(/^steward-land:/), 0)
  assert.equal(count(/^cook:/), 1)
  assert.deepEqual(item.attempts.map((a) => [a.result, a.cause]), [['blocked', 'blocked-other']])
})

test('E3: a commit agent with no result does not block; landing still guards an empty branch', async () => {
  const { item, count } = await run({ 'cook:': [done], 'commit:': [], 'inspect:': [pass()] })
  assert.equal(count(/^commit:a:0$/), 1)
  assert.equal(count(/^inspect:a:0$/), 1)
  assert.equal(item.status, 'done')
})

test('E4: the setup and land steward prompts allow only the staged-work commit step', async () => {
  const { prompt, calls } = await run({ 'cook:': [done], 'commit:': [committedOk], 'inspect:': [pass()] })
  const flat = (s) => s.replace(/\s+/g, ' ')
  assert.ok(flat(prompt('steward-create:a')).includes(`You never run git add or git commit, ${EXCEPT}, never touch any file outside .brigade/`))
  assert.ok(flat(prompt('steward-land:a')).includes(`You never run git add or git commit on anything, ${EXCEPT}, never touch any file outside .brigade/`))
  // The commit agent's prompt is the only prompt that tells a steward to run git commit -m.
  const committing = calls.filter((c) => /git -C \S+ commit -m/.test(c.prompt)).map((c) => c.label)
  assert.deepEqual(committing, ['commit:a:0'])
})

test('I1: a cook that committed itself runs the same flow, and a blocked cook gets no commit step', async () => {
  const { item, labels } = await run({ 'cook:': [done], 'commit:': [{ ok: true, detail: 'nothing to commit' }], 'inspect:': [pass()] })
  assert.equal(item.status, 'done')
  assert.deepEqual(item.attempts.map((a) => a.result), ['done'])
  assert.deepEqual(labels.filter((l) => !l.startsWith('commit:')), ['steward-create:a', 'cook:a:0', 'inspect:a:0', 'probe:a:0', 'steward-land:a'])
  const blocked = await run({ 'cook:': [{ ...done, status: 'blocked', blockedReason: 'nope' }] })
  assert.equal(blocked.count(/^commit:/), 0)
  assert.equal(blocked.item.blockedReason, 'nope')
})
