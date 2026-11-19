// Tests for the research and review workflows writing out a file an agent returned but could
// not save. Each test runs a generated workflow with an agent() stub that answers by label, the
// way the WORKFLOW SMOKE run in test/regression.sh loads it. One test per guarantee:
//   E1a the scout prompt and return schema ask for the brief's full text in briefDoc
//   E1  a scout that returns briefDoc and wrote nothing gets one transcriber with that exact text
//   E1b a brief already on disk is left alone
//   E2a the report-write steward is asked for its text in reportDoc
//   E2  a report the steward returned but did not write is transcribed as given
//   E3  no usable returned text means no probe and no transcriber, so nothing changes
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const load = (name) => fs.readFileSync(path.join(ROOT, 'workflows', name), 'utf8').replace('export const meta', 'const meta')
const RESEARCH = load('brigade-research.js')
const REVIEW = load('brigade-review.js')

const TRANSCRIBED_LINE = "Transcribed verbatim by the workflow from the agent's return; the agent's own write was refused."

const BRIEF_DOC = [
  '---', 'doc: brief', 'schema: 1', 'dish: dish', 'n: 1', 'topic: t', 'role: scout', 'model: m',
  'created: 2026-01-01T00:00:00Z', 'confidence: high', '---', '', '## Answer', 'Keep $HOME and `ticks` as written.', '',
].join('\n')

// Fills every required key from its schema, the way the smoke stub does, so phases the test
// does not care about still get a well-formed answer.
function fill(schema) {
  const out = {}
  const props = (schema && schema.properties) || {}
  for (const key of (schema && schema.required) || []) {
    const p = props[key] || {}
    if (p.enum) out[key] = p.enum[0]
    else if (p.type === 'array') out[key] = []
    else if (p.type === 'boolean') out[key] = true
    else if (p.type === 'integer' || p.type === 'number') out[key] = 1
    else if (p.type === 'object') out[key] = {}
    else out[key] = 'stub'
  }
  return out
}

// Runs one workflow. `answers` maps a label prefix to a function of (prompt, opts) that gives
// that call's result; anything unmatched gets a schema-filled answer. Every call is recorded.
async function run(src, args, answers) {
  const calls = []
  const agent = async (prompt, opts) => {
    calls.push({ label: opts.label, prompt, schema: opts.schema, agentType: opts.agentType })
    for (const [prefix, fn] of Object.entries(answers)) {
      if (opts.label.startsWith(prefix)) return fn(prompt, opts)
    }
    return fill(opts.schema)
  }
  const fn = new Function('args', 'phase', 'log', 'agent', 'parallel', 'pipeline', 'workflow', src)
  const result = await fn(args, () => {}, () => {}, agent, async (t) => Promise.all(t.map((f) => f())), undefined, undefined)
  return { result, calls, labels: calls.map((c) => c.label) }
}

const researchArgs = {
  dishDir: '/path/to/dish', repoRoot: '/path/to/repo', now: '2026-01-01T00:00:00Z', tier: 'two-star',
  questions: [{ n: 1, topic: 't', question: 'q', why: 'w', allowWeb: false }], overrides: {}, promptOverrides: {},
}
const BRIEF_PATH = '/path/to/dish/briefs/1-t.md'
const scout = (extra = {}) => () => ({ answer: 'a', confidence: 'high', briefPath: BRIEF_PATH, ...extra })

test('E1a: the scout is asked for the brief text in briefDoc', async () => {
  const { calls } = await run(RESEARCH, researchArgs, { 'scout:': scout() })
  const call = calls.find((c) => c.label === 'scout:t')
  assert.match(call.prompt.replace(/\s+/g, ' '), /exact full text of the brief file you wrote \(or tried to write\), frontmatter included, in briefDoc/)
  assert.equal(call.schema.properties.briefDoc.type, 'string')
})

test('E1: a returned brief with no file on disk is transcribed once, verbatim, by a steward', async () => {
  const { result, calls, labels } = await run(RESEARCH, researchArgs, {
    'scout:': scout({ briefDoc: BRIEF_DOC }),
    'probe:brief:': () => ({ exists: false, detail: 'No such file' }),
    'transcribe:brief:': () => ({ ok: true, detail: 'written' }),
  })
  assert.deepEqual(labels, ['scout:t', 'probe:brief:1', 'transcribe:brief:1'])
  const t = calls[2]
  assert.ok(t.agentType && t.agentType === calls[1].agentType, 'transcriber runs as the steward agent type')
  assert.ok(t.prompt.includes(`cat > '${BRIEF_PATH}' <<'BRIGADE_BRIEF_EOF'\n${BRIEF_DOC}${TRANSCRIBED_LINE}\nBRIGADE_BRIEF_EOF\n`), 'heredoc carries the exact brief plus the attribution line')
  assert.equal(result.briefs.length, 1)
  assert.equal(result.briefs[0].transcribed, true)
  assert.equal(result.failed, 0)
})

test('E1b: a brief already on disk gets no transcriber', async () => {
  const { result, labels } = await run(RESEARCH, researchArgs, {
    'scout:': scout({ briefDoc: BRIEF_DOC }),
    'probe:brief:': () => ({ exists: true, detail: '---' }),
  })
  assert.deepEqual(labels, ['scout:t', 'probe:brief:1'])
  assert.equal(result.briefs[0].transcribed, undefined)
})

test('E3: research without usable brief text dispatches no probe and no transcriber', async () => {
  const bad = [undefined, '', 'just an answer, no frontmatter', '---\ndoc: verdict\n---\n', `${BRIEF_DOC}BRIGADE_BRIEF_EOF\n`]
  for (const briefDoc of bad) {
    const { result, labels } = await run(RESEARCH, researchArgs, { 'scout:': scout(briefDoc === undefined ? {} : { briefDoc }) })
    assert.deepEqual(labels, ['scout:t'], `briefDoc=${JSON.stringify(briefDoc)}`)
    assert.deepEqual(result.briefs, [{ n: 1, topic: 't', answer: 'a', confidence: 'high', briefPath: BRIEF_PATH, notVerified: undefined }])
  }
  const dead = await run(RESEARCH, researchArgs, { 'scout:': () => null })
  assert.deepEqual(dead.labels, ['scout:t'])
  assert.equal(dead.result.failed, 1)
})

const reviewArgs = {
  repoRoot: '/path/to/repo', now: '2026-01-01T00:00:00Z', tier: 'one-star', mainLine: 'main',
  reviewSlug: 'rv', input: { kind: 'branch', ref: 'feat/x' }, boardConfigured: false, overrides: {}, promptOverrides: {},
}
const REPORT_PATH = '/path/to/repo/.brigade/reviews/rv/report.md'
const resolve = () => ({ ok: true, base: 'a', head: 'b', range: 'a..b', worktreePath: '/path/to/wt', prTitle: '', prBody: '' })
// The report text the workflow handed the report-write steward, read back out of its prompt.
const markdownIn = (prompt) => prompt.split('\nBEGIN UNTRUSTED\n')[1].split('\nEND UNTRUSTED')[0]

test('E2a: the report-write steward is asked for its text in reportDoc', async () => {
  const { calls } = await run(REVIEW, reviewArgs, { 'steward-resolve': resolve })
  const call = calls.find((c) => c.label === 'report-write')
  assert.match(call.prompt.replace(/\s+/g, ' '), /exact full text you wrote \(or tried to write\) to that file, frontmatter included, in reportDoc/)
  assert.equal(call.schema.properties.reportDoc.type, 'string')
})

test('E2: a returned report with no file on disk is transcribed once, verbatim, by a steward', async () => {
  let doc = null
  const { result, calls, labels } = await run(REVIEW, reviewArgs, {
    'steward-resolve': resolve,
    'report-write': (prompt) => { doc = `${markdownIn(prompt)}\n`; return { ok: false, detail: 'Write refused', reportDoc: doc } },
    'probe:review': () => ({ exists: false, detail: 'No such file' }),
    'transcribe:review': () => ({ ok: true, detail: 'written' }),
  })
  const at = labels.indexOf('report-write')
  assert.deepEqual(labels.slice(at, at + 3), ['report-write', 'probe:review', 'transcribe:review'])
  assert.equal(labels.filter((l) => l === 'transcribe:review').length, 1)
  const t = calls[at + 2]
  assert.ok(doc.startsWith('---\ndoc: review_report\n'))
  assert.equal(t.agentType, calls[at].agentType, 'transcriber runs as the steward agent type')
  assert.ok(t.prompt.includes(`<<'BRIGADE_REPORT_EOF'\n${doc}${TRANSCRIBED_LINE}\nBRIGADE_REPORT_EOF\n`), 'heredoc carries the exact report plus the attribution line')
  assert.equal(result.reportPath, REPORT_PATH)
})

test('E2b: a report already on disk gets no transcriber', async () => {
  const { labels } = await run(REVIEW, reviewArgs, {
    'steward-resolve': resolve,
    'report-write': (prompt) => ({ ok: true, detail: 'ok', reportDoc: markdownIn(prompt) }),
    'probe:review': () => ({ exists: true, detail: '---' }),
  })
  assert.ok(labels.includes('probe:review'))
  assert.ok(!labels.some((l) => l.startsWith('transcribe:')))
})

test('E3: review without usable report text dispatches no probe and no transcriber', async () => {
  const variants = [
    () => ({ ok: false, detail: 'Write refused' }),
    () => ({ ok: false, detail: 'Write refused', reportDoc: '' }),
    (prompt) => ({ ok: false, detail: 'Write refused', reportDoc: markdownIn(prompt).replace('doc: review_report', 'doc: review_reprot') }),
    () => null,
  ]
  for (const write of variants) {
    const { result, labels } = await run(REVIEW, reviewArgs, { 'steward-resolve': resolve, 'report-write': write })
    assert.ok(labels.includes('report-write'))
    assert.ok(!labels.some((l) => l === 'probe:review' || l.startsWith('transcribe:')), labels.join(','))
    assert.equal(result.reportPath, REPORT_PATH)
  }
})
