import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envelope, planInfo, noteFrom, latest, ledgerTail } from '../../hooks/board/lib/dish.mjs'

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
