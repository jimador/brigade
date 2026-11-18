// Tests for validateArgs in workflows/config.js and the entry check each workflow runs with
// it. One test per guarantee:
//   R1  validateArgs(spec, A) returns { ok, errors, unknown } for the six known types, plus
//       'any' for writing
//   E1  a missing required key gives `missing arg: <key> (<type>)`
//   E2  a present key of the wrong type gives `arg <key> must be <type>, got <actual>`
//   E3  each generated workflow with a bad arg logs the errors and returns its early-exit
//       shape with no agent called
//   E4  unknown top-level keys log one `ignoring unknown args: a, b` line and the run goes on
//   I1  overrides and promptOverrides of every object shape pass, unchecked inside, and the
//       helpers that read them are unchanged
// config.js has no exports, so it is loaded the way test/regression.sh loads it.
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'workflows', 'config.js'), 'utf8')
const validateArgs = new Function(SRC + '; return validateArgs')()
const SPECS = new Function(SRC + '; return { ARGS_EXECUTE, ARGS_RESEARCH, ARGS_REVIEW }')()

// Args that satisfy each workflow's spec: the same ones the WORKFLOW SMOKE run uses.
const GOOD = {
  execute: {
    dishDir: '/tmp/d', repoRoot: '/tmp/r', now: '2026-01-01T00:00:00Z', tier: 'two-star',
    deliverySlug: 's', deliveryBranch: 'feat/s', gate: [], maxParallel: 2,
    overrides: {}, promptOverrides: {},
    items: [{ slug: 'a', status: 'todo', dependsOn: [], heavy: false, packet: 'P' }],
  },
  research: {
    dishDir: '/tmp/d', repoRoot: '/tmp/r', now: '2026-01-01T00:00:00Z', tier: 'two-star',
    questions: [{ n: 1, topic: 't', question: 'q', why: 'w', allowWeb: false }],
    overrides: {}, promptOverrides: {},
  },
  review: {
    repoRoot: '/tmp/r', now: '2026-01-01T00:00:00Z', tier: 'one-star', mainLine: 'main',
    reviewSlug: 'smoke-one', input: { kind: 'branch', ref: 'feat/x' }, boardConfigured: false,
    overrides: {}, promptOverrides: {},
  },
}

const ALL_TYPES = {
  required: { s: 'string', n: 'number', b: 'boolean', a: 'array', o: 'object', ss: 'string[]' },
  optional: {},
}

test('R1: returns ok, errors and unknown for every type', () => {
  const out = validateArgs(ALL_TYPES, { s: 'x', n: 0, b: false, a: [1, 'two'], o: {}, ss: ['a', 'b'] })
  assert.deepEqual(out, { ok: true, errors: [], unknown: [] })
  assert.deepEqual(validateArgs(ALL_TYPES, { s: 'x', n: 0, b: false, a: [], o: {}, ss: [] }).ok, true)
  // The shipped specs accept the smoke args of their own workflow.
  assert.deepEqual(validateArgs(SPECS.ARGS_EXECUTE, GOOD.execute), { ok: true, errors: [], unknown: [] })
  assert.deepEqual(validateArgs(SPECS.ARGS_RESEARCH, GOOD.research), { ok: true, errors: [], unknown: [] })
  assert.deepEqual(validateArgs(SPECS.ARGS_REVIEW, GOOD.review), { ok: true, errors: [], unknown: [] })
})

test('E1: a missing required key names the key and its type', () => {
  const { items, ...noItems } = GOOD.execute
  const out = validateArgs(SPECS.ARGS_EXECUTE, noItems)
  assert.equal(out.ok, false)
  assert.deepEqual(out.errors, ['missing arg: items (array)'])
  // An explicit undefined is missing too, and every missing key is reported, in spec order.
  const two = validateArgs(SPECS.ARGS_REVIEW, { ...GOOD.review, input: undefined, reviewSlug: undefined })
  assert.deepEqual(two.errors, ['missing arg: reviewSlug (string)', 'missing arg: input (object)'])
  // No args at all: every required key is named, plus what args actually was.
  const none = validateArgs(SPECS.ARGS_RESEARCH, undefined)
  assert.deepEqual(none.errors, [
    'args must be object, got undefined',
    'missing arg: dishDir (string)',
    'missing arg: repoRoot (string)',
    'missing arg: now (string)',
    'missing arg: questions (array)',
  ])
})

test('E2: a key of the wrong type names what it must be and what it got', () => {
  const out = validateArgs(ALL_TYPES, { s: 1, n: '1', b: 'yes', a: {}, o: [], ss: ['a', 2] })
  assert.deepEqual(out.errors, [
    'arg s must be string, got number',
    'arg n must be number, got string',
    'arg b must be boolean, got string',
    'arg a must be array, got object',
    'arg o must be object, got array',
    'arg ss must be string[], got array',
  ])
  assert.deepEqual(validateArgs(ALL_TYPES, { s: null, n: 0, b: true, a: [], o: null, ss: 'x' }).errors, [
    'arg s must be string, got null',
    'arg o must be object, got null',
    'arg ss must be string[], got string',
  ])
  // Optional keys are type-checked when present; null counts as not passed.
  assert.deepEqual(validateArgs(SPECS.ARGS_EXECUTE, { ...GOOD.execute, maxParallel: '2', tier: 3 }).errors, [
    'arg tier must be string, got number',
    'arg maxParallel must be number, got string',
  ])
  assert.equal(validateArgs(SPECS.ARGS_EXECUTE, { ...GOOD.execute, overrides: null, writing: null }).ok, true)
})

test('R1: type any accepts every value, so a malformed writing never stops a run', () => {
  for (const v of [null, 'report', ['report'], 7, true, {}, { rules: ['x'] }]) {
    assert.deepEqual(validateArgs({ required: { k: 'any' } }, { k: v }), { ok: true, errors: [], unknown: [] }, JSON.stringify(v))
    for (const [spec, good] of [[SPECS.ARGS_EXECUTE, GOOD.execute], [SPECS.ARGS_RESEARCH, GOOD.research], [SPECS.ARGS_REVIEW, GOOD.review]]) {
      assert.deepEqual(validateArgs(spec, { ...good, writing: v }), { ok: true, errors: [], unknown: [] }, JSON.stringify(v))
    }
  }
  // A missing required key of type any is still missing.
  assert.deepEqual(validateArgs({ required: { k: 'any' } }, {}).errors, ['missing arg: k (any)'])
})

test('E4: unknown top-level keys are listed but do not fail the check', () => {
  const out = validateArgs(SPECS.ARGS_EXECUTE, { ...GOOD.execute, colour: 'red', extra: 1 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.unknown, ['colour', 'extra'])
})

test('I1: overrides and promptOverrides of any object shape pass unchecked inside', () => {
  const shapes = [
    { overrides: {}, promptOverrides: {} },
    { overrides: { config: { models: { cook: 'x' } } }, promptOverrides: { cook: ['rule'] } },
    { overrides: { models: { cook: 'x' }, policy: { scoutCap: 1 } }, promptOverrides: { cook: 'rule' } },
    { overrides: { config: {} }, promptOverrides: { overrides: { cook: [{}] }, text: { cook: ['rule'] } } },
    { overrides: { config: 42 }, promptOverrides: { overrides: {} } },
    { overrides: null, promptOverrides: null },
  ]
  for (const extra of shapes) {
    for (const [spec, good] of [[SPECS.ARGS_EXECUTE, GOOD.execute], [SPECS.ARGS_RESEARCH, GOOD.research], [SPECS.ARGS_REVIEW, GOOD.review]]) {
      assert.deepEqual(validateArgs(spec, { ...good, ...extra }), { ok: true, errors: [], unknown: [] }, JSON.stringify(extra))
    }
  }
})

// Runs a generated workflow the way WORKFLOW SMOKE in test/regression.sh does, with stub
// runtime hooks, and records every log line and agent call.
async function runWorkflow(file, args) {
  const src = fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8').replace('export const meta', 'const meta')
  const logs = []
  const phases = []
  const agentCalls = []
  const fn = new Function('args', 'phase', 'log', 'agent', 'parallel', 'pipeline', 'workflow', src)
  const result = await fn(
    args,
    (title) => phases.push(title),
    (msg) => logs.push(msg),
    async (prompt, opts) => {
      agentCalls.push((opts && opts.label) || prompt.slice(0, 40))
      return {}
    },
    async (thunks) => Promise.all(thunks.map((t) => t())),
    async (items) => items,
    undefined,
  )
  return { result, logs, phases, agentCalls }
}

test('E3: execute with items missing stops at entry with no agent called', async () => {
  const { items, ...noItems } = GOOD.execute
  const { result, logs, phases, agentCalls } = await runWorkflow('brigade-execute.js', noItems)
  assert.deepEqual(result, { items: [], stoppedEarly: true, reason: 'invalid args: missing arg: items (array)' })
  assert.deepEqual(agentCalls, [])
  assert.deepEqual(phases, [])
  assert.ok(logs.some((l) => l.endsWith('missing arg: items (array)')), logs.join('\n'))
})

test('E3: execute joins every error with "; " and also takes args as a JSON string', async () => {
  const { items, ...noItems } = GOOD.execute
  const { result, agentCalls } = await runWorkflow('brigade-execute.js', JSON.stringify({ ...noItems, gate: 'npm test' }))
  assert.equal(result.reason, 'invalid args: missing arg: items (array); arg gate must be string[], got string')
  assert.deepEqual(agentCalls, [])
})

test('E3: research with questions missing returns its early-exit shape', async () => {
  const { questions, ...bad } = GOOD.research
  const { result, agentCalls } = await runWorkflow('brigade-research.js', bad)
  assert.deepEqual(result, { briefs: [], dropped: 0, failed: 0, unreported: [], error: 'invalid args: missing arg: questions (array)' })
  assert.deepEqual(agentCalls, [])
})

test('E3: review with input missing returns its early-exit shape', async () => {
  const { input, ...bad } = GOOD.review
  const { result, phases, agentCalls } = await runWorkflow('brigade-review.js', bad)
  assert.deepEqual(result, { findings: [], contextTier: 'bare', reportPath: null, error: 'invalid args: missing arg: input (object)' })
  assert.deepEqual(agentCalls, [])
  assert.deepEqual(phases, [])
})

test('E3: args that are not an object stop every workflow instead of crashing', async () => {
  for (const file of ['brigade-execute.js', 'brigade-research.js', 'brigade-review.js']) {
    for (const args of [null, 'null', undefined]) {
      const { result, phases, agentCalls } = await runWorkflow(file, args)
      const reason = result.reason || result.error
      assert.ok(reason.startsWith(`invalid args: args must be object, got ${args === undefined ? 'undefined' : 'null'}; missing arg: `), `${file} ${args}: ${reason}`)
      assert.deepEqual(agentCalls, [])
      assert.deepEqual(phases, [])
    }
  }
})

test('E4: an unknown key logs one warning line and the run goes on to the agents', async () => {
  const { logs, agentCalls } = await runWorkflow('brigade-research.js', { ...GOOD.research, colour: 'red', extra: 1 })
  const warnings = logs.filter((l) => l.includes('ignoring unknown args'))
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].endsWith('ignoring unknown args: colour, extra'), warnings[0])
  assert.ok(agentCalls.length > 0, 'expected the run to continue and dispatch a scout')
})
