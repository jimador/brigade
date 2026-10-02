// Checks one painted frame of the task board cell by cell: the header and its context meter, the
// lanes and their cards, the sprites on top of them, the crew, the two panels, the legend, the
// hover card and the detail box. Widths and control characters are measured with this file's own
// helpers, never the canvas module's, so a bug there can't hide a bug here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draw } from '../../hooks/board/lib/board-paint.mjs'
import { arrange } from '../../hooks/board/lib/board-layout.mjs'
import { PALETTE, FAMILIES, ROLES, SPRITES, sizeOf } from '../../hooks/board/lib/sprites.mjs'
import { cardLines } from '../../hooks/board/lib/stage.mjs'

// Wide characters (CJK, Hangul, fullwidth forms, emoji) take two cells, zero-width marks none.
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
const ZERO_WIDTH = /[̀-ͯ​-‏⁠﻿]/
const ZERO_WIDTH_ALL = new RegExp(ZERO_WIDTH.source, 'g')
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const CONTROL_ALL = new RegExp(CONTROL.source, 'g')
const SPRITE_CELLS = new Set(['█', '▀', '▄'])

function cellsOf(ch) {
  if (ZERO_WIDTH.test(ch)) return 0
  const cp = ch.codePointAt(0)
  return WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1
}

function cells(text) {
  let n = 0
  for (const ch of text) n += cellsOf(ch)
  return n
}

function safe(text) {
  return String(text ?? '').replace(ZERO_WIDTH_ALL, '').replace(CONTROL_ALL, ' ')
}

// The frame as a grid of cells. A wide character's second cell holds '' and the same style.
function grid(out) {
  return out.rows.map((row) => {
    const line = []
    for (const run of row) {
      for (const ch of run.text) {
        const style = { color: run.color, bg: run.backgroundColor, bold: run.bold }
        line.push({ ch, ...style })
        for (let i = 1; i < cellsOf(ch); i++) line.push({ ch: '', ...style })
      }
    }
    return line
  })
}

function rowText(row) {
  return row.map((r) => r.text).join('')
}

function allText(out) {
  return out.rows.map(rowText).join('\n')
}

// Where `needle` (narrow characters only) first starts in the grid, in cells, or null.
function find(g, needle, fromY = 0) {
  const chars = Array.from(needle)
  for (let y = fromY; y < g.length; y++) {
    for (let x = 0; x + chars.length <= g[y].length; x++) {
      if (chars.every((ch, i) => g[y][x + i].ch === ch)) return { x, y }
    }
  }
  return null
}

function findAll(g, needle) {
  const chars = Array.from(needle)
  const out = []
  for (let y = 0; y < g.length; y++) {
    for (let x = 0; x + chars.length <= g[y].length; x++) {
      if (chars.every((ch, i) => g[y][x + i].ch === ch)) out.push({ x, y })
    }
  }
  return out
}

function cellsAt(g, x, y, n) {
  return g[y].slice(x, x + n)
}

const VIEW = { positions: {}, frame: 0, hovered: null, over: null }

function card(id, title, extra = {}) {
  return { id, title, phase: 'todo', tag: null, alert: false, ...extra }
}

function agent(id, extra = {}) {
  return {
    id, name: 'Miso', role: 'cook', model: 'claude-sonnet-4-5', state: 'working', dish: 'token-bucket',
    item: id, ticket: null, card: null, activity: 'editing src/limit.ts', tokens: 42000,
    startedAt: 100000, endedAt: null, ...extra,
  }
}

function snapshot(over = {}) {
  return {
    project: { mode: 'dish', repo: 'storefront', branch: 'feat/rate-limit', title: 'Rate limit the public API', detail: 'token-bucket · 5 items · 2 cooking' },
    lanes: [
      { key: 'todo', title: 'To do', total: 3, cards: [card('docs-page', 'Document the limits')] },
      { key: 'cooking', title: 'Cooking', total: 2, cards: [card('token-bucket', 'Token bucket per key', { phase: 'cooking' }), card('retry-header', 'Send Retry-After', { phase: 'cooking' })] },
      { key: 'review', title: 'In review', total: 1, cards: [card('limit-config', 'Limits from config', { phase: 'review', tag: 'heavy' })] },
      { key: 'rework', title: 'Rework', total: 1, cards: [card('quota-store', 'Quota store', { phase: 'rework', tag: 'attempt 2', alert: true })] },
      { key: 'done', title: 'Done', total: 1, cards: [card('schema', 'Schema for limits', { phase: 'done' })] },
    ],
    agents: [
      agent('cook-1', { name: 'Miso', card: 'token-bucket', model: 'claude-sonnet-4-5' }),
      agent('heavy-1', { name: 'Basil', role: 'heavy', card: 'retry-header', model: 'claude-opus-4-5', activity: 'running tests' }),
      agent('insp-1', { name: 'Sage', role: 'inspector', card: 'limit-config', model: 'claude-haiku-4-5', activity: 'reading the diff' }),
      agent('plan-1', { name: 'Nori', role: 'planner', card: null, model: 'claude-fable-1', activity: 'watching the board' }),
    ],
    weather: { level: 2, label: 'SHOWERS', glyph: '☂', percent: 61 },
    messages: [
      { id: 'm1', at: 1000, from: 'Sage', to: 'Miso', item: 'token-bucket', text: 'Two findings, both small', file: null },
      { id: 'm2', at: 900, from: 'Basil', to: 'planner', item: 'retry-header', text: 'Blocked on the header name', file: null },
    ],
    learnings: { total: 3, lines: ['Run the bundle check before pushing', 'Keep fixtures invented'] },
    detail: null,
    now: 400000,
    ...over,
  }
}

function frame(snap, view = {}, columns = 124) {
  return draw(snap, { ...VIEW, ...view }, columns)
}

function region(out, kind, id) {
  return out.regions.find((r) => r.kind === kind && r.id === id)
}

test('returns rows, regions and a height that matches the row count', () => {
  const out = frame(snapshot())
  const L = arrange(snapshot(), 124)
  assert.equal(out.height, out.rows.length)
  assert.equal(out.height, L.rows)
  for (const row of out.rows) assert.equal(cells(rowText(row)), 124)
  for (const run of out.rows[0]) assert.deepEqual(Object.keys(run).sort(), ['backgroundColor', 'bold', 'color', 'text'])
})

test('draws something sensible from an empty or broken snapshot', () => {
  for (const snap of [null, undefined, {}, { lanes: 'nope', agents: 7 }]) {
    const out = draw(snap, null, 80)
    assert.equal(out.height, out.rows.length)
    for (const row of out.rows) assert.equal(cells(rowText(row)), 80)
    assert.ok(allText(out).includes('Context --'))
  }
})

test('the header shows the project on three rows', () => {
  const g = grid(frame(snapshot()))
  const repo = find(g, 'storefront · feat/rate-limit')
  assert.deepEqual(repo, { x: 0, y: 0 })
  assert.equal(g[0][0].color, PALETTE.dim)
  assert.deepEqual(find(g, 'Rate limit the public API'), { x: 0, y: 1 })
  assert.equal(g[1][0].color, PALETTE.ink)
  assert.equal(g[1][0].bold, true)
  assert.deepEqual(find(g, 'token-bucket · 5 items'), { x: 0, y: 2 })
  assert.equal(g[2][0].color, PALETTE.dim)
})

test('the context meter shows the percent and a ten-cell gauge in three colour bands', () => {
  const L = arrange(snapshot(), 124)
  const tx = L.header.meter.text.x
  const bands = [[0, PALETTE.header], [49, PALETTE.header], [50, PALETTE.bolt], [61, PALETTE.bolt], [74, PALETTE.bolt], [75, PALETTE.alert], [100, PALETTE.alert]]
  for (const [percent, color] of bands) {
    const g = grid(frame(snapshot({ weather: { level: 2, label: 'SHOWERS', glyph: '☂', percent } })))
    const label = `Context ${percent}%`
    assert.deepEqual(find(g, label), { x: tx, y: 0 }, `percent ${percent}`)
    const digits = cellsAt(g, tx + 'Context '.length, 0, String(percent).length + 1)
    for (const c of digits) assert.equal(c.color, color, `percent ${percent} digits`)
    const bar = cellsAt(g, tx, 1, 10)
    const filled = Math.round(percent / 10)
    assert.equal(bar.map((c) => c.ch).join(''), '▰'.repeat(filled) + '▱'.repeat(10 - filled), `percent ${percent} gauge`)
    for (const c of bar) assert.equal(c.color, color, `percent ${percent} gauge colour`)
  }
})

test('the meter says Context -- in dim with no gauge when there is no reading', () => {
  const L = arrange(snapshot(), 124)
  const tx = L.header.meter.text.x
  for (const weather of [null, { level: 0, label: 'NO READING', glyph: '·', percent: null }]) {
    const g = grid(frame(snapshot({ weather })))
    assert.deepEqual(find(g, 'Context --'), { x: tx, y: 0 })
    for (const c of cellsAt(g, tx, 0, 10)) assert.equal(c.color, PALETTE.dim)
    const row1 = cellsAt(g, tx, 1, 12).map((c) => c.ch).join('')
    assert.ok(!/[▰▱]/.test(row1), `no gauge expected, got ${row1}`)
  }
})

test('the board says Context and never names the weather', () => {
  for (const label of ['CLEAR', 'CLOUDY', 'SHOWERS', 'STORM']) {
    for (const columns of [124, 60, 30]) {
      const text = allText(frame(snapshot({ weather: { level: 3, label, glyph: '☇', percent: 80 } }), {}, columns))
      assert.ok(text.includes('Context'))
      for (const word of ['CLEAR', 'CLOUDY', 'SHOWERS', 'STORM']) assert.ok(!text.includes(word), `${word} drawn at ${columns}`)
    }
  }
})

test('the cloud is drawn cell by cell, lightning under the cloud base in one cell', () => {
  const L = arrange(snapshot(), 124)
  const ix = L.header.meter.icon.x
  const g = grid(frame(snapshot()))
  // Column 0: nothing lit on row 0, cloud on top only on row 1.
  assert.equal(g[0][ix].ch, ' ')
  assert.deepEqual([g[1][ix].ch, g[1][ix].color, g[1][ix].bg], ['▀', PALETTE.ink, PALETTE.field])
  // Column 1: only the lower pixel lit on row 0.
  assert.deepEqual([g[0][ix + 1].ch, g[0][ix + 1].color, g[0][ix + 1].bg], ['▄', PALETTE.ink, PALETTE.field])
  // Column 2: both lit on row 0; cloud over lightning on row 1.
  assert.deepEqual([g[0][ix + 2].ch, g[0][ix + 2].color], ['█', PALETTE.ink])
  assert.deepEqual([g[1][ix + 2].ch, g[1][ix + 2].color, g[1][ix + 2].bg], ['▀', PALETTE.ink, PALETTE.bolt])
  // No cloud when the pane is too narrow for it.
  const narrow = arrange(snapshot(), 30)
  assert.equal(narrow.header.meter.icon, null)
})

test('lane headers show title and total, Rework in alert when it has cards, and +N more in dim', () => {
  const g = grid(frame(snapshot()))
  const L = arrange(snapshot(), 124)
  const todo = L.lanes[0]
  assert.deepEqual(find(g, 'To do 3'), { x: todo.x, y: todo.y })
  assert.equal(g[todo.y][todo.x].color, PALETTE.header)
  const rework = L.lanes[3]
  assert.deepEqual(find(g, 'Rework 1'), { x: rework.x, y: rework.y })
  assert.equal(g[rework.y][rework.x].color, PALETTE.alert)
  const more = find(g, '+2 more')
  assert.ok(more, '+2 more drawn')
  assert.equal(more.x, todo.x)
  assert.equal(g[more.y][more.x].color, PALETTE.dim)

  const quiet = snapshot()
  quiet.lanes[3] = { key: 'rework', title: 'Rework', total: 0, cards: [] }
  const q = grid(frame(quiet))
  const at = find(q, 'Rework 0')
  assert.equal(q[at.y][at.x].color, PALETTE.header)
})

test('card borders are rounded: cardEdge plain, alert when the card is alert, ink when the pointer is over it', () => {
  const L = arrange(snapshot(), 124)
  const cards = Object.fromEntries(L.lanes.flatMap((l) => l.cards).map((c) => [c.id, c]))
  const check = (g, c, color) => {
    assert.equal(g[c.y][c.x].ch, '╭')
    assert.equal(g[c.y][c.x + c.w - 1].ch, '╮')
    assert.equal(g[c.y + c.h - 1][c.x].ch, '╰')
    assert.equal(g[c.y + c.h - 1][c.x + c.w - 1].ch, '╯')
    assert.equal(g[c.y][c.x + 1].ch, '─')
    assert.equal(g[c.y + 1][c.x].ch, '│')
    for (const [x, y] of [[c.x, c.y], [c.x + 1, c.y], [c.x, c.y + 1], [c.x + c.w - 1, c.y + c.h - 1]]) {
      assert.equal(g[y][x].color, color, `${c.id} border at ${x},${y}`)
    }
  }
  const g = grid(frame(snapshot()))
  check(g, cards['docs-page'], PALETTE.cardEdge)
  check(g, cards['quota-store'], PALETTE.alert)
  const over = grid(frame(snapshot(), { over: 'docs-page' }))
  check(over, cards['docs-page'], PALETTE.ink)
  check(over, cards['schema'], PALETTE.cardEdge)
})

test('a card is filled with the card colour and its text keeps that background', () => {
  const L = arrange(snapshot(), 124)
  const c = L.lanes[0].cards.find((x) => x.id === 'docs-page')
  const g = grid(frame(snapshot()))
  for (let y = c.y + 1; y < c.y + c.h - 1; y++) {
    for (let x = c.x + 1; x < c.x + c.w - 1; x++) assert.equal(g[y][x].bg, PALETTE.card, `cell ${x},${y}`)
  }
  assert.deepEqual(find(g, 'docs-page'), { x: c.x + 1, y: c.y + 1 })
  assert.equal(g[c.y + 1][c.x + 1].color, PALETTE.dim)
  assert.deepEqual(find(g, 'Document the limits'), { x: c.x + 1, y: c.y + 2 })
  assert.equal(g[c.y + 2][c.x + 1].color, PALETTE.ink)
})

test('a tag is a pill: field-coloured text on dim, or on alert when the card is alert', () => {
  const g = grid(frame(snapshot()))
  const plain = find(g, 'heavy')
  for (const c of cellsAt(g, plain.x, plain.y, 5)) assert.deepEqual([c.color, c.bg], [PALETTE.field, PALETTE.dim])
  const alert = find(g, 'attempt 2')
  for (const c of cellsAt(g, alert.x, alert.y, 9)) assert.deepEqual([c.color, c.bg], [PALETTE.field, PALETTE.alert])
})

test('each slot shows its name in ink and its activity in dim; a hovered agent\'s name is bold', () => {
  const L = arrange(snapshot(), 124)
  const slot = L.lanes[1].cards[0].slots[0]
  const g = grid(frame(snapshot()))
  assert.deepEqual(find(g, slot.name.text), { x: slot.name.x, y: slot.name.y })
  assert.deepEqual([g[slot.name.y][slot.name.x].color, g[slot.name.y][slot.name.x].bold], [PALETTE.ink, false])
  assert.equal(g[slot.name.y][slot.name.x].bg, PALETTE.card)
  // Beside the 3-cell sprite on a 24-cell card the text has 22 - 3 - 1 = 18 cells.
  assert.equal(slot.activity.text, 'editing src/limit.')
  assert.deepEqual(find(g, slot.activity.text), { x: slot.activity.x, y: slot.activity.y })
  assert.equal(g[slot.activity.y][slot.activity.x].color, PALETTE.dim)
  const hovered = grid(frame(snapshot(), { hovered: 'cook-1' }))
  assert.equal(hovered[slot.name.y][slot.name.x].bold, true)
})

test('the crew stands under a dim Crew label with its own name and activity lines', () => {
  const L = arrange(snapshot(), 124)
  const g = grid(frame(snapshot()))
  assert.deepEqual(find(g, 'Crew'), { x: 0, y: L.crew.y })
  assert.equal(g[L.crew.y][0].color, PALETTE.dim)
  const slot = L.crew.slots[0]
  assert.deepEqual(find(g, slot.name.text), { x: slot.name.x, y: slot.name.y })
  assert.equal(g[slot.name.y][slot.name.x].color, PALETTE.ink)
  assert.deepEqual(find(g, 'watching the board'), { x: slot.activity.x, y: slot.activity.y })
})

// The sprite's lit cells inside its region, as [x, y, cell].
function spriteCells(g, r) {
  const out = []
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) if (g[y] && g[y][x] && SPRITE_CELLS.has(g[y][x].ch)) out.push([x, y, g[y][x]])
  }
  return out
}

test('sprites are coloured by model family, failed in alert and done in dim', () => {
  const colour = (key) => FAMILIES.find((f) => f.key === key).color
  const g = grid(frame(snapshot()))
  const out = frame(snapshot())
  for (const [id, key] of [['cook-1', 'sonnet'], ['heavy-1', 'opus'], ['insp-1', 'haiku'], ['plan-1', 'fable']]) {
    const lit = spriteCells(g, region(out, 'agent', id))
    // Every one-row sprite lights all three of its cells.
    assert.equal(lit.length, 3, `${id} drawn`)
    for (const [, , c] of lit) assert.equal(c.color, colour(key), id)
  }
  const snap = snapshot()
  snap.agents[0].state = 'failed'
  snap.agents[1].state = 'done'
  const out2 = frame(snap)
  const g2 = grid(out2)
  for (const [, , c] of spriteCells(g2, region(out2, 'agent', 'cook-1'))) assert.equal(c.color, PALETTE.alert)
  for (const [, , c] of spriteCells(g2, region(out2, 'agent', 'heavy-1'))) assert.equal(c.color, PALETTE.dim)
})

test('sprites take their size from the model and, while walking, their frame from the view', () => {
  const L = arrange(snapshot(), 124)
  const home = L.homes['heavy-1']
  // One cell to the right of home counts as walking, so the view's frame shows.
  const off = { positions: { 'heavy-1': { x: home.x + 1, y: home.y } } }
  const out0 = frame(snapshot(), off)
  const out1 = frame(snapshot(), { ...off, frame: 1 })
  const r = region(frame(snapshot()), 'agent', 'heavy-1')
  assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, home)
  assert.equal(r.w, SPRITES[sizeOf('claude-opus-4-5')][0][0].length)
  const walking = region(out0, 'agent', 'heavy-1')
  const shape = (out) => spriteCells(grid(out), walking).map(([x, y, c]) => `${x},${y},${c.ch}`).join(' ')
  assert.notEqual(shape(out0), shape(out1))
})

// The cells a one-row bitmap lights, as a string: the block character, or '.' for an unlit cell.
function bitmapRow(bitmap) {
  const [upper, lower] = bitmap
  return Array.from(upper, (ch, i) => {
    const top = ch === '#'
    const bottom = lower[i] === '#'
    return top && bottom ? '█' : top ? '▀' : bottom ? '▄' : '.'
  }).join('')
}

// The cells the grid shows inside a one-row region, in the same form.
function drawnRow(g, r) {
  return g[r.y].slice(r.x, r.x + r.w).map((c) => (SPRITE_CELLS.has(c.ch) ? c.ch : '.')).join('')
}

test('a sprite at its home stands still on frame 0, whatever frame the view asks for', () => {
  const L = arrange(snapshot(), 124)
  const home = L.homes['heavy-1']
  const bitmaps = SPRITES[sizeOf('claude-opus-4-5')]
  assert.notEqual(bitmapRow(bitmaps[0]), bitmapRow(bitmaps[1]))
  // At home given explicitly, and at home because it has no position at all.
  for (const positions of [{ 'heavy-1': { x: home.x, y: home.y } }, {}]) {
    for (const f of [0, 1]) {
      const out = frame(snapshot(), { positions, frame: f })
      const r = region(out, 'agent', 'heavy-1')
      assert.deepEqual({ x: r.x, y: r.y }, { x: home.x, y: home.y })
      assert.equal(drawnRow(grid(out), r), bitmapRow(bitmaps[0]), `frame ${f}`)
      assert.equal(r.frame, 0, `frame ${f}`)
    }
  }
})

test('a sprite one cell off its home walks: it draws the view\'s frame and its region says so', () => {
  const L = arrange(snapshot(), 124)
  const home = L.homes['heavy-1']
  const bitmaps = SPRITES[sizeOf('claude-opus-4-5')]
  for (const at of [{ x: home.x + 1, y: home.y }, { x: home.x, y: home.y - 1 }]) {
    for (const f of [0, 1]) {
      const out = frame(snapshot(), { positions: { 'heavy-1': at }, frame: f })
      const r = region(out, 'agent', 'heavy-1')
      assert.deepEqual({ x: r.x, y: r.y }, at)
      assert.equal(drawnRow(grid(out), r), bitmapRow(bitmaps[f]), `frame ${f}`)
      assert.equal(r.frame, f)
    }
  }
})

test('a settled board draws the same rows on either frame, and every agent region carries frame 0', () => {
  const still = frame(snapshot(), { frame: 0 })
  const flipped = frame(snapshot(), { frame: 1 })
  assert.deepEqual(flipped.rows, still.rows)
  const agents = flipped.regions.filter((r) => r.kind === 'agent')
  assert.equal(agents.length, 4)
  for (const r of agents) assert.equal(r.frame, 0, r.id)
})

test('a sprite mid-walk is drawn on top of the card under it, keeping the card background', () => {
  const L = arrange(snapshot(), 124)
  const docs = L.lanes[0].cards[0]
  const at = { x: docs.x + 2, y: docs.y + 1 }
  const out = frame(snapshot(), { positions: { 'cook-1': at } })
  const g = grid(out)
  const r = region(out, 'agent', 'cook-1')
  assert.deepEqual({ x: r.x, y: r.y }, at)
  const lit = spriteCells(g, r)
  assert.equal(lit.length, 3)
  const onCard = lit.filter(([x, y]) => y > docs.y && y < docs.y + docs.h - 1 && x > docs.x && x < docs.x + docs.w - 1)
  assert.ok(onCard.length > 0)
  for (const [, , c] of onCard) assert.deepEqual([c.color, c.bg], [FAMILIES[1].color, PALETTE.card])
  // The card's id under the sprite is gone where the sprite lit a cell.
  assert.equal(find(g, 'docs-page'), null)
})

test('a sprite whose position is off the left edge is clipped, not shifted', () => {
  const L = arrange(snapshot(), 124)
  const home = L.homes['cook-1']
  const out = frame(snapshot(), { positions: { 'cook-1': { x: -home.w + 2, y: home.y } } })
  const g = grid(out)
  for (const row of g) assert.equal(row.length, 124)
  const lit = spriteCells(g, { x: 0, y: home.y, w: 2, h: home.h })
  assert.ok(lit.length > 0)
})

test('agent regions sit after the cards and messages and before the detail box regions', () => {
  const plain = frame(snapshot())
  const kinds = plain.regions.map((r) => r.kind)
  const firstAgent = kinds.indexOf('agent')
  assert.ok(firstAgent > kinds.lastIndexOf('card') && firstAgent > kinds.lastIndexOf('message'))
  assert.deepEqual(kinds.slice(firstAgent), ['agent', 'agent', 'agent', 'agent'])

  const withBox = frame(snapshot({ detail: { kind: 'card', id: 'token-bucket', title: 'Token bucket per key', lines: ['Phase: cooking'] } }))
  const k2 = withBox.regions.map((r) => r.kind)
  assert.deepEqual(k2.slice(-7), ['agent', 'agent', 'agent', 'agent', 'close', 'modal', 'close'])
})

test('the legend writes Color: in dim and each family word in its own colour', () => {
  const L = arrange(snapshot(), 124)
  const g = grid(frame(snapshot()))
  const label = find(g, 'Color:')
  assert.deepEqual(label, { x: L.legend.x, y: L.legend.y })
  for (const c of cellsAt(g, label.x, label.y, 6)) assert.equal(c.color, PALETTE.dim)
  for (const family of FAMILIES) {
    const at = find(g, family.label, L.legend.y)
    assert.equal(at.y, L.legend.y)
    for (const c of cellsAt(g, at.x, at.y, family.label.length)) assert.equal(c.color, family.color, family.key)
  }
})

test('the panels have rounded borders with their titles set into the top edge', () => {
  const L = arrange(snapshot(), 124)
  const g = grid(frame(snapshot()))
  for (const [panel, title] of [[L.messages, 'Messages'], [L.learnings, 'Learnings in play']]) {
    assert.equal(g[panel.y][panel.x].ch, '╭')
    assert.equal(g[panel.y][panel.x].color, PALETTE.cardEdge)
    assert.equal(g[panel.y + panel.h - 1][panel.x + panel.w - 1].ch, '╯')
    const at = find(g, title, panel.y)
    assert.equal(at.y, panel.y)
    assert.equal(g[at.y][at.x].color, PALETTE.header)
  }
})

test('a message shows its head bold in ink and its text in dim, bold ink when pointed at', () => {
  const L = arrange(snapshot(), 124)
  const row = L.messages.rows[0]
  const g = grid(frame(snapshot()))
  const head = find(g, 'Sage → Miso')
  assert.equal(head.y, row.y)
  assert.deepEqual([g[head.y][head.x].color, g[head.y][head.x].bold], [PALETTE.ink, true])
  const text = find(g, 'Two findings, both small')
  assert.equal(text.y, row.y + 1)
  assert.deepEqual([g[text.y][text.x].color, g[text.y][text.x].bold], [PALETTE.dim, false])
  const over = grid(frame(snapshot(), { over: 'm1' }))
  assert.deepEqual([over[text.y][text.x].color, over[text.y][text.x].bold], [PALETTE.ink, true])
  const learning = find(g, 'Run the bundle check before pushing')
  assert.equal(g[learning.y][learning.x].color, PALETTE.ink)
  const more = find(g, '+1 more', L.learnings.y)
  assert.equal(g[more.y][more.x].color, PALETTE.dim)
})

test('empty panels say so in dim', () => {
  const g = grid(frame(snapshot({ messages: [], learnings: { total: 0, lines: [] } })))
  for (const words of ['No messages yet', 'None recorded']) {
    const at = find(g, words)
    assert.ok(at, `${words} drawn`)
    assert.equal(g[at.y][at.x].color, PALETTE.dim)
  }
})

test('the hover card shows the four lines on a light block without changing the row count', () => {
  for (const columns of [124, 60, 24]) {
    const snap = snapshot()
    const plain = frame(snap, {}, columns)
    for (const a of snap.agents) {
      const out = frame(snap, { hovered: a.id }, columns)
      assert.equal(out.rows.length, plain.rows.length)
      const g = grid(out)
      const role = ROLES[a.role]
      for (const line of cardLines(a, role.label, snap.now)) {
        const want = String(line).slice(0, columns - 2)
        // The name line also shows under the sprite, so look for the copy on the light block.
        const onCard = findAll(g, want).some((at) => g[at.y][at.x].color === PALETTE.field && g[at.y][at.x].bg === PALETTE.ink)
        assert.ok(onCard, `${a.id} at ${columns}: ${want}`)
      }
    }
  }
})

test('the detail box sits on top of everything with a double border, a bold title, [x] and its lines', () => {
  const detail = { kind: 'card', id: 'token-bucket', title: 'Token bucket per key', lines: ['Phase: cooking', 'Worked by Miso'] }
  const snap = snapshot({ detail })
  const L = arrange(snap, 124)
  const m = L.modal
  // A sprite walking under the box must not show through it.
  const out = frame(snap, { positions: { 'cook-1': { x: m.x + 2, y: m.y + 1 } }, hovered: 'cook-1' })
  const g = grid(out)
  assert.deepEqual([g[m.y][m.x].ch, g[m.y][m.x].color], ['╔', PALETTE.ink])
  assert.equal(g[m.y][m.x + 1].ch, '═')
  assert.equal(g[m.y + m.h - 1][m.x].ch, '╚')
  assert.equal(g[m.y + m.h - 1][m.x + m.w - 1].ch, '╝')
  assert.equal(g[m.y + 1][m.x].ch, '║')
  const title = find(g, 'Token bucket per key', m.y)
  assert.deepEqual(title, { x: m.x + 2, y: m.y + 1 })
  assert.deepEqual([g[title.y][title.x].color, g[title.y][title.x].bold, g[title.y][title.x].bg], [PALETTE.ink, true, PALETTE.card])
  const close = find(g, '[x]', m.y)
  assert.deepEqual(close, { x: m.x + m.w - 4, y: m.y })
  assert.equal(g[close.y][close.x].color, PALETTE.header)
  const line = find(g, 'Phase: cooking', m.y)
  assert.equal(g[line.y][line.x].color, PALETTE.ink)
  for (let y = m.y + 1; y < m.y + m.h - 1; y++) {
    for (let x = m.x + 1; x < m.x + m.w - 1; x++) {
      assert.equal(g[y][x].bg, PALETTE.card, `cell ${x},${y}`)
      assert.ok(!SPRITE_CELLS.has(g[y][x].ch), `sprite shows through at ${x},${y}`)
    }
  }
  const last = (x, y) => out.regions.findLast((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  assert.equal(last(close.x + 1, close.y).kind, 'close')
  assert.equal(last(m.x + 2, m.y + 1).kind, 'modal')
})

// Every text field of a snapshot set to `hostile`, ids included.
function hostileSnapshot(hostile, detail) {
  const snap = snapshot({ detail: detail ? { kind: 'card', id: hostile, title: hostile, lines: [hostile, `${hostile} ${hostile}`] } : null })
  snap.project = { mode: 'tickets', repo: hostile, branch: hostile, title: hostile, detail: hostile }
  snap.lanes = snap.lanes.map((lane, i) => ({
    ...lane,
    title: i === 0 ? hostile : lane.title,
    cards: [card(`${hostile}-${i}`, `${hostile} ${hostile}`, { tag: hostile, alert: i % 2 === 0 }), card(hostile, hostile)],
  }))
  snap.agents = snap.agents.map((a, i) => ({ ...a, id: `${hostile}-a${i}`, name: hostile, activity: hostile, item: hostile, card: i < 2 ? hostile : `${hostile}-${i}` }))
  snap.messages = [{ id: hostile, at: 1, from: hostile, to: hostile, item: hostile, text: hostile, file: null }]
  snap.learnings = { total: 9, lines: [hostile, hostile] }
  return snap
}

test('hostile outside text never breaks a row or reaches the terminal', () => {
  const HOSTILE = ['line\nbreak', 'wipe\u001b[2J', 'bell\u0007', 'csi\u009b1m', '日本語チケット', '🍜 ramen 🔥', 'café', 'zero​width', '日本\u0007語🔥\n\u009b']
  for (const hostile of HOSTILE) {
    for (const detail of [false, true]) {
      const snap = hostileSnapshot(hostile, detail)
      const ids = [null, ...Object.keys(arrange(snap, 80).homes)]
      for (const columns of [24, 37, 60, 124, 160]) {
        for (const hovered of ids) {
          const out = draw(snap, { positions: {}, frame: 1, hovered, over: safe(hostile) }, columns)
          assert.equal(out.height, out.rows.length)
          for (const [y, row] of out.rows.entries()) {
            assert.equal(cells(rowText(row)), columns, `${JSON.stringify(hostile)} at ${columns}, row ${y}`)
            for (const run of row) assert.ok(!CONTROL.test(run.text), `control character in ${JSON.stringify(run.text)}`)
          }
        }
      }
    }
  }
})
