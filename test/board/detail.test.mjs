import test from 'node:test'
import assert from 'node:assert/strict'
import { projectOf, cardDetail, ticketDetail, agentDetail, messageDetail } from '../../hooks/board/lib/detail.mjs'
import { cellWidth } from '../../hooks/board/lib/canvas.mjs'

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

// Every detail the board can open has to fit the box: a short list of short, printable lines.
function assertSound(d, kind) {
  assert.equal(d.kind, kind)
  assert.equal(typeof d.id, 'string')
  assert.equal(typeof d.title, 'string')
  assert.ok(d.title.length <= 200)
  assert.ok(!CONTROL.test(d.title))
  assert.ok(Array.isArray(d.lines))
  assert.ok(d.lines.length <= 40, `${d.lines.length} lines`)
  for (const line of d.lines) {
    assert.equal(typeof line, 'string')
    assert.ok(line.length <= 200, `line of ${line.length}`)
    assert.ok(!CONTROL.test(line), `control character in ${JSON.stringify(line)}`)
  }
}

// projectOf

test('a dish project names the ticket, its kind, progress and effort', () => {
  const p = projectOf({
    mode: 'dish',
    repo: 'acme/widgets',
    plan: { ticket: 'ACME-42', branch: 'feat/token-bucket', tier: 'two-star', kind: 'chore' },
    ticket: { title: 'Rate limit the public API', kind: 'feature' },
    done: 2,
    total: 5,
  })
  assert.deepEqual(p, {
    mode: 'dish',
    repo: 'acme/widgets',
    branch: 'feat/token-bucket',
    title: 'Rate limit the public API',
    detail: 'ACME-42 · feature · 2 of 5 done · Effort: ★★',
  })
})

test('a dish project with no ticket falls back to the plan for its title and kind', () => {
  const p = projectOf({
    mode: 'dish',
    repo: 'acme/widgets',
    plan: { ticket: 'ACME-42', branch: null, tier: 'one-star', kind: 'bug' },
    ticket: null,
    done: 0,
    total: 3,
  })
  assert.deepEqual(p, {
    mode: 'dish',
    repo: 'acme/widgets',
    branch: null,
    title: 'ACME-42',
    detail: 'ACME-42 · bug · 0 of 3 done · Effort: ★',
  })
})

test('a dish project leaves out a missing tier', () => {
  const p = projectOf({
    mode: 'dish',
    repo: 'acme/widgets',
    plan: { ticket: 'ACME-7', branch: 'fix/retry', kind: 'bug' },
    ticket: { title: 'Retry on 503' },
    done: 1,
    total: 4,
  })
  assert.equal(p.detail, 'ACME-7 · bug · 1 of 4 done')
  assert.equal(p.branch, 'fix/retry')
})

// The same dish at a given tier, for the effort cases below.
function effortLine(tier) {
  return projectOf({
    mode: 'dish',
    repo: 'acme/widgets',
    plan: { ticket: 'acme-12', branch: 'feat/limits', tier, kind: 'feature' },
    ticket: null,
    done: 0,
    total: 2,
  }).detail
}

test('each service tier shows as one, two or three effort stars', () => {
  assert.equal(effortLine('three-star'), 'acme-12 · feature · 0 of 2 done · Effort: ★★★')
  assert.equal(effortLine('two-star'), 'acme-12 · feature · 0 of 2 done · Effort: ★★')
  assert.equal(effortLine('one-star'), 'acme-12 · feature · 0 of 2 done · Effort: ★')
})

test('an unknown or mistyped tier shows no effort at all', () => {
  for (const tier of ['gold', 'standard', 'Three-Star', ' two-star', 'toString', '', 3, null, undefined, {}]) {
    assert.equal(effortLine(tier), 'acme-12 · feature · 0 of 2 done', `tier ${JSON.stringify(tier)}`)
  }
})

test('an effort star takes one cell, so the header columns stay put', () => {
  assert.equal(cellWidth('★'), 1)
  assert.equal(cellWidth('Effort: ★★★'), 11)
})

test('a ticket board counts its tickets, singular for one', () => {
  assert.deepEqual(projectOf({ mode: 'tickets', repo: 'acme/widgets', count: 7 }), {
    mode: 'tickets', repo: 'acme/widgets', branch: null, title: 'Ticket board', detail: '7 tickets',
  })
  assert.equal(projectOf({ mode: 'tickets', repo: 'acme/widgets', count: 1 }).detail, '1 ticket')
  assert.equal(projectOf({ mode: 'tickets', repo: 'acme/widgets', count: 0 }).detail, '0 tickets')
})

test('projectOf survives empty and mistyped input', () => {
  assert.deepEqual(projectOf({}), { mode: 'tickets', repo: '', branch: null, title: 'Ticket board', detail: '0 tickets' })
  assert.deepEqual(projectOf(undefined), projectOf({}))
  assert.deepEqual(projectOf({ mode: 'tickets', count: 'lots' }).detail, '0 tickets')
  const dish = projectOf({ mode: 'dish', plan: {}, ticket: {} })
  assert.deepEqual(dish, { mode: 'dish', repo: '', branch: null, title: 'Untitled', detail: '' })
  const weird = projectOf({ mode: 'dish', repo: 42, plan: 'nope', ticket: 'nope', done: 'x', total: {} })
  assert.equal(weird.mode, 'dish')
  assert.equal(weird.repo, '42')
  assert.equal(weird.detail, '')
})

test('projectOf cleans outside text', () => {
  const p = projectOf({
    mode: 'dish',
    repo: 'acme\x1b[31m/widgets',
    plan: { ticket: 'ACME-1', branch: 'a\nb' },
    ticket: { title: 'x'.repeat(500) },
    done: 0,
    total: 1,
  })
  assert.equal(p.repo, 'acme [31m/widgets')
  assert.equal(p.branch, 'a b')
  assert.equal(p.title.length, 200)
})

// cardDetail

const fullCard = {
  item: {
    slug: 'token-bucket',
    goal: 'Add a token bucket in front of the public API.',
    files: ['src/limit.ts', 'src/limit.test.ts'],
    dependsOn: ['config-keys', 'clock'],
    attempts: 2,
  },
  phaseTitle: 'Rework',
  report: { kind: 'report', gist: 'done', attempt: 2 },
  verdict: { kind: 'verdict', gist: 'FAIL', attempt: 2 },
  findings: [
    { id: 'F1', severity: 'Blocking', summary: 'Refill uses wall-clock time' },
    { id: 'F2', severity: 'high', summary: 'No test for a burst at the limit' },
  ],
  agents: [
    { name: 'Pip', role: 'cook', activity: 'editing src/limit.ts', state: 'working' },
    { name: 'Wren', role: 'inspector', activity: null, state: 'done' },
  ],
}

test('a work item detail lists its goal, files, history and crew', () => {
  const d = cardDetail(fullCard)
  assertSound(d, 'card')
  assert.equal(d.id, 'token-bucket')
  assert.equal(d.title, 'token-bucket · Rework')
  assert.deepEqual(d.lines, [
    'Add a token bucket in front of the public API.',
    'Files: src/limit.ts, src/limit.test.ts',
    'Depends on: config-keys, clock',
    'Attempts: 2',
    'Cook report: done, attempt 2',
    'Review: FAIL, attempt 2',
    'F1 (blocking) Refill uses wall-clock time',
    'F2 (high) No test for a burst at the limit',
    'Working it: Pip · cook · editing src/limit.ts',
    'Working it: Wren · inspector · done',
  ])
})

test('a work item with nine files shows six and counts the rest', () => {
  const files = Array.from({ length: 9 }, (_, i) => `src/f${i + 1}.ts`)
  const d = cardDetail({ item: { slug: 'big', goal: 'g', files, attempts: 0 }, phaseTitle: 'To do' })
  assert.deepEqual(d.lines, [
    'g',
    'Files: src/f1.ts, src/f2.ts, src/f3.ts, src/f4.ts, src/f5.ts, src/f6.ts, +3 more',
    'Attempts: 0',
  ])
})

test('a fresh work item has no report, review or crew lines', () => {
  const d = cardDetail({ item: { slug: 'clock', goal: '', files: [], dependsOn: [], attempts: 0 }, phaseTitle: 'To do' })
  assert.deepEqual(d.lines, ['No description.', 'Attempts: 0'])
})

test('findings only show under a review', () => {
  const d = cardDetail({ ...fullCard, verdict: null })
  assert.ok(!d.lines.some((l) => l.startsWith('F1')))
  assert.ok(!d.lines.some((l) => l.startsWith('Review:')))
})

test('cardDetail survives empty input', () => {
  for (const input of [{}, undefined, { item: {}, report: {}, verdict: {}, findings: [{}], agents: [{}] }]) {
    const d = cardDetail(input)
    assertSound(d, 'card')
    assert.equal(d.id, '')
    assert.equal(d.title, 'Work item')
    assert.equal(d.lines[0], 'No description.')
    assert.ok(d.lines.includes('Attempts: 0'))
  }
  const d = cardDetail({ item: {}, report: {}, verdict: {}, findings: [{}], agents: [{}] })
  assert.deepEqual(d.lines, ['No description.', 'Attempts: 0', 'Cook report: filed', 'Review: filed'])
})

// ticketDetail

test('a ticket detail shows its title, kind, assignee and goal', () => {
  const d = ticketDetail({
    ticket: { id: 'ACME-42', title: 'Rate limit the public API', status: 'In progress', kind: 'feature', assignee: 'alex' },
    goal: 'Stop one client from starving the rest.',
  })
  assertSound(d, 'card')
  assert.equal(d.id, 'ACME-42')
  assert.equal(d.title, 'ACME-42 · In progress')
  assert.deepEqual(d.lines, [
    'Rate limit the public API',
    'Kind: feature',
    'Assignee: alex',
    'Stop one client from starving the rest.',
  ])
})

test('a ticket detail leaves out what is not set', () => {
  const d = ticketDetail({ ticket: { id: 'ACME-9', title: 'Tidy logs', status: 'Todo', kind: null, assignee: '' }, goal: '' })
  assert.deepEqual(d.lines, ['Tidy logs'])
})

test('ticketDetail survives empty input', () => {
  for (const input of [{}, undefined, { ticket: {} }, { ticket: 'nope', goal: 7 }]) {
    const d = ticketDetail(input)
    assertSound(d, 'card')
    assert.equal(d.title, 'Ticket')
    assert.equal(d.lines[0], 'No title.')
  }
})

// agentDetail

const agent = {
  id: 'a1', name: 'Pip', role: 'cook', model: 'sonnet', state: 'working',
  dish: 'rate-limit', item: 'token-bucket', ticket: 'ACME-42', card: 'token-bucket',
  activity: 'running tests', tokens: 12400, startedAt: 1_000_000, endedAt: null,
}

test('a working agent shows its model, item, activity, tokens and running time', () => {
  const d = agentDetail({ agent, roleLabel: 'Cook', now: 1_000_000 + 125_000, memory: null })
  assertSound(d, 'agent')
  assert.equal(d.id, 'a1')
  assert.equal(d.title, 'Pip · Cook')
  assert.deepEqual(d.lines, [
    'Model: sonnet',
    'Working: token-bucket',
    'Now: running tests',
    'Tokens: 12k',
    'Running: 2m',
  ])
})

test('a finished agent stops its clock and shows its working memory', () => {
  const done = { ...agent, state: 'done', activity: null, item: null, endedAt: 1_000_000 + 40_000 }
  const memory = Array.from({ length: 10 }, (_, i) => `W${i + 1}. fact ${i + 1}`)
  const d = agentDetail({ agent: done, roleLabel: 'Cook', now: 9_999_999_999, memory })
  assert.deepEqual(d.lines, [
    'Model: sonnet',
    'Working: ACME-42',
    'Now: done',
    'Tokens: 12k',
    'Running: 40s',
    '',
    'Working memory',
    'W3. fact 3', 'W4. fact 4', 'W5. fact 5', 'W6. fact 6',
    'W7. fact 7', 'W8. fact 8', 'W9. fact 9', 'W10. fact 10',
  ])
})

test('an agent with empty memory gets no memory section', () => {
  const d = agentDetail({ agent, roleLabel: 'Cook', now: 1_000_000, memory: [] })
  assert.equal(d.lines.length, 5)
})

test('agentDetail survives empty input', () => {
  for (const input of [{}, undefined, { agent: {} }, { agent: { startedAt: null, endedAt: 'x' }, now: 'later', memory: 'no' }]) {
    const d = agentDetail(input)
    assertSound(d, 'agent')
    assert.equal(d.id, '')
    assert.equal(d.title, 'Agent')
    assert.deepEqual(d.lines, ['Model: unknown', 'Working: nothing yet', 'Now: unknown', 'Tokens: 0', 'Running: 0s'])
  }
})

test('an agent with no start time never shows a huge running time', () => {
  const d = agentDetail({ agent: { ...agent, startedAt: null }, roleLabel: 'Cook', now: 1_700_000_000_000 })
  assert.equal(d.lines[4], 'Running: 0s')
})

test('an agent without a role label falls back to its role', () => {
  assert.equal(agentDetail({ agent, now: 0 }).title, 'Pip · cook')
})

// messageDetail

const message = {
  id: 'm1', at: 1_000_000, from: 'Wren', to: 'Pip', item: 'token-bucket',
  text: 'FAIL: two findings', file: 'reports/token-bucket-verdict.md',
}

test('a message detail shows its text, item, file, findings and body', () => {
  const body = Array.from({ length: 30 }, (_, i) => `body line ${i + 1}`)
  const d = messageDetail({ message, findings: fullCard.findings, body })
  assertSound(d, 'message')
  assert.equal(d.id, 'm1')
  assert.equal(d.title, 'Wren → Pip')
  assert.deepEqual(d.lines, [
    'FAIL: two findings',
    'About: token-bucket',
    'From file: reports/token-bucket-verdict.md',
    'F1 (blocking) Refill uses wall-clock time',
    'F2 (high) No test for a burst at the limit',
    '',
    ...body.slice(0, 12),
  ])
})

test('a bare message is just its text', () => {
  const d = messageDetail({ message: { ...message, item: '', file: null }, findings: [], body: [] })
  assert.deepEqual(d.lines, ['FAIL: two findings'])
})

test('messageDetail survives empty input', () => {
  for (const input of [{}, undefined, { message: {}, findings: [{}], body: [{}] }, { message: 'x', findings: 'y', body: 'z' }]) {
    const d = messageDetail(input)
    assertSound(d, 'message')
    assert.equal(d.id, '')
    assert.equal(d.title, '? → ?')
    assert.deepEqual(d.lines, ['No text.'])
  }
})

// Hostile text

test('hostile text still gives at most 40 clean lines of at most 200 characters', () => {
  const nasty = 'line one\nline two \x1b[2J\x07 end'
  const findings = Array.from({ length: 100 }, (_, i) => ({ id: `F${i + 1}`, severity: 'blocking', summary: nasty }))
  const goal = 'g'.repeat(5000)

  const card = cardDetail({ ...fullCard, item: { ...fullCard.item, goal }, findings })
  assertSound(card, 'card')
  assert.equal(card.lines.length, 40)
  assert.equal(card.lines[39], '…')
  assert.equal(card.lines[0], 'g'.repeat(200))
  assert.equal(card.lines[6], 'F1 (blocking) line one line two  [2J  end')

  const msg = messageDetail({ message: { ...message, text: goal }, findings, body: [nasty] })
  assertSound(msg, 'message')
  assert.equal(msg.lines.length, 40)
  assert.equal(msg.lines[39], '…')

  const tick = ticketDetail({ ticket: { id: nasty, title: nasty, status: nasty }, goal })
  assertSound(tick, 'card')

  const ag = agentDetail({ agent: { ...agent, name: nasty, activity: goal }, roleLabel: nasty, now: 0, memory: findings.map((f) => f.summary) })
  assertSound(ag, 'agent')
})

test('cutting a long line never splits a surrogate pair', () => {
  const d = ticketDetail({ ticket: { id: 'T', title: 'a' + '\u{1F600}'.repeat(150) } })
  const line = d.lines[0]
  assert.ok(line.length <= 200)
  assert.ok(!/[\ud800-\udbff]$/.test(line))
})
