// Checks a painted board frame: every row fills the pane exactly, the blocked lane shouts,
// sprites animate between frames, the hover card shows up only when asked, and an empty or
// unreadable board still draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paint } from '../../hooks/board/lib/paint.mjs'
import { cellWidth, clip } from '../../hooks/board/lib/canvas.mjs'
import { cardLines } from '../../hooks/board/lib/stage.mjs'
import { ROLES } from '../../hooks/board/lib/sprites.mjs'

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

// How many cells a painted row really takes on screen.
function rowCells(row) {
  return cellWidth(rowText(row))
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-fable']
const ROLE_KEYS = ['cook', 'scout', 'heavy', 'inspector']

function crowd(n, laneKey) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, name: `Cook${i}`, role: ROLE_KEYS[i % ROLE_KEYS.length], model: MODELS[i % MODELS.length],
    state: 'working', lane: laneKey, ticket: null, item: `item-${i}`, tokens: 1000 * i, startedAt: 0,
  }))
}

const BOARDS = {
  'zero lanes': { ...SNAPSHOT, lanes: [] },
  'six lanes': SNAPSHOT,
  'twelve agents in one lane': { ...SNAPSHOT, agents: crowd(12, 'in_progress') },
}

for (const [name, board] of Object.entries(BOARDS)) {
  for (const columns of [24, 40, 60, 120]) {
    test(`the hover card is whole for every agent on ${name} at ${columns} columns`, () => {
      const plain = paint(board, VIEW, columns)
      for (const agent of board.agents) {
        const out = paint(board, { ...VIEW, hovered: agent.id }, columns)
        assert.equal(out.height, plain.height, `hovering ${agent.id} changed the row count`)
        assert.equal(out.rows.length, plain.rows.length)
        for (const row of out.rows) assert.equal(rowCells(row), columns)

        const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
        const lines = cardLines(agent, role.label, board.now)
        const cardW = Math.max(...lines.map(cellWidth)) + 2
        // A card wider than the pane shows as much of each line as fits after its leading space.
        const want = lines.map((line) => ` ${columns >= cardW ? line : clip(line, columns - 1)}`)
        const texts = out.rows.map(rowText)
        const y0 = texts.findIndex((t, y) => t.includes(want[0]) && texts[y + 1]?.includes(want[1]))
        assert.ok(y0 >= 0, `card for ${agent.id} not found at ${columns} columns`)
        const at = cellWidth(texts[y0].slice(0, texts[y0].indexOf(want[0])))
        want.forEach((w, i) => {
          const t = texts[y0 + i] ?? ''
          const idx = t.indexOf(w)
          assert.ok(idx >= 0, `line ${i} of ${agent.id}'s card missing: ${JSON.stringify(w)}`)
          assert.equal(cellWidth(t.slice(0, idx)), at, `line ${i} of ${agent.id}'s card is out of line`)
        })
      }
    })
  }
}

test('odd ticket ids never break a row', () => {
  const ids = ['a\nb', 'x\u001b[2J', '日本語チケット番号', 'z'.repeat(60)]
  const todo = { key: 'todo', title: 'TODO', total: ids.length, tickets: ids.map((id) => ({ id, title: id, status: 'todo', kind: 'bug' })) }
  const agents = ids.map((ticket, i) => ({
    id: `o${i}`, name: `Odd${i}`, role: 'cook', model: COOK_MODEL, state: 'working',
    lane: 'todo', ticket, item: ticket, tokens: 10, startedAt: 0,
  }))
  const board = { ...SNAPSHOT, lanes: [todo, ...SNAPSHOT.lanes.slice(1)], agents }
  for (const columns of [24, 40, 60, 120]) {
    for (const hovered of [null, ...agents.map((a) => a.id)]) {
      const out = paint(board, { ...VIEW, hovered }, columns)
      for (const row of out.rows) {
        const text = rowText(row)
        assert.ok(!CONTROL.test(text), `control character in ${JSON.stringify(text)}`)
        assert.equal(rowCells(row), columns, `row ${JSON.stringify(text)} at ${columns} columns`)
      }
    }
  }
})

test('a chip is exactly its width in cells, whatever its id holds', () => {
  const ids = ['日本語チケット番号', 'a\u0301b\u0301c', 'z'.repeat(60)]
  const todo = { key: 'todo', title: 'TODO', total: ids.length, tickets: ids.map((id) => ({ id, title: id, status: 'todo', kind: 'bug' })) }
  const out = paint({ ...SNAPSHOT, lanes: [todo], agents: [] }, VIEW, 60)
  const labels = out.rows.flat().filter((r) => r.backgroundColor === '#e8e6d9' && r.text !== '▌')
  assert.deepEqual(labels.map((r) => r.text.trimEnd()), ['日本語チケッ', 'abc', 'z'.repeat(13)])
  for (const r of labels) assert.equal(cellWidth(r.text), 13, JSON.stringify(r.text))
})

test('the bench header carries no count', () => {
  const out = paint(SNAPSHOT, VIEW, 60)
  const bench = out.rows.map(rowText).find((t) => t.startsWith('▌BENCH'))
  assert.ok(bench, 'bench header found')
  assert.ok(/^▌BENCH\s*$/.test(bench), JSON.stringify(bench))
})
