import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHASES, planItems, phaseOf, workCards, ticketCards, toWorkLanes, pickDish,
} from '../../hooks/board/lib/work.mjs'

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

// An invented three-item plan: one item with a packet and a goal, one with a packet and no goal,
// one with no packet at all, and a malformed item line in between.
const plan = [
  '---',
  'doc: plan',
  'dish: acme-throttle',
  'ticket: ACME-7',
  'delivery_branch: feat/rate-limit',
  'tier: three-star',
  'kind: build',
  'intake:',
  '  - { ticket: acme-old, decision: leave, note: "not this one" }',
  'items:',
  '  - { slug: token-bucket, status: done, depends_on: [], heavy: true, files: [src/bucket.ts, test/bucket.test.ts], attempts: [{ model: opus, trigger: initial, result: done }, { model: opus, trigger: fail-retry, result: done }] }',
  '  - { slug: broken-line, status: todo, depends_on: [token-bucket',
  '  - { slug: limit-headers, status: dispatched, depends_on: [token-bucket], heavy: false, files: [src/headers.ts], attempts: [] }',
  '  - { slug: usage-docs, status: todo, depends_on: [token-bucket, limit-headers], heavy: false, files: [docs/usage.md], attempts: [] }',
  '---',
  '',
  '## Dish',
  '',
  'Some words about the dish.',
  '',
  '## Packet: token-bucket',
  '',
  '- **heavy:** true',
  '',
  '### Goal',
  '',
  'Count calls per customer in a bucket. Refill it',
  'every second.',
  '',
  'A second paragraph that is not part of the goal.',
  '',
  '## World state',
  '',
  '```md',
  '## Goal',
  '```',
  '',
  '### Contracts',
  '',
  '## Packet: limit-headers',
  '',
  '### Steps',
  '',
  '1. Do the thing.',
  '',
].join('\n')

test('PHASES lists the five lanes in order', () => {
  assert.deepEqual(PHASES, [
    { key: 'todo', title: 'To do' }, { key: 'cooking', title: 'Cooking' }, { key: 'review', title: 'In review' },
    { key: 'rework', title: 'Rework' }, { key: 'done', title: 'Done' },
  ])
})

test('planItems reads the envelope and every well-formed item, skipping the malformed line', () => {
  const out = planItems(plan)
  assert.equal(out.dish, 'acme-throttle')
  assert.equal(out.ticket, 'ACME-7')
  assert.equal(out.branch, 'feat/rate-limit')
  assert.equal(out.tier, 'three-star')
  assert.equal(out.kind, 'build')
  assert.deepEqual(out.items, [
    {
      slug: 'token-bucket', status: 'done', heavy: true, dependsOn: [],
      files: ['src/bucket.ts', 'test/bucket.test.ts'], attempts: 2,
      goal: 'Count calls per customer in a bucket. Refill it every second.',
    },
    {
      slug: 'limit-headers', status: 'dispatched', heavy: false, dependsOn: ['token-bucket'],
      files: ['src/headers.ts'], attempts: 0, goal: '',
    },
    {
      slug: 'usage-docs', status: 'todo', heavy: false, dependsOn: ['token-bucket', 'limit-headers'],
      files: ['docs/usage.md'], attempts: 0, goal: '',
    },
  ])
})

test('planItems gives empty strings for a missing envelope and never throws on junk', () => {
  assert.deepEqual(planItems(''), { dish: '', ticket: '', branch: '', tier: '', kind: '', items: [] })
  assert.deepEqual(planItems(null).items, [])
  assert.deepEqual(planItems('no frontmatter\n## Packet: x\n### Goal\nhi').items, [])
  const junk = [
    '---', 'items:',
    '  - { slug: , status: todo }',
    '  - { status: todo }',
    '  - { slug: a, status: todo ]',
    '  - { slug: b, status: todo, files: [x, }',
    '  - { slug: c, status: todo, note: "unterminated }',
    '  - not a mapping',
    '',
    '# a comment',
    '  - { slug: ok-one, status: todo, note: don\'t mind the apostrophe }',
    '---',
  ].join('\n')
  assert.deepEqual(planItems(junk).items.map((i) => i.slug), ['ok-one'])
})

test('planItems only reads item lines under items:, not other lists', () => {
  const text = ['---', 'intake:', '  - { slug: not-an-item, status: todo }', 'items:', '  - { slug: real, status: todo }', 'other: x', '  - { slug: also-not, status: todo }', '---'].join('\n')
  assert.deepEqual(planItems(text).items.map((i) => i.slug), ['real'])
})

test('a ## World state line and a fenced ## Goal do not end a packet', () => {
  const text = [
    '---', 'items:', '  - { slug: late-goal, status: todo }', '---',
    '## Packet: late-goal',
    '## World state',
    '```',
    '## Goal',
    '```',
    '### Goal',
    'Found after the other headings.',
    '## Packet: next-one',
    '### Goal',
    'Belongs to someone else.',
  ].join('\n')
  assert.equal(planItems(text).items[0].goal, 'Found after the other headings.')
})

test('a goal stops at the next packet and is never borrowed from it', () => {
  const text = [
    '---', 'items:', '  - { slug: first, status: todo }', '  - { slug: second, status: todo }', '---',
    '## Packet: first',
    '### Goal',
    '## Packet: second',
    '### Goal',
    'Second goal.',
  ].join('\n')
  const [first, second] = planItems(text).items
  assert.equal(first.goal, '')
  assert.equal(second.goal, 'Second goal.')
})

test('slugs that look like lookup-object keys are plain data', () => {
  const text = ['---', 'items:', '  - { slug: __proto__, status: todo }', '  - { slug: constructor, status: done }', '---', '## Packet: constructor', '### Goal', 'Built ok.'].join('\n')
  const items = planItems(text).items
  assert.deepEqual(items.map((i) => [i.slug, i.goal]), [['__proto__', ''], ['constructor', 'Built ok.']])
})

test('a 200,000-character plan of hostile lines parses in under 100 ms', () => {
  const lines = ['---', 'items:']
  lines.push('  ' + '- { slug: '.repeat(4000))
  for (let i = 0; i < 400; i++) lines.push('  - { slug: s' + i + ', status: todo, files: [' + 'a, '.repeat(10))
  lines.push('---')
  lines.push('## Packet: ' + '## Packet: '.repeat(3000))
  lines.push('### Goal'.repeat(3000))
  for (let i = 0; i < 1500; i++) lines.push('## Packet: s' + i, '### Goal', '- { slug: ')
  let text = lines.join('\n')
  while (text.length < 200000) text += '\n### Goal\n## Packet: '
  assert.ok(text.length >= 200000)
  let out
  const took = fastestOf(5, () => { out = planItems(text) })
  assert.deepEqual(out.items, [])
  assert.ok(took < 100, 'took ' + took.toFixed(1) + ' ms at best of five')
})

// Notes and agents built by hand, the way the dish reader and the roster shape them.
const item = (over = {}) => ({ slug: 'token-bucket', status: 'todo', heavy: false, dependsOn: [], files: [], attempts: 0, goal: '', ...over })
const report = (at, gist, over = {}) => ({ at, dish: 'acme-throttle', item: 'token-bucket', role: 'cook', kind: 'report', gist, findings: 0, summary: '', attempt: 1, file: null, ...over })
const verdict = (at, gist, findings = 0, over = {}) => ({ at, dish: 'acme-throttle', item: 'token-bucket', role: 'inspector', kind: 'verdict', gist, findings, summary: '', attempt: 1, file: null, ...over })
const agent = (role, over = {}) => ({ id: 'a-' + role, name: 'Sage', role, model: null, state: 'working', dish: 'acme-throttle', item: 'token-bucket', ticket: null, card: null, activity: null, tokens: 0, startedAt: 1, endedAt: null, ...over })

test('rule 1: a working inspector on the item puts it in review', () => {
  assert.deepEqual(phaseOf(item(), [], [agent('inspector')]), { phase: 'review', tag: null, alert: false })
})

test('rule 1 beats a PASS verdict already on disk', () => {
  assert.deepEqual(phaseOf(item({ status: 'done' }), [report(1, 'done'), verdict(2, 'PASS')], [agent('inspector')]),
    { phase: 'review', tag: null, alert: false })
})

test('rule 1 and 2 ignore agents that are not working or are on another item', () => {
  const agents = [agent('inspector', { state: 'done' }), agent('cook', { item: 'other-item' }), agent('heavy', { state: 'failed' })]
  assert.equal(phaseOf(item(), [], agents).phase, 'todo')
})

test('rule 2: a working cook or heavy cook puts it in cooking', () => {
  assert.deepEqual(phaseOf(item(), [], [agent('cook')]), { phase: 'cooking', tag: null, alert: false })
  assert.deepEqual(phaseOf(item(), [], [agent('heavy')]), { phase: 'cooking', tag: null, alert: false })
})

test('rule 2: a cook back on an item that failed review is on its second pass', () => {
  const notes = [report(1, 'done'), verdict(2, 'FAIL', 2), report(3, 'done'), verdict(4, 'PASS')]
  assert.deepEqual(phaseOf(item(), notes, [agent('heavy')]), { phase: 'cooking', tag: 'second pass', alert: false })
})

test('rule 3: a blocked report newer than any verdict is rework, blocked', () => {
  assert.deepEqual(phaseOf(item(), [report(5, 'blocked')], []), { phase: 'rework', tag: 'blocked', alert: true })
  assert.deepEqual(phaseOf(item(), [verdict(4, 'FAIL', 1), report(5, 'blocked')], []), { phase: 'rework', tag: 'blocked', alert: true })
})

test('rule 4: a PASS verdict with no newer report is done', () => {
  assert.deepEqual(phaseOf(item({ status: 'in_review' }), [report(1, 'done'), verdict(2, 'PASS')], []), { phase: 'done', tag: null, alert: false })
})

test('rule 4: a FAIL verdict newer than the report is rework with the finding count', () => {
  const notes = (n) => [report(1, 'done'), verdict(2, 'FAIL', n)]
  assert.deepEqual(phaseOf(item(), notes(0), []), { phase: 'rework', tag: 'sent back', alert: true })
  assert.deepEqual(phaseOf(item(), notes(1), []), { phase: 'rework', tag: 'sent back · 1 finding', alert: true })
  assert.deepEqual(phaseOf(item(), notes(2), []), { phase: 'rework', tag: 'sent back · 2 findings', alert: true })
})

test('rule 4: a report and a verdict with the same time go to the verdict', () => {
  assert.deepEqual(phaseOf(item(), [report(3, 'done'), verdict(3, 'PASS')], []), { phase: 'done', tag: null, alert: false })
  assert.deepEqual(phaseOf(item(), [report(3, 'blocked'), verdict(3, 'FAIL', 1)], []), { phase: 'rework', tag: 'sent back · 1 finding', alert: true })
})

test('rule 4: a PASS verdict is stale once the plan sends the item round again', () => {
  const notes = [report(1, 'done'), verdict(2, 'PASS')]
  assert.deepEqual(phaseOf(item({ status: 'dispatched' }), notes, []), { phase: 'cooking', tag: null, alert: false })
  assert.deepEqual(phaseOf(item({ status: 'rework' }), notes, []), { phase: 'rework', tag: 'sent back', alert: true })
})

test('rule 4 uses the newest verdict, not the first one listed', () => {
  const notes = [verdict(9, 'PASS'), report(1, 'done'), verdict(2, 'FAIL', 3)]
  assert.equal(phaseOf(item(), notes, []).phase, 'done')
})

test('rule 5: a report with no verdict, or newer than the verdict, is in review', () => {
  assert.deepEqual(phaseOf(item({ status: 'dispatched' }), [report(1, 'done')], []), { phase: 'review', tag: null, alert: false })
  assert.deepEqual(phaseOf(item(), [report(1, 'done'), verdict(2, 'FAIL', 2), report(3, 'done')], []), { phase: 'review', tag: null, alert: false })
})

test('notes for other items are ignored', () => {
  assert.equal(phaseOf(item(), [report(1, 'blocked', { item: 'other-item' })], []).phase, 'todo')
})

test('rule 6: with nothing on disk the plan status decides', () => {
  const at = (status, heavy = false) => phaseOf(item({ status, heavy }), [], [])
  assert.deepEqual(at('done'), { phase: 'done', tag: null, alert: false })
  assert.deepEqual(at('blocked'), { phase: 'rework', tag: 'blocked', alert: true })
  assert.deepEqual(at('rework'), { phase: 'rework', tag: 'sent back', alert: true })
  assert.deepEqual(at('in_review'), { phase: 'review', tag: null, alert: false })
  assert.deepEqual(at('dispatched'), { phase: 'cooking', tag: null, alert: false })
  assert.deepEqual(at('todo'), { phase: 'todo', tag: null, alert: false })
  assert.deepEqual(at('something-else'), { phase: 'todo', tag: null, alert: false })
  assert.deepEqual(at('todo', true), { phase: 'todo', tag: 'heavy', alert: false })
  assert.deepEqual(at('dispatched', true), { phase: 'cooking', tag: null, alert: false })
})

test('workCards makes one card per item titled by the first sentence of its goal', () => {
  const items = [
    item({ slug: 'token-bucket', status: 'done', goal: 'Count calls per customer. Then refill.' }),
    item({ slug: 'limit-headers', status: 'todo', heavy: true, goal: '' }),
    item({ slug: 'usage-docs', status: 'todo', goal: 'Write the usage docs for v1.2 users' }),
  ]
  assert.deepEqual(workCards(items, [], []), [
    { id: 'token-bucket', title: 'Count calls per customer.', phase: 'done', tag: null, alert: false },
    { id: 'limit-headers', title: 'limit-headers', phase: 'todo', tag: 'heavy', alert: false },
    { id: 'usage-docs', title: 'Write the usage docs for v1.2 users', phase: 'todo', tag: null, alert: false },
  ])
  assert.deepEqual(workCards(null, null, null), [])
})

test('a card title is at most 160 characters, cut with an ellipsis', () => {
  const endless = 'count calls per customer '.repeat(40).slice(0, 1_000)
  const [card] = workCards([item({ goal: endless })], [], [])
  assert.equal(card.title.length, 160)
  assert.ok(card.title.endsWith('…'))
  assert.equal(card.title.slice(0, 159), endless.slice(0, 159))
  const late = workCards([item({ goal: `${'refill '.repeat(50)}the bucket. Then more.` })], [], [])[0]
  assert.equal(late.title.length, 160)
  assert.ok(late.title.endsWith('…'))
  const exact = 'x'.repeat(159) + '.'
  assert.equal(workCards([item({ goal: exact })], [], [])[0].title, exact)
  const [ticket] = ticketCards([{ id: 'ACME-9', title: 'y'.repeat(5_000), status: 'todo' }], () => 'todo')
  assert.equal(ticket.title.length, 160)
  assert.ok(ticket.title.endsWith('…'))
})

test('ticketCards puts each board status in its lane', () => {
  const laneOf = (s) => ({ scoping: 'backlog', backlog: 'backlog', todo: 'todo', in_progress: 'in_progress', in_review: 'in_review', blocked: 'blocked', done: 'done' })[s] ?? 'backlog'
  const tickets = [
    { id: 'ACME-1', title: 'Plan it', status: 'scoping', kind: 'research' },
    { id: 'ACME-2', title: 'Next up', status: 'todo', kind: '' },
    { id: 'ACME-3', title: 'Under way', status: 'in_progress', kind: 'feature' },
    { id: 'ACME-4', title: 'Being read', status: 'in_review', kind: 'bug' },
    { id: 'ACME-5', title: 'Stuck', status: 'blocked', kind: 'chore' },
    { id: 'ACME-6', title: 'Shipped', status: 'done', kind: 'docs' },
  ]
  assert.deepEqual(ticketCards(tickets, laneOf), [
    { id: 'ACME-1', title: 'Plan it', phase: 'todo', tag: 'research', alert: false },
    { id: 'ACME-2', title: 'Next up', phase: 'todo', tag: null, alert: false },
    { id: 'ACME-3', title: 'Under way', phase: 'cooking', tag: 'feature', alert: false },
    { id: 'ACME-4', title: 'Being read', phase: 'review', tag: 'bug', alert: false },
    { id: 'ACME-5', title: 'Stuck', phase: 'rework', tag: 'blocked', alert: true },
    { id: 'ACME-6', title: 'Shipped', phase: 'done', tag: 'docs', alert: false },
  ])
})

const card = (id, phase) => ({ id, title: id, phase, tag: null, alert: false })

test('toWorkLanes keeps plan order, shows done newest first, and caps each lane', () => {
  const cards = [
    card('t1', 'todo'), card('d1', 'done'), card('t2', 'todo'), card('t3', 'todo'), card('t4', 'todo'),
    card('t5', 'todo'), card('d2', 'done'), card('d3', 'done'), card('c1', 'cooking'),
  ]
  const lanes = toWorkLanes(cards)
  assert.deepEqual(lanes.map((l) => [l.key, l.title, l.total]), [
    ['todo', 'To do', 5], ['cooking', 'Cooking', 1], ['review', 'In review', 0], ['rework', 'Rework', 0], ['done', 'Done', 3],
  ])
  assert.deepEqual(lanes[0].cards.map((c) => c.id), ['t1', 't2', 't3', 't4'])
  assert.deepEqual(lanes[4].cards.map((c) => c.id), ['d3', 'd2'])
  assert.deepEqual(lanes[1].cards, [card('c1', 'cooking')])
})

test('toWorkLanes puts pinned cards first and shows them past the cap', () => {
  const cards = [card('t1', 'todo'), card('t2', 'todo'), card('t3', 'todo'), card('d1', 'done'), card('d2', 'done'), card('d3', 'done')]
  const lanes = toWorkLanes(cards, ['t3', 'd1'], { default: 2, done: 1 })
  assert.deepEqual(lanes[0].cards.map((c) => c.id), ['t3', 't1'])
  assert.deepEqual(lanes[4].cards.map((c) => c.id), ['d1'])
  assert.equal(lanes[4].total, 3)
})

test('five pinned cards all show at cap 1, and total stays right', () => {
  const cards = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => card(id, 'cooking'))
  const lanes = toWorkLanes(cards, ['g', 'b', 'c', 'e', 'f'], { default: 1 })
  assert.deepEqual(lanes[1].cards.map((c) => c.id), ['b', 'c', 'e', 'f', 'g'])
  assert.equal(lanes[1].total, 7)
})

test('toWorkLanes reads only its own cap keys', () => {
  const caps = Object.create({ todo: 0 })
  caps.default = 1
  const lanes = toWorkLanes([card('t1', 'todo'), card('t2', 'todo')], [], caps)
  assert.deepEqual(lanes[0].cards.map((c) => c.id), ['t1'])
  assert.deepEqual(toWorkLanes([card('x', 'nowhere')]).map((l) => l.total), [0, 0, 0, 0, 0])
})

const day = 86400000
const plans = [
  { dish: 'acme-old', mtimeMs: 1000, items: [{ slug: 'a', status: 'todo' }] },
  { dish: 'acme-new', mtimeMs: 5000, items: [{ slug: 'b', status: 'dispatched' }] },
  { dish: 'acme-finished', mtimeMs: 9000, items: [{ slug: 'c', status: 'done' }] },
]

test('pickDish follows the most recently started working agent whose dish has a plan', () => {
  const agents = [
    agent('cook', { dish: 'acme-old', startedAt: 100 }),
    agent('cook', { dish: 'acme-missing', startedAt: 900 }),
    agent('cook', { dish: 'acme-new', startedAt: 500, state: 'done' }),
    agent('planner', { dish: null, startedAt: 800 }),
  ]
  assert.equal(pickDish(plans, agents, 10000), 'acme-old')
  agents.push(agent('inspector', { dish: 'acme-finished', startedAt: 300 }))
  assert.equal(pickDish(plans, agents, 10000), 'acme-finished')
})

test('pickDish falls back to the newest recent plan with work left', () => {
  assert.equal(pickDish(plans, [], 10000), 'acme-new')
})

test('pickDish skips a stale plan and returns null when nothing is left', () => {
  assert.equal(pickDish(plans, [], 5000 + day + 1), null)
  assert.equal(pickDish(plans, [], 5000 + day), 'acme-new')
  assert.equal(pickDish([plans[2]], [], 9000), null)
  assert.equal(pickDish([], [], 0), null)
  assert.equal(pickDish(null, null, 0), null)
})

// Two dishes with work left: alpha's plan is old, beta's changed a minute before `now`.
const NOW = 1_000_000
const both = [
  { dish: 'alpha', mtimeMs: 0, items: [{ slug: 'a', status: 'todo' }] },
  { dish: 'beta', mtimeMs: NOW - 60_000, items: [{ slug: 'b', status: 'todo' }] },
]
const on = (id, dish, over) => agent('cook', { id, dish, ...over })

test('pickDish follows the working agent seen most recently, not the one started last', () => {
  const agents = [
    on('a1', 'alpha', { startedAt: 980_000, seenAt: 990_000 }),
    on('a2', 'beta', { startedAt: 970_000, seenAt: 999_000 }),
  ]
  assert.equal(pickDish(both, agents, NOW), 'beta')
})

test('pickDish passes over an agent quiet for more than ten minutes', () => {
  assert.equal(pickDish(both, [on('a1', 'alpha', { startedAt: 200_000, seenAt: 300_000 })], NOW), 'beta')
  assert.equal(pickDish(both, [on('a1', 'alpha', { startedAt: 300_000 })], NOW), 'beta')
  assert.equal(pickDish(both, [on('a1', 'alpha', { seenAt: 400_000 })], NOW), 'alpha')
  assert.equal(pickDish(both, [on('a1', 'alpha', { seenAt: 399_999 })], NOW), 'beta')
})

test('pickDish falls back to the start time for an agent never stamped', () => {
  assert.equal(pickDish(both, [on('a1', 'alpha', { startedAt: 995_000 })], NOW), 'alpha')
  const agents = [
    on('a1', 'alpha', { startedAt: 998_000 }),
    on('a2', 'beta', { startedAt: 990_000, seenAt: 997_000 }),
  ]
  assert.equal(pickDish(both, agents, NOW), 'alpha')
})

test('pickDish treats a seenAt that is not a finite number as missing', () => {
  for (const seenAt of ['999000', NaN, Infinity, null]) {
    assert.equal(pickDish(both, [on('a1', 'alpha', { startedAt: 995_000, seenAt })], NOW), 'alpha', String(seenAt))
    assert.equal(pickDish(both, [on('a1', 'alpha', { startedAt: 300_000, seenAt })], NOW), 'beta', String(seenAt))
  }
  const agents = [
    on('a1', 'alpha', { startedAt: 998_000, seenAt: 'later' }),
    on('a2', 'beta', { startedAt: 990_000, seenAt: 997_000 }),
  ]
  assert.equal(pickDish(both, agents, NOW), 'alpha')
})

test('pickDish uses ten minutes when quietMs is zero or not a number', () => {
  const agents = [on('a1', 'alpha', { seenAt: 900_000 })]
  assert.equal(pickDish(both, agents, NOW, day, 50_000), 'beta')
  for (const quietMs of [0, -1, NaN, '50000', null, undefined]) {
    assert.equal(pickDish(both, agents, NOW, day, quietMs), 'alpha', String(quietMs))
  }
})
