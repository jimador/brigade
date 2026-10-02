// Checks where the task board puts everything. Most checks are properties over generated boards:
// cards, sprites and text never collide, nothing leaves the pane, every card the lanes carry gets
// a box, and every string fits the cells it was given. The rest pin down the exact geometry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrange } from '../../hooks/board/lib/board-layout.mjs'
import { SIZES, sizeOf } from '../../hooks/board/lib/sprites.mjs'
import { cellWidth, safeText } from '../../hooks/board/lib/canvas.mjs'

const PHASES = [['todo', 'To do'], ['cooking', 'Cooking'], ['review', 'In review'], ['rework', 'Rework'], ['done', 'Done']]
const WIDTHS = [24, 40, 60, 80, 100, 124, 160]
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const HOSTILE = ['a\nb', '\u001b[2J', '日本語チケット番号', 'x'.repeat(200), 'tab\there', 'zero​width']
const KEYS = ['columns', 'rows', 'header', 'lanes', 'crew', 'messages', 'learnings', 'legend', 'homes', 'obstacles', 'regions', 'modal']

function card(id, title = `Card ${id}`, extra = {}) {
  return { id, title, phase: 'todo', tag: null, alert: false, ...extra }
}

// Five lanes holding `counts[i]` cards each (or the same count in every lane).
function lanesOf(counts, make = (key, j) => card(`${key}-${j + 1}`)) {
  return PHASES.map(([key, title], i) => {
    const n = Array.isArray(counts) ? counts[i] : counts
    const cards = Array.from({ length: n }, (_, j) => make(key, j))
    return { key, title, total: n, cards }
  })
}

function agent(id, extra = {}) {
  return {
    id, name: 'Miso', role: 'cook', model: 'claude-sonnet-4', state: 'working', dish: 'token-bucket',
    item: null, ticket: null, card: null, activity: null, tokens: 0, startedAt: 0, endedAt: null, ...extra,
  }
}

function snapshot(over = {}) {
  return {
    project: { mode: 'dish', repo: 'storefront', branch: 'feat/x', title: 'Rate limit the public API', detail: 'token-bucket · 5 items' },
    lanes: lanesOf(1), agents: [], weather: null, messages: [], learnings: { total: 0, lines: [] }, detail: null, now: 0,
    ...over,
  }
}

// Two boxes overlap when they share a cell; w and h count cells.
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function within(box, outer) {
  return box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w && box.y + box.h <= outer.y + outer.h
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function textBox(line) {
  return { x: line.x, y: line.y, w: cellWidth(line.text), h: 1 }
}

function allSlots(L) {
  return [...L.lanes.flatMap((lane) => lane.cards.flatMap((c) => c.slots)), ...(L.crew ? L.crew.slots : [])]
}

function allCards(L) {
  return L.lanes.flatMap((lane) => lane.cards)
}

// The rows a lane takes: its header, its cards, and the `+N more` row.
function laneBox(lane) {
  const h = 1 + lane.cards.reduce((sum, c) => sum + c.h, 0) + (lane.more > 0 ? 1 : 0)
  return { x: lane.x, y: lane.y, w: lane.w, h }
}

// Every string in the layout, with where it was found: values and object keys alike, ids and the
// homes keys included, since ids come from files too.
function strings(value, path = '', out = []) {
  if (typeof value === 'string') out.push([path, value])
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push([`${path} key`, k])
      strings(v, `${path}.${k}`, out)
    }
  }
  return out
}

// The form an id takes on the board: its text made safe, the same way every other string is.
function idOf(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? safeText(String(value)) : ''
}

// Everything one slot takes up: its sprite and its two text lines.
function footprint(s) {
  const boxes = [s, textBox(s.name), textBox(s.activity)]
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}

// A small seeded generator, so a failing board can be rebuilt from its seed.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = ['Basil', 'Sage', 'Miso', 'Nori', 'Pepper 2', 'Tamarind', '日本語', 'a\nb', '\u001b[2J']
const ROLE_KEYS = ['planner', 'scout', 'cook', 'heavy', 'inspector', 'analyst', 'steward', 'agent', 'toString', 'mystery']
const MODELS = ['claude-haiku-4', 'claude-sonnet-4', 'claude-opus-4', 'claude-fable-1', null, 'gpt-x']
const ACTIVITIES = [null, 'running tests', 'editing bucket.ts', 'a very long activity line that goes on past any card', '日本語チケット番号', 'a\nb']
const STATES = ['working', 'working', 'done', 'failed']

function generate(seed, columns, perLane, agentCount, withModal) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const text = () => (r() < 0.3 ? pick(HOSTILE) : pick(['Add a token bucket', 'Wire the limiter into the API gateway and log every refusal', 'Docs']))
  // Ids come from files too, so some carry hostile text.
  const id = (plain) => (r() < 0.15 ? `${pick(HOSTILE)}-${plain}` : plain)
  const lanes = lanesOf(perLane, (key, j) => card(id(`${key}-${j + 1}`), text(), { tag: r() < 0.4 ? pick(['heavy', 'second pass', '日本語', 'a\nb']) : null, alert: r() < 0.2 }))
  // Lanes arrive capped: some say there are more cards than they show.
  for (const lane of lanes) if (r() < 0.4) lane.total += Math.floor(r() * 9)
  const ids = lanes.flatMap((l) => l.cards.map((c) => c.id))
  const agents = Array.from({ length: agentCount }, (_, i) => {
    // The first few crowd onto one card, the rest scatter: some on cards, some with none, some on a card that is gone.
    let where = null
    if (ids.length > 0) where = i < 3 ? ids[0] : r() < 0.5 ? pick(ids) : r() < 0.5 ? null : 'gone-card'
    return agent(id(`agent-${i}`), { name: pick(NAMES), role: pick(ROLE_KEYS), model: pick(MODELS), state: pick(STATES), activity: pick(ACTIVITIES), card: where })
  })
  const messages = Array.from({ length: Math.floor(r() * 7) }, (_, i) => ({
    id: id(`m${i}`), at: i, from: pick(NAMES), to: pick(NAMES), item: 'token-bucket', text: text(), file: null,
  }))
  const lineCount = Math.floor(r() * 8)
  const learnings = { total: lineCount + Math.floor(r() * 4), lines: Array.from({ length: lineCount }, text) }
  const detail = withModal
    ? { kind: 'card', id: ids[0] ?? 'nothing', title: text(), lines: Array.from({ length: Math.floor(r() * 40) }, text) }
    : null
  return snapshot({
    project: { mode: 'dish', repo: text(), branch: r() < 0.5 ? text() : null, title: text(), detail: text() },
    lanes, agents, messages, learnings, detail,
  })
}

// Every property the layout promises, computed from the snapshot it was given.
function check(L, snap, columns) {
  const where = `columns=${columns}`
  for (const key of KEYS) assert.ok(key in L, `${where}: missing ${key}`)
  const W = Math.max(24, Math.floor(columns))
  assert.equal(L.columns, W, where)
  const board = { x: 0, y: 0, w: L.columns, h: L.rows }
  const inBounds = (box, what) => {
    assert.ok(box.w >= 0 && box.h >= 0, `${where}: ${what} has a negative size`)
    assert.ok(within(box, board), `${where}: ${what} ${JSON.stringify(box)} is off the ${L.columns}x${L.rows} board`)
  }

  // Header: three clipped rows and the meter at the top right.
  const m = L.header.meter
  assert.equal(L.header.y, 0)
  assert.equal(m.y, 0)
  assert.equal(m.w, W < 40 ? 12 : 21)
  assert.equal(m.x + m.w, W)
  assert.equal(m.icon === null, W < 40)
  inBounds({ x: m.x, y: 0, w: m.w, h: 2 }, 'meter')
  for (const k of ['repo', 'title', 'detail']) assert.ok(cellWidth(L.header[k]) <= m.x - 2, `${where}: header ${k} runs into the meter`)

  // Lanes: every card the snapshot carries gets a box, in order, stacked under the lane header.
  const lanesIn = list(snap?.lanes).filter((l) => l && typeof l === 'object')
  assert.equal(L.lanes.length, lanesIn.length)
  L.lanes.forEach((lane, i) => {
    const src = lanesIn[i]
    assert.equal(lane.key, idOf(src.key))
    assert.deepEqual(lane.cards.map((c) => c.id), list(src.cards).filter(Boolean).map((c) => idOf(c.id)))
    assert.equal(lane.more, lane.total - lane.cards.length)
    assert.ok(lane.more >= 0)
    assert.ok(cellWidth(lane.title) <= lane.w)
    inBounds(laneBox(lane), `lane ${lane.key}`)
    let y = lane.y + 1
    for (const c of lane.cards) {
      assert.equal(c.y, y, `${where}: card ${c.id} is not stacked under the one above`)
      assert.equal(c.x, lane.x)
      assert.equal(c.w, lane.w)
      y += c.h
    }
  })
  const laneBoxes = L.lanes.map(laneBox)
  for (let i = 0; i < laneBoxes.length; i++) for (let j = i + 1; j < laneBoxes.length; j++) {
    assert.ok(!overlaps(laneBoxes[i], laneBoxes[j]), `${where}: lanes ${i} and ${j} overlap`)
  }

  // Cards: no two overlap, every string inside fits the inner width.
  const cards = allCards(L)
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    inBounds(c, `card ${c.id}`)
    assert.ok(c.h - 2 >= 2, `${where}: card ${c.id} is shorter than two inner rows`)
    assert.ok(cellWidth(c.idText) <= c.w - 2)
    assert.ok(c.titleLines.length <= 2)
    for (const line of c.titleLines) assert.ok(cellWidth(line) <= c.w - 2, `${where}: title line too wide`)
    if (c.tag !== null) assert.ok(cellWidth(c.tag) <= c.w - 2)
    for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(c, cards[j]), `${where}: cards ${c.id} and ${cards[j].id} overlap`)
    const inner = { x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2 }
    for (const s of c.slots) {
      assert.ok(within(s, inner), `${where}: sprite of ${s.agentId} leaves card ${c.id}`)
      assert.ok(within(textBox(s.name), inner), `${where}: name of ${s.agentId} leaves card ${c.id}`)
      assert.ok(within(textBox(s.activity), inner), `${where}: activity of ${s.agentId} leaves card ${c.id}`)
      // Slots sit below the id, title and tag rows.
      assert.ok(s.y >= c.y + 2 + c.titleLines.length + (c.tag !== null ? 1 : 0))
    }
  }

  // Agents: each distinct agent (told apart by the safe form of its id) has exactly one slot and one
  // home; on its card when that card is on the board (the first card with that id), else with the crew.
  const seen = new Set()
  const agents = list(snap?.agents).filter((a) => a && ['string', 'number'].includes(typeof a.id) && !seen.has(idOf(a.id)) && seen.add(idOf(a.id)))
  const firstCard = new Map()
  for (const c of cards) if (!firstCard.has(c.id)) firstCard.set(c.id, c)
  const slots = allSlots(L)
  assert.equal(slots.length, agents.length, `${where}: one slot per agent`)
  assert.deepEqual(Object.keys(L.homes).sort(), agents.map((a) => idOf(a.id)).sort())
  const crewIds = []
  for (const a of agents) {
    const id = idOf(a.id)
    const size = SIZES[sizeOf(a.model)]
    const host = a.card != null ? firstCard.get(idOf(a.card)) : undefined
    const slot = host ? host.slots.find((s) => s.agentId === id) : L.crew?.slots.find((s) => s.agentId === id)
    assert.ok(slot, `${where}: agent ${id} has no slot ${host ? `on card ${host.id}` : 'in the crew'}`)
    if (!host) crewIds.push(id)
    assert.equal(slot.w, size.w)
    assert.equal(slot.h, size.h)
    assert.deepEqual(L.homes[id], { x: slot.x, y: slot.y, w: slot.w, h: slot.h })
  }
  assert.equal(L.crew === null, crewIds.length === 0)

  // Crew: below every lane, inside the pane, slots start under the label.
  // With no lanes, the header's blank row 3 is the gap above whatever comes next.
  const lanesBottom = laneBoxes.length ? Math.max(...laneBoxes.map((b) => b.y + b.h)) : 3
  let above = lanesBottom
  if (L.crew) {
    assert.ok(L.crew.y >= lanesBottom + 1, `${where}: crew label is not below the lanes`)
    for (const s of L.crew.slots) {
      for (const box of [s, textBox(s.name), textBox(s.activity)]) {
        assert.ok(box.y > L.crew.y, `${where}: crew slot above its label`)
        inBounds(box, `crew ${s.agentId}`)
        above = Math.max(above, box.y + box.h)
      }
    }
    // Crew rows never touch: two slots either share a row or have a blank row between them.
    const feet = L.crew.slots.map(footprint)
    for (let i = 0; i < feet.length; i++) for (let j = i + 1; j < feet.length; j++) {
      const [a, b] = feet[i].y <= feet[j].y ? [feet[i], feet[j]] : [feet[j], feet[i]]
      assert.ok(b.y < a.y + a.h || b.y >= a.y + a.h + 1, `${where}: crew rows touch`)
    }
  }

  // Homes never overlap each other or any obstacle; every name and activity line is an obstacle and
  // no two text lines collide, so neither name is cut by another.
  const homes = Object.values(L.homes)
  for (const h of homes) inBounds(h, 'home')
  for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) {
    assert.ok(!overlaps(homes[i], homes[j]), `${where}: two homes overlap`)
  }
  for (const o of L.obstacles) {
    inBounds(o, 'obstacle')
    for (const h of homes) assert.ok(!overlaps(h, o), `${where}: a home overlaps an obstacle`)
  }
  const texts = slots.flatMap((s) => [textBox(s.name), textBox(s.activity)])
  for (const t of texts) assert.ok(L.obstacles.some((o) => o.x === t.x && o.y === t.y && o.w === t.w && o.h === 1), `${where}: text line missing from obstacles`)
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    assert.ok(!overlaps(texts[i], texts[j]), `${where}: two text lines collide`)
  }

  // Panels and legend: below every lane and the crew, after a blank row.
  const msgs = L.messages
  const lrn = L.learnings
  for (const p of [msgs, lrn]) {
    inBounds(p, 'panel')
    assert.ok(p.y >= above + 1, `${where}: a panel is not below the lanes and crew`)
    assert.ok(p.h >= 3)
  }
  if (W >= 70) {
    assert.equal(msgs.x, 0)
    assert.equal(msgs.w, Math.floor(W * 0.6))
    assert.equal(lrn.x, msgs.w + 1)
    assert.equal(lrn.x + lrn.w, W)
    assert.equal(msgs.y, lrn.y)
    assert.equal(msgs.h, lrn.h)
  } else {
    assert.equal(msgs.w, W)
    assert.equal(lrn.w, W)
    assert.ok(lrn.y >= msgs.y + msgs.h)
  }
  const msgIn = list(snap?.messages).filter((x) => x && typeof x === 'object')
  assert.equal(msgs.rows.length, Math.min(4, msgIn.length))
  msgs.rows.forEach((row, i) => {
    assert.equal(row.id, idOf(msgIn[i].id))
    assert.ok(row.y > msgs.y && row.y + 2 <= msgs.y + msgs.h - 1, `${where}: message rows leave the box`)
    assert.ok(cellWidth(row.head) <= msgs.w - 4 && cellWidth(row.text) <= msgs.w - 4)
  })
  const linesIn = list(snap?.learnings?.lines)
  assert.equal(lrn.lines.length, Math.min(5, linesIn.length))
  for (const line of lrn.lines) assert.ok(cellWidth(line) <= lrn.w - 4)
  assert.equal(lrn.more, Math.max(lrn.lines.length, snap?.learnings?.total ?? linesIn.length) - lrn.lines.length)
  // Each panel's own height: its border and two rows per message, or a row per learning and one for
  // +N more; an empty panel keeps one blank row. Side by side they share the taller of the two.
  const ownM = 2 + Math.max(1, msgs.rows.length * 2)
  const ownL = 2 + Math.max(1, lrn.lines.length + (lrn.more > 0 ? 1 : 0))
  if (W >= 70) assert.deepEqual([msgs.h, lrn.h], [Math.max(ownM, ownL), Math.max(ownM, ownL)])
  else assert.deepEqual([msgs.h, lrn.h], [ownM, ownL])

  const legend = L.legend
  assert.equal(legend.y, L.rows - 1)
  assert.equal(legend.x + cellWidth(legend.text), W, `${where}: legend is not right-aligned`)
  assert.ok(legend.x >= 0)
  assert.ok(legend.y >= Math.max(msgs.y + msgs.h, lrn.y + lrn.h), `${where}: legend is above a panel`)
  assert.deepEqual(legend.spans.map((s) => s.family), ['haiku', 'sonnet', 'opus', 'fable'])
  for (const s of legend.spans) assert.equal(legend.text.slice(s.x - legend.x, s.x - legend.x + s.w), s.family)

  // Regions: cards, then messages, then the modal's three.
  const want = [
    ...cards.map((c) => ({ kind: 'card', id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })),
    ...msgs.rows.map((row) => ({ kind: 'message', id: row.id, x: msgs.x + 1, y: row.y, w: msgs.w - 2, h: 2 })),
  ]
  if (snap?.detail) {
    const box = L.modal
    assert.ok(box, `${where}: detail set but no modal`)
    assert.ok(L.rows >= 12)
    assert.equal(box.w, Math.min(W - 4, 72))
    assert.equal(box.x, Math.floor((W - box.w) / 2))
    assert.equal(box.y, Math.floor((L.rows - box.h) / 2))
    assert.ok(box.h <= L.rows - 2)
    assert.equal(box.h, 4 + box.lines.length)
    assert.ok(cellWidth(box.title) <= box.w - 4)
    for (const line of box.lines) assert.ok(cellWidth(line) <= box.w - 4, `${where}: modal line too wide`)
    // Nothing is lost unless the box says so with a last line of '…'.
    const words = (xs) => xs.flatMap((x) => safeText(x).split(' ')).filter((w) => w !== '')
    if (box.lines.at(-1) !== '…') assert.equal(words(box.lines).join(''), words(snap.detail.lines).join(''))
    want.push(
      { kind: 'close', id: 'close', x: 0, y: 0, w: W, h: L.rows },
      { kind: 'modal', id: 'modal', x: box.x, y: box.y, w: box.w, h: box.h },
      { kind: 'close', id: 'close', x: box.x + box.w - 4, y: box.y, w: 3, h: 1 },
    )
  } else {
    assert.equal(L.modal, null)
  }
  assert.deepEqual(L.regions, want)
  for (const region of L.regions) inBounds(region, `${region.kind} region`)

  // No control character anywhere a string comes back.
  for (const [path, s] of strings(L)) assert.ok(!CONTROL.test(s), `${where}: control character at ${path}`)
}

test('the property sweep: widths, boards, agents and the modal', () => {
  let seed = 1
  let cases = 0
  for (const columns of WIDTHS) {
    for (const perLane of [0, 1, 7]) {
      for (const agentCount of [0, 1, 3, 7, 12]) {
        for (const withModal of [false, true]) {
          const snap = generate(seed, columns, perLane, agentCount, withModal)
          try {
            check(arrange(snap, columns), snap, columns)
          } catch (err) {
            err.message = `seed ${seed}, columns ${columns}, ${perLane} per lane, ${agentCount} agents, modal ${withModal}: ${err.message}`
            throw err
          }
          seed++
          cases++
        }
      }
    }
  }
  assert.equal(cases, 210)
})

test('the same input gives the same layout', () => {
  const snap = generate(7, 80, 7, 12, true)
  assert.deepEqual(arrange(snap, 80), arrange(structuredClone(snap), 80))
})

test('empty and broken snapshots still give a sound layout', () => {
  for (const [snap, columns] of [[null, 80], [{}, NaN], [undefined, undefined], [{ lanes: 'nope', agents: {}, messages: 5, learnings: null }, '80'], [{ lanes: [null, { key: 'todo', cards: [null] }] }, Infinity]]) {
    const L = arrange(snap, columns)
    check(L, snap && typeof snap === 'object' ? snap : null, Number.isFinite(columns) && typeof columns === 'number' ? columns : 24)
    assert.equal(L.crew, null)
    assert.equal(L.modal, null)
    assert.equal(L.messages.h, 3)
    assert.equal(L.learnings.h, 3)
  }
  assert.equal(arrange(null, 80).columns, 80)
  assert.equal(arrange({}, NaN).columns, 24)
  assert.equal(arrange({}, 10).columns, 24)
  assert.equal(arrange({}, 99.9).columns, 99)
  assert.equal(arrange({ lanes: [null, { key: 'todo', cards: [null] }] }, 80).lanes[0].cards.length, 0)
})

test('five lanes side by side at 124 columns', () => {
  const L = arrange(snapshot({ lanes: lanesOf(2) }), 124)
  assert.deepEqual(L.lanes.map((l) => l.x), [0, 25, 50, 75, 100])
  assert.deepEqual(L.lanes.map((l) => l.w), [24, 24, 24, 24, 24])
  assert.deepEqual(L.lanes.map((l) => l.y), [4, 4, 4, 4, 4])
  assert.deepEqual(L.lanes.map((l) => l.title), ['To do', 'Cooking', 'In review', 'Rework', 'Done'])
  assert.equal(L.lanes[0].cards[0].y, 5)
})

test('lanes wrap into bands at 60 and at 24 columns', () => {
  const lanes = lanesOf([3, 1, 0, 2, 1])
  const at60 = arrange(snapshot({ lanes }), 60)
  assert.deepEqual(at60.lanes.map((l) => [l.x, l.w]), [[0, 29], [30, 29], [0, 29], [30, 29], [0, 29]])
  const [a, b, c, d, e] = at60.lanes.map(laneBox)
  assert.equal(a.y, 4)
  assert.equal(b.y, 4)
  // The next band starts after the taller lane of the band above and one blank row.
  assert.equal(c.y, Math.max(a.y + a.h, b.y + b.h) + 1)
  assert.equal(d.y, c.y)
  assert.equal(e.y, Math.max(c.y + c.h, d.y + d.h) + 1)

  const at24 = arrange(snapshot({ lanes }), 24)
  const boxes = at24.lanes.map(laneBox)
  assert.ok(at24.lanes.every((l) => l.x === 0 && l.w === 24))
  for (let i = 1; i < boxes.length; i++) assert.equal(boxes[i].y, boxes[i - 1].y + boxes[i - 1].h + 1)
})

test('nine cards in one lane at 24 columns all get a box, with a +N more row', () => {
  const lanes = lanesOf([9, 0, 0, 0, 0])
  lanes[0].total = 14
  const L = arrange(snapshot({ lanes }), 24)
  const lane = L.lanes[0]
  assert.equal(lane.cards.length, 9)
  assert.equal(lane.more, 5)
  assert.equal(L.lanes[1].y, laneBox(lane).y + laneBox(lane).h + 1)
  check(L, snapshot({ lanes }), 24)
})

test('card titles wrap at spaces to two lines, the second ending in … when cut', () => {
  const titles = ['Add a token bucket', 'Wire the token bucket into the gateway', 'Wire the token bucket limiter into the public gateway and log every refusal']
  const lanes = lanesOf([3, 0, 0, 0, 0], (key, j) => card(`${key}-${j + 1}`, titles[j]))
  const L = arrange(snapshot({ lanes }), 24)
  const [short, two, cut] = L.lanes[0].cards
  // A 24-cell card leaves 22 cells inside its border.
  assert.deepEqual(short.titleLines, ['Add a token bucket'])
  assert.deepEqual(two.titleLines, ['Wire the token bucket', 'into the gateway'])
  assert.equal(two.titleLines.length, 2)
  assert.ok(!two.titleLines[1].endsWith('…'))
  assert.equal(cut.titleLines[0], 'Wire the token bucket')
  assert.ok(cut.titleLines[1].endsWith('…'))
  assert.ok(cellWidth(cut.titleLines[1]) <= 22)
  assert.equal(short.idText, 'todo-1')
  assert.equal(short.h, 2 + 2)
})

test('a word too long for the card is cut to the card, not left to spill over', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('x'.repeat(200), 'y'.repeat(200), { tag: 'z'.repeat(200) }))
  const c = arrange(snapshot({ lanes }), 24).lanes[0].cards[0]
  assert.equal(c.idText, 'x'.repeat(22))
  assert.deepEqual(c.titleLines, ['y'.repeat(22), `${'y'.repeat(21)}…`])
  assert.equal(c.tag, 'z'.repeat(22))
})

test('a cook\'s slot: sprite box, then its name line and activity line under it', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('token-bucket', 'Add a token bucket', { tag: 'heavy' }))
  const agents = [agent('a1', { name: 'Miso', role: 'cook', model: 'claude-sonnet-4', card: 'token-bucket', activity: 'running tests' })]
  const L = arrange(snapshot({ lanes, agents }), 80)
  const c = L.lanes[0].cards[0]
  const [s] = c.slots
  assert.equal(s.agentId, 'a1')
  assert.equal(s.name.text, '♨ Miso · cook')
  assert.equal(s.activity.text, 'running tests')
  // Inside the border, below the id, one title line and the tag.
  assert.deepEqual({ x: s.x, y: s.y, w: s.w, h: s.h }, { x: c.x + 1, y: c.y + 4, w: 9, h: 4 })
  assert.deepEqual(s.name, { x: s.x, y: s.y + s.h, text: '♨ Miso · cook' })
  assert.deepEqual(s.activity, { x: s.x, y: s.y + s.h + 1, text: 'running tests' })
  assert.equal(c.h, 1 + 3 + 4 + 2 + 1)
  assert.deepEqual(L.homes.a1, { x: s.x, y: s.y, w: 9, h: 4 })
  assert.deepEqual(L.obstacles, [{ x: s.x, y: s.y + 4, w: 13, h: 1 }, { x: s.x, y: s.y + 5, w: 13, h: 1 }])
})

test('the activity line falls back to finished, failed or blank', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('c'))
  const agents = [
    agent('a', { card: 'c', state: 'done' }), agent('b', { card: 'c', state: 'failed' }),
    agent('c', { card: 'c', state: 'working' }), agent('d', { card: 'c', state: 'done', activity: 'editing bucket.ts' }),
  ]
  const slots = arrange(snapshot({ lanes, agents }), 160).lanes[0].cards[0].slots
  assert.deepEqual(slots.map((s) => s.activity.text), ['finished', 'failed', '', 'editing bucket.ts'])
})

test('the largest sprite with ✦ Basil · planner fits a 24-cell lane uncut', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('c'))
  const agents = [agent('p', { name: 'Basil', role: 'planner', model: 'claude-fable-1', card: 'c' })]
  const L = arrange(snapshot({ lanes, agents }), 24)
  const s = L.lanes[0].cards[0].slots[0]
  assert.equal(s.w, 13)
  assert.equal(s.h, 6)
  assert.equal(s.name.text, '✦ Basil · planner')
  check(L, snapshot({ lanes, agents }), 24)
})

test('two agents with 17-cell names on one 22-cell card stack, neither name cut', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('c'))
  const agents = [
    agent('a', { name: 'Tamarind', role: 'cook', model: 'claude-haiku-4', card: 'c' }),
    agent('b', { name: 'Pepper 2', role: 'cook', model: 'claude-haiku-4', card: 'c' }),
  ]
  // 45 columns gives two 22-cell lanes per band.
  const L = arrange(snapshot({ lanes, agents }), 45)
  const c = L.lanes[0].cards[0]
  assert.equal(c.w, 22)
  const [a, b] = c.slots
  assert.equal(a.name.text, '♨ Tamarind · cook')
  assert.equal(b.name.text, '♨ Pepper 2 · cook')
  assert.equal(cellWidth(a.name.text), 17)
  assert.equal(a.x, b.x)
  assert.ok(b.y > a.activity.y, 'the second slot starts below the first one\'s activity line')
  check(L, snapshot({ lanes, agents }), 45)
})

test('narrow slots sit side by side with one cell between them', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('c'))
  const agents = [agent('a', { name: 'Rye', role: 'cook', model: 'claude-haiku-4', card: 'c' }), agent('b', { name: 'Rye', role: 'cook', model: 'claude-haiku-4', card: 'c' })]
  const [a, b] = arrange(snapshot({ lanes, agents }), 160).lanes[0].cards[0].slots
  // Each name line is 12 cells: '♨ Rye · cook'.
  assert.equal(a.y, b.y)
  assert.equal(b.x, a.x + 12 + 1)
})

test('an agent goes on the first card with its id; a duplicate card gets nobody', () => {
  const lanes = lanesOf([1, 1, 0, 0, 0], () => card('same'))
  const agents = [agent('a', { card: 'same' })]
  const L = arrange(snapshot({ lanes, agents }), 124)
  assert.equal(L.lanes[0].cards[0].slots.length, 1)
  assert.equal(L.lanes[1].cards[0].slots.length, 0)
  assert.equal(L.crew, null)
})

test('the crew band holds a planner with no card', () => {
  const agents = [
    agent('p', { name: 'Basil', role: 'planner', model: 'claude-opus-4', card: null, activity: 'planning' }),
    agent('q', { name: 'Sage', role: 'scout', model: 'claude-haiku-4', card: 'gone-card' }),
  ]
  const snap = snapshot({ lanes: lanesOf(1), agents })
  const L = arrange(snap, 100)
  const bottom = Math.max(...L.lanes.map((l) => laneBox(l).y + laneBox(l).h))
  assert.equal(L.crew.y, bottom + 1)
  const [p, q] = L.crew.slots
  assert.equal(p.agentId, 'p')
  assert.equal(q.agentId, 'q')
  assert.equal(p.name.text, '✦ Basil · planner')
  // Room at 100 columns, so the name and activity sit to the right of the sprite.
  assert.equal(p.name.x, p.x + p.w + 1)
  assert.equal(p.activity.text, 'planning')
  assert.ok(p.name.y >= p.y && p.activity.y < p.y + p.h)
  assert.ok(q.x > p.name.x + cellWidth(p.name.text))
  check(L, snap, 100)
})

test('the crew puts text under the sprite when it will not fit beside it', () => {
  const agents = [agent('p', { name: 'Basil', role: 'planner', model: 'claude-fable-1', activity: 'reading the plan' })]
  const L = arrange(snapshot({ agents }), 24)
  const [p] = L.crew.slots
  assert.equal(p.name.x, p.x)
  assert.equal(p.name.y, p.y + p.h)
  assert.equal(p.activity.y, p.y + p.h + 1)
})

test('panels sit side by side at 100 columns and stack at 60', () => {
  const messages = [{ id: 'm1', at: 1, from: 'Clove', to: 'Miso', item: 'token-bucket', text: 'two findings on the limiter', file: null }]
  const learnings = { total: 7, lines: ['one', 'two', 'three', 'four', 'five', 'six'] }
  const snap = snapshot({ messages, learnings })
  const wide = arrange(snap, 100)
  assert.deepEqual([wide.messages.x, wide.messages.w, wide.learnings.x, wide.learnings.w], [0, 60, 61, 39])
  assert.equal(wide.messages.y, wide.learnings.y)
  assert.equal(wide.messages.h, wide.learnings.h)
  assert.deepEqual(wide.messages.rows, [{ id: 'm1', y: wide.messages.y + 1, head: 'Clove → Miso', text: 'two findings on the limiter' }])
  assert.deepEqual(wide.learnings.lines, ['one', 'two', 'three', 'four', 'five'])
  assert.equal(wide.learnings.more, 2)
  // Five lines and the +N more row inside the border.
  assert.equal(wide.learnings.h, 8)

  const narrow = arrange(snap, 60)
  assert.deepEqual([narrow.messages.x, narrow.messages.w, narrow.learnings.x, narrow.learnings.w], [0, 60, 0, 60])
  assert.equal(narrow.messages.h, 4)
  assert.equal(narrow.learnings.y, narrow.messages.y + narrow.messages.h + 1)
  check(wide, snap, 100)
  check(narrow, snap, 60)
})

test('empty panels are three rows with nothing in them', () => {
  const L = arrange(snapshot(), 100)
  assert.deepEqual([L.messages.h, L.messages.rows], [3, []])
  assert.deepEqual([L.learnings.h, L.learnings.lines, L.learnings.more], [3, [], 0])
})

test('the legend is right-aligned on the last row and its spans cover the four family words', () => {
  const L = arrange(snapshot(), 100)
  assert.equal(L.legend.text, 'Color: haiku · sonnet · opus · fable')
  assert.equal(L.legend.x, 100 - 36)
  assert.equal(L.legend.y, L.rows - 1)
  assert.deepEqual(L.legend.spans, [
    { x: 71, w: 5, family: 'haiku' }, { x: 79, w: 6, family: 'sonnet' }, { x: 88, w: 4, family: 'opus' }, { x: 95, w: 5, family: 'fable' },
  ])
  // Too narrow for the whole line: the words still show, in order, inside the pane.
  for (const columns of [24, 30]) {
    const N = arrange(snapshot(), columns)
    assert.ok(N.legend.x >= 0 && N.legend.x + cellWidth(N.legend.text) === columns)
    for (const s of N.legend.spans) assert.equal(N.legend.text.slice(s.x - N.legend.x, s.x - N.legend.x + s.w), s.family)
  }
})

test('the header: repo · branch, title and detail, clipped clear of the meter', () => {
  const L = arrange(snapshot(), 100)
  assert.equal(L.header.repo, 'storefront · feat/x')
  assert.equal(L.header.title, 'Rate limit the public API')
  assert.deepEqual(L.header.meter, { x: 79, y: 0, w: 21, icon: { x: 79 }, text: { x: 88 } })
  const narrow = arrange(snapshot({ project: { repo: 'storefront', branch: null, title: 'Rate limit the public API', detail: '' } }), 30)
  assert.deepEqual(narrow.header.meter, { x: 18, y: 0, w: 12, icon: null, text: { x: 18 } })
  assert.equal(narrow.header.repo, 'storefront')
  assert.equal(narrow.header.title, 'Rate limit the p')
})

test('the modal: centred box, wrapped lines, its regions last', () => {
  const lanes = lanesOf([2, 0, 0, 0, 0])
  const messages = [{ id: 'm1', at: 1, from: 'Clove', to: 'Miso', item: 'x', text: 'hi', file: null }]
  const detail = { kind: 'card', id: 'todo-1', title: 'Add a token bucket', lines: ['status: cooking', 'the limiter refuses a burst past the bucket size and logs it once'] }
  const snap = snapshot({ lanes, messages, detail })
  const L = arrange(snap, 40)
  const box = L.modal
  assert.equal(box.w, 36)
  assert.equal(box.x, 2)
  assert.equal(box.title, 'Add a token bucket')
  assert.deepEqual(box.lines, ['status: cooking', 'the limiter refuses a burst past', 'the bucket size and logs it once'])
  assert.equal(box.h, 7)
  const tail = L.regions.slice(-3)
  assert.deepEqual(tail.map((r) => r.kind), ['close', 'modal', 'close'])
  assert.deepEqual(tail[2], { kind: 'close', id: 'close', x: box.x + box.w - 4, y: box.y, w: 3, h: 1 })
  assert.deepEqual(L.regions.slice(0, 3).map((r) => r.kind), ['card', 'card', 'message'])
  check(L, snap, 40)
})

test('a modal on a tiny board makes the board at least 12 rows and cuts its lines with …', () => {
  const detail = { kind: 'agent', id: 'a1', title: 'Miso', lines: Array.from({ length: 30 }, (_, i) => `line ${i}`) }
  const snap = { detail }
  const L = arrange(snap, 24)
  assert.ok(L.rows >= 12)
  assert.equal(L.modal.h, L.rows - 2)
  assert.equal(L.modal.lines.at(-1), '…')
  assert.equal(L.modal.lines.length, L.rows - 6)
  check(L, snap, 24)
})

test('hostile text never breaks a width or carries a control character', () => {
  for (const bad of HOSTILE) {
    const lanes = lanesOf([2, 0, 0, 0, 0], (key, j) => card(`${bad}-${j}`, bad, { tag: bad }))
    const agents = [agent(bad, { name: bad, activity: bad, card: `${bad}-0` }), agent('crew', { name: bad, activity: bad })]
    const snap = snapshot({
      project: { mode: 'dish', repo: bad, branch: bad, title: bad, detail: bad },
      lanes, agents,
      messages: [{ id: bad, at: 0, from: bad, to: bad, item: bad, text: bad, file: null }],
      learnings: { total: 1, lines: [bad] },
      detail: { kind: 'card', id: bad, title: bad, lines: [bad, bad] },
    })
    for (const columns of WIDTHS) check(arrange(snap, columns), snap, columns)
  }
  const L = arrange(snapshot({ lanes: lanesOf([1, 0, 0, 0, 0], () => card('k', 'a\nb')) }), 80)
  assert.deepEqual(L.lanes[0].cards[0].titleLines, ['a b'])
})

test('ids come back in their safe form, and agents still find their cards', () => {
  const lanes = lanesOf([2, 0, 0, 0, 0], (key, j) => card(['x\u001b[2Jy', 'k\u200b'][j]))
  lanes[0].key = 'to\ndo'
  const agents = [
    agent('a\u0007', { card: 'x\u001b[2Jy' }),
    // A zero-width mark is dropped, so 'k' and 'k\u200b' are the same card to the board.
    agent('b', { card: 'k' }),
    // Two ids that differ only by a control character are one agent; the first one listed wins.
    agent('c\td'), agent('c d', { name: 'Sage' }),
  ]
  const messages = [{ id: 'm\r1', at: 0, from: 'Clove', to: 'Miso', item: 'x', text: 'hi', file: null }]
  const snap = snapshot({ lanes, agents, messages })
  const L = arrange(snap, 80)
  const [first, second] = L.lanes[0].cards
  assert.equal(L.lanes[0].key, 'to do')
  assert.deepEqual([first.id, second.id], ['x [2Jy', 'k'])
  assert.deepEqual(first.slots.map((s) => s.agentId), ['a '])
  assert.deepEqual(second.slots.map((s) => s.agentId), ['b'])
  assert.deepEqual(L.crew.slots.map((s) => [s.agentId, s.name.text]), [['c d', '♨ Miso · cook']])
  assert.deepEqual(Object.keys(L.homes).sort(), ['a ', 'b', 'c d'])
  assert.deepEqual(L.regions.map((r) => r.id), ['x [2Jy', 'k', 'm 1'])
  check(L, snap, 80)
})

test('crew rows of text-beside slots keep a blank row between them', () => {
  // Each slot is 20 cells (a 7-cell sprite, a space, '♨ Rye · cook'), so at 24 columns one fits a row.
  const agents = ['a', 'b', 'c'].map((id) => agent(id, { name: 'Rye', model: 'claude-haiku-4' }))
  const snap = snapshot({ agents })
  const L = arrange(snap, 24)
  const [a, b, c] = L.crew.slots
  assert.equal(a.name.x, a.x + a.w + 1)
  assert.equal(b.y, a.y + a.h + 1)
  assert.equal(c.y, b.y + b.h + 1)
  check(L, snap, 24)
})

test('a 200-character title and a CJK id fit the card', () => {
  const lanes = lanesOf([1, 0, 0, 0, 0], () => card('日本語チケット番号日本語チケット番号', 'word '.repeat(40)))
  const c = arrange(snapshot({ lanes }), 24).lanes[0].cards[0]
  assert.ok(cellWidth(c.idText) <= 22)
  assert.equal(c.idText, '日本語チケット番号日本')
  assert.equal(c.titleLines.length, 2)
  assert.ok(c.titleLines[1].endsWith('…'))
})
