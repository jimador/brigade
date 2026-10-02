import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  envelope, planInfo, noteFrom, latest, ledgerTail, findingsOf, messagesFrom, learningsFrom,
} from '../../hooks/board/lib/dish.mjs'

// Runs `fn` `runs` times and gives back the fastest run in milliseconds. A busy machine only ever
// makes a run slower, so the fastest one is the closest to what the code itself costs.
function fastestOf(runs, fn) {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

const verdict = [
  '---',
  'doc: verdict',
  'schema: 1',
  'dish: acme-example',
  'item: board-parse',
  'role: inspector',
  'model: sonnet',
  'verdict: FAIL',
  'attempt_reviewed: 1',
  'findings:',
  '  - { id: F1, severity: High }',
  '- stray list line',
  '---',
  '',
  '## Summary',
].join('\n')

const plan = [
  '---',
  'doc: plan',
  'dish: acme-example',
  'ticket: "ACME-12"',
  'items:',
  '  - { slug: state-contract, status: done, depends_on: [], heavy: false, files: [types/index.d.ts], attempts: [] }',
  '  - { slug: board-tickets, status: dispatched, depends_on: [], heavy: false, files: [a.mjs, b.mjs], attempts: [] }',
  '---',
  '',
  '# Plan',
].join('\n')

const ledger = [
  '---',
  'doc: ledger',
  '---',
  '',
  '## World state',
  '',
  'W1. [RELIABLE] Ticket file created.',
  '~~W2. [PROVISIONAL] old guess~~',
  'W3. [RELIABLE] Config doctor exit 0 (supersedes W2).',
  '',
  '## Archive',
  '',
  'W4. [RELIABLE] archived, should not show',
].join('\n')

test('envelope reads the verdict shape and skips list lines', () => {
  const env = envelope(verdict)
  assert.equal(env.verdict, 'FAIL')
  assert.equal(env.role, 'inspector')
  assert.equal(env.doc, 'verdict')
  assert.equal(env.findings, undefined)
  assert.ok(!Object.keys(env).some((k) => k.startsWith('-') || k.startsWith(' ')))
})

test('envelope keeps colons inside a value', () => {
  const env = envelope('---\nquestion: How: does it work?\nowner: alex\n---\n')
  assert.equal(env.question, 'How: does it work?')
  assert.equal(env.owner, 'alex')
})

test('envelope of text without frontmatter is empty', () => {
  assert.deepEqual(envelope('# Just a heading\n\nkey: value\n'), {})
  assert.deepEqual(envelope(''), {})
})

test('planInfo reads dish, ticket and item statuses', () => {
  assert.deepEqual(planInfo(plan), {
    dish: 'acme-example',
    ticket: 'ACME-12',
    items: [
      { slug: 'state-contract', status: 'done' },
      { slug: 'board-tickets', status: 'dispatched' },
    ],
  })
  assert.deepEqual(planInfo('no frontmatter'), { dish: '', ticket: '', items: [] })
})

test('noteFrom turns a verdict into a note', () => {
  assert.deepEqual(noteFrom(verdict, 42), {
    at: 42,
    dish: 'acme-example',
    item: 'board-parse',
    role: 'inspector',
    kind: 'verdict',
    gist: 'FAIL',
    findings: 1,
    summary: '',
    attempt: 1,
    file: null,
  })
})

test('noteFrom uses status for reports, and skips text with no doc', () => {
  const note = noteFrom('---\ndoc: report\nstatus: done\n---\n', 7)
  assert.equal(note.kind, 'report')
  assert.equal(note.gist, 'done')
  assert.equal(note.dish, '')
  assert.equal(noteFrom('---\nstatus: done\n---\n', 7), null)
  assert.equal(noteFrom('plain text', 7), null)
})

test('noteFrom gists for brief, ledger and unknown kinds', () => {
  assert.equal(noteFrom('---\ndoc: brief\nconfidence: high\n---\n', 1).gist, 'confidence high')
  assert.equal(noteFrom('---\ndoc: ledger\n---\n', 1).gist, 'memory updated')
  assert.equal(noteFrom('---\ndoc: plan\n---\n', 1).gist, '')
})

test('latest returns the newest notes first', () => {
  const notes = [{ at: 1 }, { at: 3 }, { at: 2 }]
  assert.deepEqual(latest(notes, 2).map((n) => n.at), [3, 2])
  assert.deepEqual(notes.map((n) => n.at), [1, 3, 2])
})

test('latest keeps input order for ties', () => {
  const notes = [{ at: 5, id: 'a' }, { at: 5, id: 'b' }, { at: 9, id: 'c' }]
  assert.deepEqual(latest(notes, 3).map((n) => n.id), ['c', 'a', 'b'])
})

test('ledgerTail returns live world-state units only', () => {
  assert.deepEqual(ledgerTail(ledger, 5), [
    'W1. [RELIABLE] Ticket file created.',
    'W3. [RELIABLE] Config doctor exit 0 (supersedes W2).',
  ])
  assert.deepEqual(ledgerTail(ledger, 1), ['W3. [RELIABLE] Config doctor exit 0 (supersedes W2).'])
})

const failVerdict = [
  '---',
  'doc: verdict',
  'dish: acme-limits',
  'item: token-bucket',
  'role: inspector',
  'verdict: FAIL',
  'attempt_reviewed: 1',
  'findings:',
  '  - { id: F1, severity: blocking, location: "src/foo.ts:42", summary: window resets on every request }',
  '  - { id: F2, severity: low, location: "test/foo.test.ts:9",',
  '      summary: "no test for the boundary" }',
  'trivial_only: false',
  '---',
  '',
  '## Verdict',
].join('\n')

const passVerdict = [
  '---',
  'doc: verdict',
  'dish: acme-limits',
  'item: token-bucket',
  'role: inspector',
  'verdict: PASS',
  'attempt_reviewed: 2',
  'findings: []',
  '---',
].join('\n')

const secondReport = [
  '---',
  'doc: report',
  'dish: acme-limits',
  'item: token-bucket',
  'role: cook',
  'status: done',
  'attempt: 2',
  '---',
].join('\n')

const brief = [
  '---',
  'doc: brief',
  'dish: acme-limits',
  'role: scout',
  'confidence: high',
  'question: "Which clock does the limiter read?"',
  '---',
].join('\n')

const planCheck = (blockingLines) => ['---', 'doc: plan_check', 'dish: acme-limits', 'role: inspector',
  ...blockingLines, 'blind_sketch_first: true', '---', '', '## Blind sketch'].join('\n')

test('noteFrom reads findings, the first summary and the attempt from a FAIL verdict', () => {
  assert.deepEqual(noteFrom(failVerdict, 50, 'reports/token-bucket-verdict.md'), {
    at: 50,
    dish: 'acme-limits',
    item: 'token-bucket',
    role: 'inspector',
    kind: 'verdict',
    gist: 'FAIL',
    findings: 2,
    summary: 'window resets on every request',
    attempt: 1,
    file: 'reports/token-bucket-verdict.md',
  })
})

test('noteFrom on a PASS with no findings', () => {
  const note = noteFrom(passVerdict, 60)
  assert.equal(note.gist, 'PASS')
  assert.equal(note.findings, 0)
  assert.equal(note.summary, '')
  assert.equal(note.attempt, 2)
  assert.equal(note.file, null)
})

test('noteFrom on a report from a second attempt', () => {
  const note = noteFrom(secondReport, 70, 'reports/token-bucket-cook.md')
  assert.equal(note.attempt, 2)
  assert.equal(note.findings, 0)
  assert.equal(note.summary, '')
  assert.equal(note.file, 'reports/token-bucket-cook.md')
})

test('noteFrom on a brief takes its question as the summary', () => {
  const note = noteFrom(brief, 80)
  assert.equal(note.summary, 'Which clock does the limiter read?')
  assert.equal(note.gist, 'confidence high')
  assert.equal(note.attempt, 1)
  assert.equal(note.file, null)
})

test('noteFrom with two arguments keeps file null and the old fields', () => {
  const note = noteFrom('---\ndoc: report\nstatus: done\n---\n', 7)
  assert.deepEqual(Object.keys(note).sort(),
    ['at', 'attempt', 'dish', 'file', 'findings', 'gist', 'item', 'kind', 'role', 'summary'])
  assert.equal(note.file, null)
  assert.equal(note.attempt, 1)
})

test('noteFrom counts a plan check\'s blocking items, as a number or a list', () => {
  assert.equal(noteFrom(planCheck(['blocking: 2']), 1).findings, 2)
  assert.equal(noteFrom(planCheck([
    'blocking:',
    '  - "B1 the first thing"',
    '  - B2 the second thing, which wraps',
    '    onto a second line - with a dash in it',
    '  - id: B3',
    '    summary: the third thing',
  ]), 1).findings, 3)
  assert.equal(noteFrom(planCheck(['blocking: []']), 1).findings, 0)
  assert.equal(noteFrom(planCheck([]), 1).findings, null)
})

test('findingsOf reads every finding, joining a wrapped one and dropping quotes', () => {
  assert.deepEqual(findingsOf(failVerdict), [
    { id: 'F1', severity: 'blocking', summary: 'window resets on every request' },
    { id: 'F2', severity: 'low', summary: 'no test for the boundary' },
  ])
  assert.deepEqual(findingsOf(passVerdict), [])
  assert.deepEqual(findingsOf('no frontmatter at all'), [])
  assert.deepEqual(findingsOf(verdict), [{ id: 'F1', severity: 'High', summary: '' }])
})

// A note as noteFrom builds it, with only the fields a test cares about spelled out.
const note = (fields) => ({ at: 1, dish: 'acme-limits', item: 'token-bucket', role: '', kind: 'report',
  gist: '', findings: 0, summary: '', attempt: 1, file: null, ...fields })

const agent = (fields) => ({ id: fields.name, name: 'Pip', role: 'cook', model: null, state: 'working',
  dish: 'acme-limits', item: 'token-bucket', ticket: null, card: null, activity: null, tokens: 0,
  startedAt: null, endedAt: null, ...fields })

const only = (n, agents = []) => {
  const out = messagesFrom([n], agents)
  return out.length === 1 ? out[0] : out
}

test('a done report goes from the cook to the inspector', () => {
  const m = only(note({ kind: 'report', gist: 'done', at: 9, file: 'reports/token-bucket-cook.md' }))
  assert.deepEqual(m, {
    id: 'report:acme-limits:token-bucket:9:reports/token-bucket-cook.md',
    at: 9,
    from: 'cook',
    to: 'inspector',
    item: 'token-bucket',
    text: 'token-bucket ready for review',
    file: 'reports/token-bucket-cook.md',
  })
})

test('a blocked report goes from the cook to the planner', () => {
  const m = only(note({ kind: 'report', gist: 'blocked' }))
  assert.equal(m.from, 'cook')
  assert.equal(m.to, 'planner')
  assert.equal(m.text, 'token-bucket is blocked')
  assert.equal(m.id, 'report:acme-limits:token-bucket:1:')
})

test('a FAIL verdict sends the item back to the cook with the first finding', () => {
  const m = only(note({ kind: 'verdict', gist: 'FAIL', findings: 3, summary: 'window resets on every request' }))
  assert.equal(m.from, 'inspector')
  assert.equal(m.to, 'cook')
  assert.equal(m.text, 'token-bucket sent back: window resets on every request (+2 more)')
  assert.equal(only(note({ kind: 'verdict', gist: 'FAIL', findings: 1, summary: 'one thing' })).text,
    'token-bucket sent back: one thing')
  assert.equal(only(note({ kind: 'verdict', gist: 'FAIL', findings: 2 })).text, 'token-bucket sent back')
})

test('a PASS verdict tells the planner, counting any notes', () => {
  const m = only(note({ kind: 'verdict', gist: 'PASS' }))
  assert.equal(m.from, 'inspector')
  assert.equal(m.to, 'planner')
  assert.equal(m.text, 'token-bucket passed review')
  assert.equal(only(note({ kind: 'verdict', gist: 'PASS', findings: 2 })).text, 'token-bucket passed review, 2 notes')
})

// The message wording is shared with the panels that draw it, so one finding reads `1 notes` too.
test('a PASS verdict with one finding says `, 1 notes`, the same form as any other count', () => {
  assert.equal(only(note({ kind: 'verdict', gist: 'PASS', findings: 1 })).text, 'token-bucket passed review, 1 notes')
  const onePass = passVerdict.replace('findings: []',
    'findings:\n  - { id: F1, severity: low, location: "src/foo.ts:7", summary: rename the helper }')
  assert.equal(messagesFrom([noteFrom(onePass, 1)], [])[0].text, 'token-bucket passed review, 1 notes')
})

test('a brief goes from the scout to the planner', () => {
  const m = only(note({ kind: 'brief', item: '', summary: 'Which clock does the limiter read?' }))
  assert.equal(m.from, 'scout')
  assert.equal(m.to, 'planner')
  assert.equal(m.text, 'answered: Which clock does the limiter read?')
  assert.equal(only(note({ kind: 'brief', item: '' })).text, 'brief written')
})

test('a plan check tells the planner how many items block', () => {
  const m = only(note({ kind: 'plan_check', item: '', findings: 2 }))
  assert.equal(m.from, 'inspector')
  assert.equal(m.to, 'planner')
  assert.equal(m.text, 'plan check: 2 blocking')
  assert.equal(only(note({ kind: 'plan_check', item: '', findings: 0 })).text, 'plan check: 0 blocking')
  assert.equal(only(note({ kind: 'plan_check', item: '', findings: null })).text, 'plan check written')
})

test('plan check messages from real frontmatter, number and list forms', () => {
  const fromText = (lines) => messagesFrom([noteFrom(planCheck(lines), 1)], [])[0].text
  assert.equal(fromText(['blocking: 2']), 'plan check: 2 blocking')
  assert.equal(fromText(['blocking:', '  - one', '  - two', '  - three']), 'plan check: 3 blocking')
  assert.equal(fromText([]), 'plan check written')
})

test('ledgers, plans, unknown kinds and odd gists make no message', () => {
  for (const kind of ['ledger', 'plan', 'acme-unknown']) assert.deepEqual(messagesFrom([note({ kind })], []), [])
  assert.deepEqual(messagesFrom([note({ kind: 'report', gist: 'thinking' })], []), [])
  assert.deepEqual(messagesFrom([note({ kind: 'verdict', gist: '' })], []), [])
})

test('names come from the roster only when exactly one agent fits', () => {
  const cook = agent({ name: 'Pip', role: 'cook' })
  const heavy = agent({ name: 'Moss', role: 'heavy' })
  const inspector = agent({ name: 'Wren', role: 'inspector' })
  const elsewhere = agent({ name: 'Fern', role: 'cook', item: 'other-item' })
  const fail = note({ kind: 'verdict', gist: 'FAIL' })
  assert.equal(only(fail, [cook, inspector, elsewhere]).to, 'Pip')
  assert.equal(only(fail, [cook, inspector, elsewhere]).from, 'Wren')
  assert.equal(only(fail, [heavy]).to, 'Moss')
  assert.equal(only(fail, [cook, heavy]).to, 'cook')
  assert.equal(only(fail, [elsewhere]).to, 'cook')
  assert.equal(only(fail, []).from, 'inspector')
  assert.equal(only(fail, [inspector, agent({ name: 'Ivy', role: 'inspector' })]).from, 'inspector')
  assert.equal(only(note({ kind: 'report', gist: 'done' }), [cook]).from, 'Pip')
})

test('messages come newest first, at most the limit', () => {
  const notes = [1, 5, 3, 4, 2].map((at) => note({ kind: 'report', gist: 'done', at }))
  assert.deepEqual(messagesFrom(notes, []).map((m) => m.at), [5, 4, 3, 2, 1])
  assert.deepEqual(messagesFrom(notes, [], 2).map((m) => m.at), [5, 4])
  assert.deepEqual(messagesFrom(notes, [], 0), [])
  const many = Array.from({ length: 30 }, (_, at) => note({ kind: 'report', gist: 'done', at }))
  assert.equal(messagesFrom(many, []).length, 20)
})

test('odd notes make a plain message or none, never a throw', () => {
  const odd = [null, 7, {}, { kind: 'report', gist: 'done' }, { kind: 'verdict', gist: 'FAIL', findings: 'x' }]
  const out = messagesFrom(odd, null)
  assert.equal(out.length, 2)
  assert.ok(out.every((m) => typeof m.text === 'string' && typeof m.id === 'string'))
  assert.deepEqual(messagesFrom(null, null), [])
})

const learnings = [
  '# Learnings for acme',
  '',
  'Append-only; newest last.',
  '',
  '## Validate the first report before the next wave',
  '',
  'Body text that is not a learning on its own.',
  '- a bullet under a plain heading is part of its body',
  '',
  '## 2026-08-26 — token-bucket retro',
  '- Packets name the clock. The limiter read the wall clock once.',
  '- Tests pin the boundary',
  '  and this wrapped line is not a learning',
  '  - nested bullets are not learnings either',
  '',
  '## Plan checks probe pasted patterns',
  '',
  '## 2026-09-01 — acme-sync retro',
  '- One lock per board file. Two writers raced on it.',
].join('\n')

test('learningsFrom reads both entry shapes, newest first', () => {
  assert.deepEqual(learningsFrom(learnings, 10), {
    total: 5,
    lines: [
      'One lock per board file',
      'Plan checks probe pasted patterns',
      'Tests pin the boundary',
      'Packets name the clock',
      'Validate the first report before the next wave',
    ],
  })
})

test('learningsFrom keeps the newest `limit` lines and a true total', () => {
  assert.deepEqual(learningsFrom(learnings, 2), {
    total: 5,
    lines: ['One lock per board file', 'Plan checks probe pasted patterns'],
  })
  assert.equal(learningsFrom(learnings).lines.length, 5)
  assert.deepEqual(learningsFrom(learnings, 0), { total: 5, lines: [] })
})

test('learningsFrom on an empty file', () => {
  assert.deepEqual(learningsFrom(''), { total: 0, lines: [] })
  assert.deepEqual(learningsFrom(null), { total: 0, lines: [] })
  assert.deepEqual(learningsFrom('# Only a title\n\nSome words.\n'), { total: 0, lines: [] })
})

test('summaries, message text and learnings from files are capped at 240 characters', () => {
  const long = 'the bucket refills too early '.repeat(200).slice(0, 5_000)
  const failing = ['---', 'doc: verdict', 'dish: acme-limits', 'item: token-bucket', 'verdict: FAIL', 'findings:',
    `  - { id: F1, severity: high, summary: "${long}" }`, '  - { id: F2, severity: low, summary: short }', '---'].join('\n')
  const fail = noteFrom(failing, 1)
  assert.ok(fail.summary.length <= 240 && fail.summary.endsWith('…'), fail.summary.length)
  const [sent] = messagesFrom([fail], [])
  assert.ok(sent.text.length <= 240, sent.text.length)
  assert.ok(sent.text.startsWith('token-bucket sent back: the bucket'))
  assert.ok(sent.text.endsWith('… (+1 more)'), sent.text.slice(-20))
  const asked = noteFrom(['---', 'doc: brief', `question: ${long}`, '---'].join('\n'), 1)
  assert.ok(asked.summary.length <= 240)
  assert.ok(messagesFrom([asked], [])[0].text.length <= 240)
  const raw = messagesFrom([note({ kind: 'verdict', gist: 'FAIL', item: 'x'.repeat(5_000), summary: long })], [])[0]
  assert.ok(raw.text.length <= 240 && raw.text.endsWith('…'), raw.text.length)
  const learned = learningsFrom(`## ${long}\n## 2026-01-01 retro\n- ${long}`, 5)
  assert.equal(learned.lines.length, 2)
  for (const line of learned.lines) assert.ok(line.length <= 240 && line.endsWith('…'), line.length)
})

test('hostile input is read in one pass, well under 100 ms', () => {
  const size = 200_000
  const fill = (piece) => piece.repeat(Math.ceil(size / piece.length)).slice(0, size)
  const wrap = (body, doc = 'verdict') => ['---', `doc: ${doc}`, 'verdict: FAIL', 'findings:', body, '---'].join('\n')
  const hostile = [
    fill('## '), fill('## \n'), fill('## 2026-01-01\n- '), fill('- { id: '), fill('  - { id: \n'),
    fill('summary: "'), fill('    summary: "\n'), fill('- '), fill('  - { id: "'),
    '  - { id: F1,\n' + fill('    summary: "\n'), 'blocking:\n' + fill('  - '),
  ]
  for (const text of hostile) {
    let learned, found, note, check
    const learnMs = fastestOf(5, () => { learned = learningsFrom(text) })
    const findMs = fastestOf(5, () => {
      found = findingsOf(wrap(text))
      note = noteFrom(wrap(text), 1)
      check = noteFrom(wrap(text, 'plan_check'), 1)
    })
    assert.ok(learnMs < 100, `learningsFrom took ${learnMs} ms at best of five`)
    assert.ok(findMs < 100, `findingsOf took ${findMs} ms at best of five`)
    assert.ok(Array.isArray(learned.lines) && Array.isArray(found) && note !== null && check !== null)
  }
})
