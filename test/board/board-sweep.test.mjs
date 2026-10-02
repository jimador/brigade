// Draws lots of generated task boards at every pane width from 24 to 160 and checks what must hold
// for any board: rows fill the pane exactly, no control character reaches the terminal, every card
// and every agent can be clicked, the hover card shows every line, the detail box owns its own
// cells, and sprites at home stay off the name lines. The boards come from a seeded generator, so a
// failure prints the seed, case and width, and BOARD_SWEEP_SEED replays it.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { draw } from '../../hooks/board/lib/board-paint.mjs'
import { arrange } from '../../hooks/board/lib/board-layout.mjs'
import { cardLines } from '../../hooks/board/lib/stage.mjs'
import { ROLES } from '../../hooks/board/lib/sprites.mjs'

const DEFAULT_SEED = 20261002
const SEED = seedFromEnv(process.env.BOARD_SWEEP_SEED)
const CASES = 40
const MIN_WIDTH = 24
const MAX_WIDTH = 160
// At these widths every agent gets hovered; at every other width one of up to three chosen agents
// does, taking turns, so each chosen one is hovered across the whole range and the gate stays fast.
const FULL_HOVER_WIDTHS = new Set([24, 40, 60, 100, 124, 160])
// A blow-up should fail the run, not hang it. The sweep takes about 10 seconds at best, and this
// is four times that, rounded up.
const BUDGET_MS = 40000
// The sweep is drawn up to this many times, so a busy machine gets more than one chance.
const RUNS = 5

// Runs `fn` up to `runs` times and gives back the fastest run in milliseconds. A busy machine only
// ever makes a run slower, so the fastest one is the closest to what the code itself costs. A run
// quicker than `enough` ms ends it early: the fastest can only be quicker still, so the verdict
// against that limit is already known, and the sweep is too slow to draw five times for nothing.
function fastestOf(runs, fn, enough = 0) {
  let best = Infinity
  for (let i = 0; i < runs && best >= enough; i++) {
    const start = performance.now()
    fn()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

function seedFromEnv(raw) {
  if (raw == null || raw === '') return DEFAULT_SEED
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) throw new Error(`BOARD_SWEEP_SEED must be an integer, got ${JSON.stringify(raw)}`)
  return n >>> 0
}

// A small seeded random number generator (mulberry32), so every run draws the same boards.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The test's own idea of text on screen, kept apart from the library so a bug there can't hide.
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

function isWide(ch) {
  const cp = ch.codePointAt(0)
  return WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}

function cellsOf(ch) {
  // Plain ASCII and Latin text is by far the most common, so it skips the range checks.
  if (ch.codePointAt(0) < 0x300) return 1
  if (ZERO_WIDTH.test(ch)) return 0
  return isWide(ch) ? 2 : 1
}

function cells(text) {
  let n = 0
  for (const ch of text) n += cellsOf(ch)
  return n
}

// What a terminal-safe line should look like: invisible marks gone, control characters as spaces.
function safe(text) {
  return String(text ?? '').replace(ZERO_WIDTH_ALL, '').replace(CONTROL_ALL, ' ')
}

// The longest start of `text` that fits in `n` cells.
function clipCells(text, n) {
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellsOf(ch)
    if (used + w > n) break
    out += ch
    used += w
  }
  return out
}

// The `n` cells of a row's text starting at cell `from`, as text.
function sliceCells(text, from, n) {
  let out = ''
  let at = 0
  for (const ch of text) {
    if (at >= from + n) break
    if (at >= from) out += ch
    at += cellsOf(ch)
  }
  return out
}

function rowText(row) {
  return row.map((r) => r.text).join('')
}

// JSON with every invisible or C1 control character escaped, so a failure message can't garble
// the terminal it is printed to.
function show(value) {
  return JSON.stringify(value).replace(/[\u007f-\u009f̀-ͯ​-‏⁠﻿]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

function where(c, width, detail) {
  return `${detail}\nseed ${SEED}, case ${c.index}, width ${width}` +
    `\nreplay: BOARD_SWEEP_SEED=${SEED} node --test test/board/board-sweep.test.mjs` +
    `\nsnapshot: ${show(c.snapshot)}`
}

function contains(box, x, y) {
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// The generator's raw material: plain, long and hostile text.
const LONG = 'a-very-long-ticket-title-that-goes-on-and-on-past-any-card-edge-xyz'
const HOSTILE = [
  'line\nbreak', 'wipe\u001b[2J', 'bell\u0007', 'csi\u009b1m', '日本語チケット', '🍜-ramen 🔥',
  'café', 'zero​width', '​', '́​', '日本\u0007語🔥', LONG,
]
const PLAIN = ['Token bucket per key', 'Send Retry-After', 'Limits from config', 'Quota store', 'Schema for limits', 'Docs page']
const PHASES = [['todo', 'To do'], ['cooking', 'Cooking'], ['review', 'In review'], ['rework', 'Rework'], ['done', 'Done']]
const NAME_BITS = ['Basil', 'Sage', 'Miso', 'Nori', '日本語', '🍜', '\n', '\u001b[2J', '\u0007', '\u009b', 'é', '​']
const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-fable-1', null, 'some-other-model']
const ROLE_KEYS = [...Object.keys(ROLES), 'toString']
const STATES = ['working', 'done', 'failed']
const ACTIVITIES = ['editing src/limit.ts', 'running tests', 'reading the diff', null, '']

function generate(rand, index) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const chance = (p) => rand() < p
  const words = () => (chance(0.3) ? pick(HOSTILE) : chance(0.2) ? `${pick(HOSTILE)} ${pick(PLAIN)} ${pick(HOSTILE)}` : pick(PLAIN))

  // Case 0 is the empty board; case 1 is the crowded one, every hard input at once.
  const empty = index === 0
  const crowded = index === 1
  const mode = chance(0.5) ? 'dish' : 'tickets'
  const project = {
    mode, repo: chance(0.2) ? pick(HOSTILE) : 'storefront', branch: chance(0.3) ? null : chance(0.2) ? pick(HOSTILE) : 'feat/rate-limit',
    title: words(), detail: words(),
  }

  const lanes = PHASES.map(([key, title], li) => {
    const n = empty ? 0 : crowded && li === 0 ? 7 : chance(0.15) ? 7 : int(0, 7)
    const cards = []
    for (let i = 0; i < n; i++) {
      const r = rand()
      const id = r < 0.7 ? `${key}-${i}` : r < 0.8 ? 'shared-1' : `${pick(HOSTILE)}-${i}`
      cards.push({ id, title: words(), phase: key, tag: chance(0.3) ? (chance(0.3) ? pick(HOSTILE) : 'attempt 2') : null, alert: chance(0.2) })
    }
    const total = n + (chance(0.3) ? int(1, 20) : 0)
    return { key, title: chance(0.05) ? pick(HOSTILE) : title, total, cards }
  })

  const cardIds = lanes.flatMap((lane) => lane.cards.map((c) => c.id))
  const focus = cardIds.length > 0 && (crowded || chance(0.6)) ? pick(cardIds) : null
  const agents = []
  const count = empty ? 0 : crowded ? 12 : chance(0.2) ? 12 : int(0, 12)
  for (let k = 0; k < count; k++) {
    let name = ''
    for (let p = int(1, 3); p > 0; p--) name += chance(0.5) ? pick(NAME_BITS) : pick(NAME_BITS.slice(0, 4))
    const r = rand()
    let cardId = null
    if (crowded && k < 3) cardId = focus
    else if (r < 0.2) cardId = null
    else if (r < 0.3) cardId = 'no-such-card'
    else if (cardIds.length > 0) cardId = focus && chance(0.5) ? focus : pick(cardIds)
    const startedAt = chance(0.1) ? null : int(0, 1_000_000)
    agents.push({
      id: chance(0.15) ? `${pick(HOSTILE)}-${k}` : `a${k}`, name, role: pick(ROLE_KEYS), model: pick(MODELS), state: pick(STATES),
      dish: mode === 'dish' ? 'token-bucket' : null, item: chance(0.2) ? null : chance(0.5) ? `item-${k}` : pick(HOSTILE),
      ticket: null, card: cardId, activity: chance(0.2) ? pick(HOSTILE) : pick(ACTIVITIES),
      tokens: int(0, 3_000_000), startedAt, endedAt: startedAt != null && chance(0.2) ? startedAt + int(0, 500_000) : null,
    })
  }

  const weather = empty || chance(0.3) ? null : chance(0.1)
    ? { level: 0, label: 'NO READING', glyph: '·', percent: null }
    : { level: int(0, 4), label: pick(['CLEAR', 'CLOUDY', 'SHOWERS', 'STORM']), glyph: '☂', percent: int(0, 100) }
  const messages = []
  for (let i = empty ? 0 : int(0, 6); i > 0; i--) {
    messages.push({ id: chance(0.2) ? pick(HOSTILE) : `m${i}`, at: i, from: pick(NAME_BITS), to: pick(NAME_BITS), item: 'token-bucket', text: words(), file: null })
  }
  const lines = []
  for (let i = empty ? 0 : int(0, 7); i > 0; i--) lines.push(words())
  const learnings = { total: lines.length + (chance(0.3) ? int(1, 9) : 0), lines }
  let detail = null
  if (crowded || (!empty && chance(0.35))) {
    const detailLines = []
    for (let i = int(0, 30); i > 0; i--) detailLines.push(chance(0.1) ? '' : words())
    detail = { kind: pick(['card', 'agent', 'message']), id: chance(0.3) ? pick(HOSTILE) : 'token-bucket', title: words(), lines: detailLines }
  }
  return { project, lanes, agents, weather, messages, learnings, detail, now: 2_000_000 }
}

// The agents the board can place: one per safe id, the first one listed wins.
function placeable(snapshot) {
  const seen = new Set()
  const out = []
  for (const a of snapshot.agents) {
    const id = safe(a.id)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(a)
  }
  return out
}

function onCard(snapshot) {
  const ids = new Set(snapshot.lanes.flatMap((l) => l.cards.map((c) => safe(c.id))))
  return (a) => a.card != null && ids.has(safe(a.card))
}

// Up to three agents hovered at every width: one on a card in the last lane and one in the crew
// when the case has them, then others drawn at random.
function chooseHovers(rand, snapshot) {
  const agents = placeable(snapshot)
  const chosen = []
  const add = (a) => { if (a && !chosen.includes(a) && chosen.length < 3) chosen.push(a) }
  const lastIds = new Set((snapshot.lanes.at(-1)?.cards ?? []).map((c) => safe(c.id)))
  const last = agents.filter((a) => a.card != null && lastIds.has(safe(a.card)))
  const crew = agents.filter((a) => !onCard(snapshot)(a))
  if (last.length > 0) add(last[Math.floor(rand() * last.length)])
  if (crew.length > 0) add(crew[Math.floor(rand() * crew.length)])
  const rest = agents.filter((a) => !chosen.includes(a))
  while (chosen.length < 3 && rest.length > 0) add(rest.splice(Math.floor(rand() * rest.length), 1)[0])
  return chosen.map((a) => safe(a.id))
}

// One drawn frame, kept as row texts: a row's text is its runs' text joined, so checking it is
// checking every run. A hovered frame shares the plain frame's string for every row the card
// left alone, which keeps the cache several times smaller.
function frameOf(snapshot, hovered, width, plain = null) {
  const out = draw(snapshot, { positions: {}, frame: 0, hovered, over: null }, width)
  const texts = out.rows.map((row, y) => {
    const text = rowText(row)
    return plain && plain.texts[y] === text ? plain.texts[y] : text
  })
  return { texts, height: out.height, rowCount: out.rows.length, regions: plain ? null : out.regions }
}

let sweep = null

// Draws every frame of every case at every width.
function drawSweep() {
  const rand = mulberry32(SEED)
  const cases = []
  let drawn = 0
  for (let index = 0; index < CASES; index++) {
    const snapshot = generate(rand, index)
    const some = chooseHovers(rand, snapshot)
    const all = placeable(snapshot).map((a) => safe(a.id))
    const widths = []
    for (let width = MIN_WIDTH; width <= MAX_WIDTH; width++) {
      const L = arrange(snapshot, width)
      const plan = { columns: L.columns, rows: L.rows, modal: L.modal, obstacles: L.obstacles }
      const plain = frameOf(snapshot, null, width)
      const ids = FULL_HOVER_WIDTHS.has(width) ? all : some.length > 0 ? [some[width % some.length]] : []
      const hovered = ids.map((id) => ({ id, frame: frameOf(snapshot, id, width, plain) }))
      drawn += 1 + hovered.length
      widths.push({ width, plan, plain, hovered })
    }
    cases.push({ index, snapshot, some, widths })
  }
  return { cases, drawn }
}

// Draws the sweep, timed, and the property tests share the result. Every run draws the same
// frames from the same seed, so whichever run is kept, the tests check the same thing. The hook
// gets one budget more than the runs need, so five slow runs end in the message saying how slow
// rather than a timeout; a sweep that never finishes still hits the timeout.
before(() => {
  let drawn = null
  const ms = fastestOf(RUNS, () => { drawn = drawSweep() }, BUDGET_MS)
  sweep = { ...drawn, ms }
  assert.ok(ms < BUDGET_MS, `drawing the sweep took ${Math.round(ms)} ms at best of ${RUNS}, over the ${BUDGET_MS} ms budget`)
}, { timeout: (RUNS + 1) * BUDGET_MS })

function* allFrames() {
  for (const c of sweep.cases) {
    for (const w of c.widths) {
      yield { c, w, frame: w.plain, hovered: null }
      for (const h of w.hovered) yield { c, w, frame: h.frame, hovered: h.id }
    }
  }
}

// The rows of a frame worth checking: a hovered frame's row that is the very same string as the
// plain frame's row was already checked there.
function* rowsToCheck(w, frame) {
  for (let y = 0; y < frame.texts.length; y++) {
    if (frame !== w.plain && frame.texts[y] === w.plain.texts[y]) continue
    yield y
  }
}

test('every row of every frame is exactly as wide as the laid-out pane, and height counts the rows', { timeout: BUDGET_MS }, (t) => {
  t.diagnostic(`seed ${SEED}: ${sweep.cases.length} cases, ${sweep.drawn} frames drawn in ${Math.round(sweep.ms)} ms`)
  for (const { c, w, frame, hovered } of allFrames()) {
    if (frame.height !== frame.rowCount || frame.rowCount !== w.plan.rows) {
      assert.fail(where(c, w.width, `hovered ${show(hovered)}: height ${frame.height}, ${frame.rowCount} rows, layout ${w.plan.rows}`))
    }
    for (const y of rowsToCheck(w, frame)) {
      const got = cells(frame.texts[y])
      if (got !== w.plan.columns) {
        assert.fail(where(c, w.width, `hovered ${show(hovered)}: row ${y} is ${got} cells, want ${w.plan.columns}: ${show(frame.texts[y])}`))
      }
    }
  }
})

test('no frame carries a control character', { timeout: BUDGET_MS }, () => {
  for (const { c, w, frame, hovered } of allFrames()) {
    for (const y of rowsToCheck(w, frame)) {
      if (CONTROL.test(frame.texts[y])) {
        assert.fail(where(c, w.width, `hovered ${show(hovered)}: control character in row ${y}: ${show(frame.texts[y])}`))
      }
    }
  }
})

test('every card gets a drawn card and a click region, and every agent at home a region inside the board', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    const cardIds = c.snapshot.lanes.flatMap((l) => l.cards.map((card) => safe(card.id)))
    const agents = placeable(c.snapshot).map((a) => safe(a.id))
    for (const w of c.widths) {
      const { regions, texts } = w.plain
      const cardRegions = regions.filter((r) => r.kind === 'card')
      for (const id of cardIds) {
        if (!cardRegions.some((r) => r.id === id)) assert.fail(where(c, w.width, `card ${show(id)} has no region`))
      }
      // Each card's top-left corner is drawn, unless the detail box covers it.
      for (const r of cardRegions) {
        if (w.plan.modal && contains(w.plan.modal, r.x, r.y)) continue
        if (sliceCells(texts[r.y], r.x, 1) !== '╭') {
          assert.fail(where(c, w.width, `card ${show(r.id)} is not drawn at ${r.x},${r.y}: ${show(texts[r.y])}`))
        }
      }
      for (const id of agents) {
        const r = regions.find((x) => x.kind === 'agent' && x.id === id)
        if (!r) assert.fail(where(c, w.width, `agent ${show(id)} has no region`))
        if (!(r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= w.plan.columns && r.y + r.h <= w.plain.height)) {
          assert.fail(where(c, w.width, `agent ${show(id)} region ${show(r)} leaves the ${w.plan.columns}x${w.plain.height} board`))
        }
      }
    }
  }
})

test('the hover card shows every line and never changes the frame height', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    const byId = new Map(placeable(c.snapshot).map((a) => [safe(a.id), a]))
    for (const w of c.widths) {
      for (const h of w.hovered) {
        if (h.frame.rowCount !== w.plain.rowCount || h.frame.height !== w.plain.height) {
          assert.fail(where(c, w.width, `hovering ${show(h.id)} changed the row count from ${w.plain.rowCount} to ${h.frame.rowCount}`))
        }
        // The detail box is drawn over everything, the hover card included.
        if (w.plan.modal) continue
        const agent = byId.get(h.id)
        const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
        const lines = cardLines(agent, role.label, c.snapshot.now)
        for (let i = 0; i < lines.length; i++) {
          const want = clipCells(safe(lines[i]), w.plan.columns - 2)
          if (want.trim() === '') continue
          if (!h.frame.texts.some((text) => text.includes(want))) {
            assert.fail(where(c, w.width, `hovering ${show(h.id)}: card line ${i} ${show(want)} is not on the frame`))
          }
        }
      }
    }
  }
})

test('the detail box shows its title and [x], and owns every click on it', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    if (!c.snapshot.detail) continue
    for (const w of c.widths) {
      const m = w.plan.modal
      const { texts, regions } = w.plain
      const title = clipCells(safe(c.snapshot.detail.title), m.w - 4)
      if (!texts[m.y + 1].includes(title)) assert.fail(where(c, w.width, `title ${show(title)} missing from ${show(texts[m.y + 1])}`))
      const cx = m.x + m.w - 4
      if (sliceCells(texts[m.y], cx, 3) !== '[x]') assert.fail(where(c, w.width, `no [x] at ${cx},${m.y}: ${show(texts[m.y])}`))
      const lastAt = (x, y) => {
        for (let i = regions.length - 1; i >= 0; i--) if (contains(regions[i], x, y)) return regions[i]
        return null
      }
      for (let y = m.y; y < m.y + m.h; y++) {
        for (let x = m.x; x < m.x + m.w; x++) {
          const want = y === m.y && x >= cx && x < cx + 3 ? 'close' : 'modal'
          const got = lastAt(x, y)
          if (!got || got.kind !== want) assert.fail(where(c, w.width, `cell ${x},${y} goes to ${show(got)}, want ${want}`))
        }
      }
    }
  }
})

test('with every sprite at home, no sprite covers a name or activity line', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    for (const w of c.widths) {
      for (const r of w.plain.regions.filter((x) => x.kind === 'agent')) {
        const hit = w.plan.obstacles.find((o) => overlaps(r, o))
        if (hit) assert.fail(where(c, w.width, `sprite ${show(r)} covers ${show(hit)}`))
      }
    }
  }
})

test('the generator really draws the hard boards', { timeout: BUDGET_MS }, () => {
  const seen = {
    'a lane with 7 cards': false,
    'a card with 3 agents': false,
    '12 agents': false,
    'an empty board': false,
    'a 24-column frame': false,
    'a detail box': false,
    'dish mode and ticket mode': false,
    'null weather': false,
    'an agent with no card': false,
    'hostile text': false,
  }
  const modes = new Set()
  for (const c of sweep.cases) {
    const { lanes, agents, weather, detail, project } = c.snapshot
    modes.add(project.mode)
    if (lanes.some((l) => l.cards.length === 7)) seen['a lane with 7 cards'] = true
    const perCard = new Map()
    for (const a of placeable(c.snapshot).filter(onCard(c.snapshot))) perCard.set(safe(a.card), (perCard.get(safe(a.card)) ?? 0) + 1)
    if ([...perCard.values()].some((n) => n >= 3)) seen['a card with 3 agents'] = true
    if (agents.length === 12) seen['12 agents'] = true
    if (agents.length === 0 && lanes.every((l) => l.cards.length === 0)) seen['an empty board'] = true
    if (c.widths.some((w) => w.plan.columns === 24)) seen['a 24-column frame'] = true
    if (detail) seen['a detail box'] = true
    if (weather === null) seen['null weather'] = true
    if (agents.some((a) => !onCard(c.snapshot)(a))) seen['an agent with no card'] = true
    const strings = [...lanes.flatMap((l) => l.cards.flatMap((x) => [x.id, x.title])), ...agents.map((a) => a.name)]
    if (strings.some((s) => s != null && (CONTROL.test(s) || [...s].some(isWide)))) seen['hostile text'] = true
  }
  if (modes.has('dish') && modes.has('tickets')) seen['dish mode and ticket mode'] = true
  const missing = Object.keys(seen).filter((k) => !seen[k])
  assert.deepEqual(missing, [], `seed ${SEED} never drew: ${missing.join('; ')}`)
  assert.ok(sweep.cases.length >= 40)
})
