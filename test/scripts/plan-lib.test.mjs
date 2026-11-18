// Tests for scripts/lib/plan.mjs. Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePlan } from '../../scripts/lib/plan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const INLINE = `---
doc: plan
schema: 1
dish: sample
level: contracts
ticket_url: "https://example.com/t/1"
items:
  - { slug: one, status: done, depends_on: [], heavy: false, contract: true,
      files: [src/one.ts, src/one.test.ts],
      attempts: [{ model: haiku, trigger: initial, result: failed, cause: turn-limit },
                 { model: sonnet, trigger: escalation, reason: slip, result: done }] }
  - { slug: two, status: todo, depends_on: [one], heavy: true, files: [src/two.ts] }
---

## Dish
Fixture.

## Parked

| id | question | reopens at | raised |
|----|----------|------------|--------|
| Q1 | Which cache? | one | 2026-11-18 |
| Q2 | Retry policy? | implementation | 2026-11-19 |

## Packet: one

\`\`\`
## Packet: not-a-heading
\`\`\`

## Packet: two
`

const BLOCK = `---
doc: plan
schema: 1
dish: sample
level: contracts
ticket_url: "https://example.com/t/1"
items:
  - slug: one
    status: done
    depends_on: []
    heavy: false
    contract: true
    files:
      - src/one.ts
      - src/one.test.ts
    attempts:
      - model: haiku
        trigger: initial
        result: failed
        cause: turn-limit
      - { model: sonnet, trigger: escalation, reason: slip, result: done }
  - slug: two
    status: todo
    depends_on:
      - one
    heavy: true
    files: [src/two.ts]
---

## Dish
Fixture.

## Parked

| id | question | reopens at | raised |
|----|----------|------------|--------|
| Q1 | Which cache? | one | 2026-11-18 |
| Q2 | Retry policy? | implementation | 2026-11-19 |

## Packet: one

## Packet: two
`

test('inline items parse with attempts, cause and reason', () => {
  const plan = parsePlan(INLINE)
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.frontmatter.dish, 'sample')
  assert.equal(plan.frontmatter.level, 'contracts')
  assert.equal(plan.frontmatter.ticket_url, 'https://example.com/t/1')
  assert.equal(plan.items.length, 2)
  const [one, two] = plan.items
  assert.deepEqual(one.files, ['src/one.ts', 'src/one.test.ts'])
  assert.equal(one.contract, true)
  assert.equal(one.heavy, false)
  assert.deepEqual(one.attempts, [
    { model: 'haiku', trigger: 'initial', result: 'failed', cause: 'turn-limit', reason: '' },
    { model: 'sonnet', trigger: 'escalation', result: 'done', cause: '', reason: 'slip' },
  ])
  assert.deepEqual(two.depends_on, ['one'])
  assert.equal(two.heavy, true)
  assert.equal(two.contract, false)
  assert.deepEqual(two.attempts, [])
})

test('block items parse to the same structure as inline items', () => {
  assert.deepEqual(parsePlan(BLOCK), parsePlan(INLINE))
})

test('parked rows and packet headings are read; fenced headings are not', () => {
  const plan = parsePlan(INLINE)
  assert.deepEqual(plan.parked, [
    { id: 'Q1', question: 'Which cache?', reopensAt: 'one', raised: '2026-11-18' },
    { id: 'Q2', question: 'Retry policy?', reopensAt: 'implementation', raised: '2026-11-19' },
  ])
  assert.deepEqual(plan.packets, ['one', 'two'])
})

test('a parked row with an empty reopens-at cell keeps the empty string', () => {
  const plan = parsePlan('---\ndoc: plan\nitems: []\n---\n\n## Parked\n\n| id | question | reopens at | raised |\n|---|---|---|---|\n| Q1 | Why? |  | today |\n')
  assert.deepEqual(plan.parked, [{ id: 'Q1', question: 'Why?', reopensAt: '', raised: 'today' }])
})

test('wrapped inline items from the regression fixture shape parse', () => {
  const plan = parsePlan(`---
doc: plan
ticket: TEST-1
items:
  - { slug: one, status: done, depends_on: [],
      heavy: false, files: [src/one.ts], attempts: [] }
  - { slug: two, status: blocked,
      depends_on: [one], heavy: false, files: [src/two.ts],
      attempts: [] }
---
`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.items.map((i) => [i.slug, i.status, i.depends_on]), [
    ['one', 'done', []],
    ['two', 'blocked', ['one']],
  ])
})

test('block-style legacy item with only slug and status parses', () => {
  const plan = parsePlan('---\ndoc: plan\nitems:\n  - slug: legacy\n    status: in_review\n---\n')
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.items, [
    { slug: 'legacy', status: 'in_review', depends_on: [], files: [], heavy: false, contract: false, attempts: [] },
  ])
})

test('contract: true as a quoted string and CRLF line endings still parse', () => {
  const plan = parsePlan('---\r\ndoc: plan\r\nitems:\r\n  - { slug: a, contract: "true", files: [x] }\r\n---\r\n\r\n## Packet: a\r\n')
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.items[0].contract, true)
  assert.deepEqual(plan.packets, ['a'])
})

test('malformed input returns errors and never throws', () => {
  const inputs = [
    '',
    'no frontmatter at all',
    '---\ndoc: plan\nitems:\n  - { slug: a',
    '---\ndoc: plan\n',
    '---\nitems:\n  - { slug: a, attempts: [{ model: ',
    '---\nitems: nope\n---\n',
    '---\n: : :\n  - -\n[[[{{{\n---\n## Parked\n| | |\n',
    '---\nitems:\n  - { status: todo }\n---\n',
    null,
    undefined,
    42,
    {},
  ]
  for (const input of inputs) {
    let plan
    assert.doesNotThrow(() => { plan = parsePlan(input) })
    assert.ok(Array.isArray(plan.errors))
    assert.ok(Array.isArray(plan.items))
    assert.ok(Array.isArray(plan.parked))
    assert.ok(Array.isArray(plan.packets))
    assert.equal(typeof plan.frontmatter, 'object')
  }
  assert.ok(parsePlan('').errors.length > 0)
  assert.ok(parsePlan('---\ndoc: plan\n').errors.some((e) => /not closed/.test(e)))
  assert.ok(parsePlan('---\nitems: nope\n---\n').errors.some((e) => /items is not a list/.test(e)))
  assert.ok(parsePlan('---\nitems:\n  - { status: todo }\n---\n').errors.some((e) => /no slug/.test(e)))
})

test('the module has no imports', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'plan.mjs'), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.doesNotMatch(source, /\brequire\(|\bimport\(/)
})
