// Checks a painted board frame: every row fills the pane exactly, the blocked lane shouts,
// sprites animate between frames, the hover card shows up only when asked, and an empty or
// unreadable board still draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paint } from '../../hooks/board/lib/paint.mjs'

function tickets(prefix, n, kind = 'feature') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, title: `${prefix} ${i + 1}`, status: prefix, kind }))
}

function lane(key, n, kind) {
  return { key, title: key.toUpperCase(), total: n, tickets: tickets(key, n, kind) }
}

const COOK_MODEL = 'claude-sonnet-4-5'
const SCOUT_MODEL = 'claude-haiku-4-5'

const SNAPSHOT = {
  lanes: [
    lane('todo', 3, 'docs'),
    lane('in_progress', 2),
    lane('in_review', 0),
    lane('blocked', 1, 'bug'),
    lane('in_test', 0),
    lane('done', 4, 'chore'),
  ],
  agents: [
    {
      id: 'cook-1', name: 'Basil', role: 'cook', model: COOK_MODEL, state: 'working',
      lane: 'in_progress', ticket: 'in_progress-1', item: 'board-paint', tokens: 12000, startedAt: 20000,
    },
    {
      id: 'scout-1', name: 'Sage', role: 'scout', model: SCOUT_MODEL, state: 'failed',
      lane: null, ticket: null, item: null, tokens: 800, startedAt: 10000, endedAt: 70000,
    },
  ],
  weather: { level: 2, label: 'SHOWERS', glyph: '☂', percent: 58 },
  selected: null,
  now: 200000,
}

const VIEW = { positions: {}, frame: 0, hovered: null }

function rowText(row) {
  return row.map((r) => r.text).join('')
}

function allText(out) {
  return out.rows.map(rowText).join('\n')
}

test('every row is exactly as wide as the pane', () => {
  for (const columns of [60, 30]) {
    for (const hovered of [null, 'cook-1', 'scout-1']) {
      const out = paint(SNAPSHOT, { ...VIEW, hovered }, columns)
      assert.equal(out.height, out.rows.length)
      for (const row of out.rows) assert.equal(Array.from(rowText(row)).length, columns)
    }
  }
})

test('row 0 carries the title and the weather reading', () => {
  const out = paint(SNAPSHOT, VIEW, 60)
  const top = rowText(out.rows[0])
  assert.ok(top.includes('BRIGADE'))
  assert.ok(top.includes('SHOWERS 58%'))
  // The reading ends one cell short of the right edge.
  assert.ok(top.endsWith('58% '))
  assert.ok(rowText(out.rows[1]).includes('▰'))
})

test('the blocked lane header turns alert red when it has tickets', () => {
  const out = paint(SNAPSHOT, VIEW, 60)
  const y = out.rows.findIndex((row) => rowText(row).startsWith('▌BLOCKED 1'))
  assert.ok(y > 1, 'blocked lane header row found')
  assert.ok(out.rows[y].some((r) => r.color === '#ff3b30'))
  const todo = out.rows.find((row) => rowText(row).startsWith('▌TODO 3'))
  assert.ok(!todo.some((r) => r.color === '#ff3b30'))
})

test('a chip being worked is bold, an idle one is not', () => {
  const out = paint(SNAPSHOT, VIEW, 60)
  const runs = out.rows.flat()
  assert.ok(runs.some((r) => r.text.startsWith('in_progress-1') && r.bold))
  assert.ok(runs.some((r) => r.text.startsWith('in_progress-2') && !r.bold))
})

test('frame 0 and frame 1 differ', () => {
  const a = paint(SNAPSHOT, { ...VIEW, frame: 0 }, 60)
  const b = paint(SNAPSHOT, { ...VIEW, frame: 1 }, 60)
  assert.notDeepEqual(a.rows, b.rows)
})

test('there is one region per agent, inside the canvas', () => {
  const out = paint(SNAPSHOT, VIEW, 60)
  assert.equal(out.regions.length, 2)
  assert.deepEqual(out.regions.map((r) => r.id), ['cook-1', 'scout-1'])
  for (const r of out.regions) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0)
    assert.ok(r.x + r.w <= 60 && r.y + r.h <= out.height)
  }
})

test('hovering an agent shows its card; no hover, no card', () => {
  const hovered = paint(SNAPSHOT, { ...VIEW, hovered: 'cook-1' }, 60)
  assert.ok(hovered.rows.some((row) => rowText(row).includes(COOK_MODEL)))
  assert.ok(hovered.rows.flat().some((r) => r.backgroundColor === '#e8e6d9' && r.text.includes(COOK_MODEL)))

  const plain = paint(SNAPSHOT, VIEW, 60)
  assert.ok(!allText(plain).includes(COOK_MODEL))
  assert.ok(!allText(plain).includes(SCOUT_MODEL))
})

test('the hover card stays inside a narrow pane', () => {
  const out = paint(SNAPSHOT, { ...VIEW, hovered: 'cook-1' }, 30)
  assert.ok(allText(out).includes(COOK_MODEL))
})

test('a position override moves the region', () => {
  const home = paint(SNAPSHOT, VIEW, 60).regions.find((r) => r.id === 'cook-1')
  const moved = paint(SNAPSHOT, { ...VIEW, positions: { 'cook-1': { x: home.x + 5, y: home.y } } }, 60)
  const r = moved.regions.find((x) => x.id === 'cook-1')
  assert.equal(r.x, home.x + 5)
  assert.equal(r.y, home.y)
})

test('the selected agent has a bold name tag', () => {
  const out = paint({ ...SNAPSHOT, selected: 'scout-1' }, VIEW, 60)
  assert.ok(out.rows.flat().some((r) => r.text.includes('Sage') && r.bold))
  const plain = paint(SNAPSHOT, VIEW, 60)
  assert.ok(!plain.rows.flat().some((r) => r.text.includes('Sage') && r.bold))
})

test('no weather reading says so on row 0', () => {
  const out = paint({ ...SNAPSHOT, weather: null }, VIEW, 60)
  assert.ok(rowText(out.rows[0]).includes('NO READING'))
  const noPercent = paint({ ...SNAPSHOT, weather: { level: 0, label: 'NO READING', glyph: '·', percent: null } }, VIEW, 60)
  assert.ok(rowText(noPercent.rows[0]).includes('NO READING'))
})

test('a storm at level 4 paints the reading in alert red', () => {
  const out = paint({ ...SNAPSHOT, weather: { level: 4, label: 'COMPACT SOON', glyph: '↯', percent: 95 } }, VIEW, 60)
  assert.ok(out.rows[0].some((r) => r.text.includes('COMPACT SOON') && r.color === '#ff3b30'))
})

test('an empty board still draws the heads-up rows', () => {
  const out = paint({ lanes: [], agents: [], weather: null, selected: null, now: 0 }, VIEW, 60)
  assert.ok(out.rows.length >= 2)
  assert.equal(out.height, out.rows.length)
  assert.deepEqual(out.regions, [])
  for (const row of out.rows) assert.equal(Array.from(rowText(row)).length, 60)
})
