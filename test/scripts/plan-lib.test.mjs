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

test('raw keeps every written value as text and stays out of the enumerable fields', () => {
  const plan = parsePlan('---\ndoc: plan\nitems:\n  - { slug: a, contract: maybe, heavy: "yes", files: [x, y], attempts: [{ model: haiku, trigger: nope }] }\n  - { slug: b, attempts: [] }\n  - { slug: c }\n---\n')
  assert.deepEqual(plan.errors, [])
  const [a, b, c] = plan.items
  assert.equal(a.contract, false)
  assert.equal(a.heavy, false)
  assert.deepEqual(a.raw, { slug: 'a', contract: 'maybe', heavy: 'yes', files: '[x, y]', attempts: '[{ model: haiku, trigger: nope }]' })
  assert.deepEqual(a.attempts[0].raw, { model: 'haiku', trigger: 'nope' })
  assert.equal(a.attempts[0].trigger, 'nope')
  assert.equal(Object.hasOwn(b.raw, 'attempts'), true)
  assert.equal(Object.hasOwn(c.raw, 'attempts'), false)
  assert.deepEqual(Object.keys(a), ['slug', 'status', 'depends_on', 'files', 'heavy', 'contract', 'attempts'])
  assert.equal(JSON.stringify(a).includes('raw'), false)
})

test('list entries at the indent of their key belong to it', () => {
  const plan = parsePlan('---\ndoc: plan\nitems:\n  - slug: a\n    status: todo\n    files:\n    - src/a.ts\n    attempts:\n    - model: haiku\n      trigger: nope\n      cause: bad\n    contract: true\n---\n')
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.items[0].files, ['src/a.ts'])
  assert.deepEqual(plan.items[0].attempts, [{ model: 'haiku', trigger: 'nope', result: '', cause: 'bad', reason: '' }])
  assert.equal(plan.items[0].contract, true)
})

test('inline fields after attempts are read', () => {
  const plan = parsePlan('---\ndoc: plan\nitems:\n  - { slug: a, attempts: [{ model: haiku, trigger: initial }], status: todo, depends_on: [b], files: [x], contract: maybe }\n---\n')
  assert.deepEqual(plan.errors, [])
  const [a] = plan.items
  assert.deepEqual([a.status, a.depends_on, a.files, a.raw.contract], ['todo', ['b'], ['x'], 'maybe'])
})

test('keys set further in than two columns past the dash still belong to their entry', () => {
  const four = parsePlan('---\ndoc: plan\nitems:\n    - slug: a\n        status: todo\n        attempts:\n            - model: haiku\n                trigger: nope\n    - slug: b\n        status: done\n---\n')
  const two = parsePlan('---\ndoc: plan\nitems:\n  - slug: a\n    status: todo\n    attempts:\n      - model: haiku\n        trigger: nope\n  - slug: b\n    status: done\n---\n')
  assert.deepEqual(four.errors, [])
  assert.deepEqual(four, two)
  assert.deepEqual(Object.keys(four.frontmatter), ['doc'])
})

test('a line no key owns is an error naming it, and its fields go nowhere', () => {
  const plan = parsePlan('---\ndoc: plan\nitems:\n  - { slug: a, status: todo }\n    - { slug: b, contract: maybe }\n      status: done\n---\n')
  assert.deepEqual(plan.errors, ['frontmatter line 5 is not under any key at its indent: - { slug: b, contract: maybe }'])
  assert.deepEqual(plan.items.map((i) => i.slug), ['a'])
  assert.equal(plan.items[0].raw.contract, undefined)
  assert.deepEqual(Object.keys(plan.frontmatter), ['doc'])
})

test('unclosed flow, text after it and a non-mapping attempt are errors naming the line', () => {
  assert.deepEqual(parsePlan('---\ndoc: plan\nitems:\n  - { slug: a, files: [x]\n---\n').errors, ['frontmatter line 4: unclosed { mapping'])
  assert.deepEqual(parsePlan('---\ndoc: plan\nitems:\n  - { slug: a }, { slug: b }\n---\n').errors, ['frontmatter line 4: unexpected text after the flow collection: , { slug: b }'])
  assert.deepEqual(parsePlan('---\ndoc: plan\nitems:\n  - slug: a\n    attempts:\n      - haiku\n---\n').errors, ['items[0] attempts[0] (frontmatter line 6) is not a mapping'])
  assert.deepEqual(parsePlan('---\ndoc: plan\nitems:\n  - slug: a\n  - status: todo\n---\n').errors, ['items[1] has no slug (frontmatter line 5)'])
})

test('trailing comments and block scalars are not values or errors', () => {
  const plan = parsePlan('---\ndoc: plan\nnotes: |\n  first line\n  second: line\nitems:\n  - slug: a # the only item\n    status: todo   # not started\n    files: [x] # one file\n---\n')
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.frontmatter.notes, 'first line\nsecond: line')
  assert.deepEqual([plan.items[0].slug, plan.items[0].status, plan.items[0].files], ['a', 'todo', ['x']])
})

const HEAD = '---\ndoc: plan\n'

test('a quote inside a plain flow scalar is text and swallows nothing (p05, p07)', () => {
  const plan = parsePlan(`${HEAD}intake:\n  - { ticket: T1, decision: leave, note: the cook's branch was stale }\nitems:\n  - { slug: a, note: it's fine, files: [x] }\n  - { slug: b, note: a 6" pipe }\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.items.map((i) => [i.slug, i.raw.note]), [['a', "it's fine"], ['b', 'a 6" pipe']])
})

test("quoted flow scalars resolve '' and \\\" escapes and keep their brackets", () => {
  const plan = parsePlan(`${HEAD}items:\n  - { slug: a, note: 'it''s } here', why: the cook's }\n  - { slug: b, note: "say \\"hi } now", files: [x] }\n  - { slug: c }\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.items.map((i) => i.slug), ['a', 'b', 'c'])
  assert.deepEqual([plan.items[0].raw.note, plan.items[0].raw.why], ["it's } here", "the cook's"])
  assert.deepEqual([plan.items[1].raw.note, plan.items[1].files], ['say "hi } now', ['x']])
})

test("block scalars unquote with their escapes and keep a plain value's apostrophe", () => {
  const plan = parsePlan(`${HEAD}title: 'it''s done' # c\nother: "a \\"b\\""\nitems:\n  - slug: a\n    note: the cook's branch # c\n    depends_on: [b]\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.frontmatter.title, "it's done")
  assert.equal(plan.frontmatter.other, 'a "b"')
  assert.deepEqual([plan.items[0].raw.note, plan.items[0].depends_on], ["the cook's branch", ['b']])
})

test('a plain scalar continued on deeper lines folds into one value (p08)', () => {
  const plan = parsePlan(`${HEAD}summary: a long plain\n  scalar that continues # c\ntitle: "a quoted\n  title"\nitems:\n  - slug: a\n    note: first\n      second\n    files: [x]\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.frontmatter.summary, 'a long plain scalar that continues')
  assert.equal(plan.frontmatter.title, 'a quoted title')
  assert.deepEqual([plan.items[0].raw.note, plan.items[0].files], ['first second', ['x']])
})

test('a deeper key or entry under a plain scalar is still a line no key owns', () => {
  assert.deepEqual(parsePlan(`${HEAD}summary: plain\n  status: oops\n---\n`).errors, ['frontmatter line 4 is not under any key at its indent: status: oops'])
  assert.deepEqual(parsePlan(`${HEAD}summary: plain\n  - oops\n---\n`).errors, ['frontmatter line 4 is not under any key at its indent: - oops'])
})

test('block scalar headers take an indentation indicator in either order', () => {
  const plan = parsePlan(`${HEAD}a: |2\n    kept\nb: >-2\n  folded\n  text\nc: |+1\n x\nd: >2-\n  y\nitems: []\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual([plan.frontmatter.a, plan.frontmatter.b, plan.frontmatter.c, plan.frontmatter.d], ['kept', 'folded text', 'x', 'y'])
})

test('a comment inside a wrapped inline item ends at its line (p24)', () => {
  const plan = parsePlan(`${HEAD}items:\n  - { slug: a, status: done,  # wrapped, with a } and a 'quote\n      depends_on: [ghost], files: [x] } # done\n  - { slug: b, note: "x # not a comment" }\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual([plan.items[0].status, plan.items[0].depends_on, plan.items[0].files], ['done', ['ghost'], ['x']])
  assert.equal(plan.items[1].raw.note, 'x # not a comment')
})

const slugs = (plan) => plan.items.map((i) => [i.slug, i.depends_on, i.files])

test('a block item whose first value wraps keeps its keys two columns past the dash (b1, b5)', () => {
  const b1 = parsePlan(`${HEAD}items:\n  - slug: a\n    files: [x]\n  - depends_on: [a,\n      ghost]\n    slug: b\n    files: [y]\n---\n`)
  assert.deepEqual(b1.errors, [])
  assert.deepEqual(slugs(b1), [['a', [], ['x']], ['b', ['a', 'ghost'], ['y']]])
  const b5 = parsePlan(`${HEAD}items:\n  - files: [src/a.ts,\n            src/b.ts]\n    slug: a\n    status: todo\n  - slug: b\n    depends_on: [a, ghost]\n---\n`)
  assert.deepEqual(b5.errors, [])
  assert.deepEqual(slugs(b5), [['a', [], ['src/a.ts', 'src/b.ts']], ['b', ['a', 'ghost'], []]])
  assert.equal(b5.items[0].status, 'todo')
})

test('a block entry whose first plain value folds onto the next line keeps its keys (b2)', () => {
  const plan = parsePlan(`${HEAD}intake:\n  - note: a long note that the planner\n      wrapped onto a second line\n    ticket: T1\n    decision: leave\nitems:\n  - { slug: a, depends_on: [ghost] }\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(slugs(plan), [['a', ['ghost'], []]])
})

test('a deeper key line after a one-line first value still seats the entry at that key', () => {
  const plan = parsePlan(`${HEAD}items:\n  - slug: a\n      status: done\n      files: [x]\n---\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual([plan.items[0].status, plan.items[0].files], ['done', ['x']])
})

test('an indented --- inside a block scalar does not end the frontmatter (a25)', () => {
  const plan = parsePlan(`${HEAD}intake:\n  - ticket: T1\n    note: |\n      first line\n      ---\n      after a rule\nitems:\n  - { slug: a }\n  - { slug: b, depends_on: [a, ghost] }\n---\n\n## Packet: a\n`)
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(slugs(plan), [['a', [], []], ['b', ['a', 'ghost'], []]])
  assert.deepEqual(plan.packets, ['a'])
  assert.deepEqual(parsePlan(`${HEAD}items: []\n  ---\n`).errors, ['frontmatter is not closed: no second --- line'])
})

test('an unclosed inline entry stops at its next sibling and names the cut comment (a26)', () => {
  const plan = parsePlan(`${HEAD}intake:\n  - { ticket: T1, decision: leave, note: see PR #12 }\nitems:\n  - { slug: a }\n  - { slug: b, depends_on: [a, ghost] }\n---\n`)
  assert.deepEqual(plan.errors, ['frontmatter line 4: unclosed { mapping (the text after " #" on that line is a YAML comment)'])
  assert.deepEqual(slugs(plan), [['a', [], []], ['b', ['a', 'ghost'], []]])
  const bare = parsePlan(`${HEAD}items:\n  - { slug: a, files: [x]\n  - { slug: b }\n---\n`)
  assert.deepEqual(bare.errors, ['frontmatter line 4: unclosed { mapping'])
  assert.deepEqual(bare.items.map((i) => i.slug), ['a', 'b'])
})

test('a frontmatter scalar is read without its quotes or trailing comment (level)', () => {
  assert.equal(parsePlan(`${HEAD}level: contracts  # c\n---\n`).frontmatter.level, 'contracts')
  assert.equal(parsePlan(`${HEAD}level: "contracts"\n---\n`).frontmatter.level, 'contracts')
})

test('the module has no imports', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'plan.mjs'), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.doesNotMatch(source, /\brequire\(|\bimport\(/)
})
