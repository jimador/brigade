// Draws lots of generated boards at every pane width from 20 to 160 and checks what must hold for
// any board: rows fill the pane exactly, no control character reaches the terminal, every worked
// ticket keeps its chip, and the hover card shows every line. The boards come from a seeded
// generator, so a failure prints the seed, case and width, and BOARD_SWEEP_SEED replays it.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { paint } from '../../hooks/board/lib/paint.mjs'
import { layout, CHIP_W } from '../../hooks/board/lib/layout.mjs'
import { toLanes, LANES } from '../../hooks/board/lib/board.mjs'
import { cardLines } from '../../hooks/board/lib/stage.mjs'
import { ROLES } from '../../hooks/board/lib/sprites.mjs'

const DEFAULT_SEED = 20261002
const SEED = seedFromEnv(process.env.BOARD_SWEEP_SEED)
const CASES = 40
const MIN_WIDTH = 20
const MAX_WIDTH = 160
// At these widths every agent gets hovered; elsewhere a few chosen ones do, to keep the gate fast.
const FULL_HOVER_WIDTHS = new Set([20, 24, 40, 60, 100, 160])
// A blow-up should fail the run, not hang it.
const BUDGET_MS = 20000

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
    `\nreplay: BOARD_SWEEP_SEED=${SEED} node --test test/board/sweep.test.mjs` +
    `\nsnapshot: ${show(c.snapshot)}`
}

// The generator's raw material: plain, long and hostile ids and names.
const LONG = 'a-very-long-ticket-slug-that-goes-on-and-on-past-any-chip-xyz'.slice(0, 60)
const HOSTILE = [
  'line\nbreak', 'wipe\u001b[2J', 'bell\u0007', 'nul\u0000', 'csi\u009b1m', '日本語チケット', '🍜-ramen',
  'café', 'zero​width', '​', '́​', '日本\u0007語🔥', LONG,
]
// Ids that show up in more than one lane on purpose, so one lane's chip can't stand in for another's.
const SHARED = ['shared-1', 'shared-2', '日本語チケット', 'csi\u009b1m', LONG]
const NAME_BITS = ['Basil', 'Sage', 'Miso', 'Nori', '日本語', '🍜', '\n', '\u001b[2J', '\u0007', '\u0000', '\u009b', 'é', '​']
const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-fable-1']
const ROLE_KEYS = Object.keys(ROLES)
const STATES = ['working', 'idle', 'waiting', 'done', 'failed']
const KINDS = ['feature', 'bug', 'chore', 'docs', 'research', 'contract', 'mystery']
const UNKNOWN_LANES = ['in_test', 'qa', '__proto__']

function generate(rand, index) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const chance = (p) => rand() < p

  // Case 0 is the empty board, case 1 always keeps all six lanes.
  if (index === 0) {
    return { lanes: [], agents: [], weather: null, selected: null, now: 2_000_000 }
  }

  const raw = new Map()
  for (const lane of LANES) {
    const list = []
    const n = int(0, 40)
    for (let i = 0; i < n; i++) {
      const r = rand()
      const id = r < 0.5 ? `${lane.key}-${i}` : r < 0.65 ? pick(SHARED) : r < 0.75 ? `${LONG.slice(0, 56)}-${i}` : pick(HOSTILE)
      list.push({ id, title: id, status: pick(lane.statuses), kind: pick(KINDS) })
    }
    raw.set(lane.key, list)
  }

  // Sometimes every working agent crowds into one lane, the last lane included.
  const focus = chance(0.4) ? (chance(0.4) ? 'done' : pick(LANES).key) : null
  const agents = []
  const count = int(0, 12)
  for (let k = 0; k < count; k++) {
    const nameParts = int(1, 3)
    let name = ''
    for (let p = 0; p < nameParts; p++) name += chance(0.5) ? pick(NAME_BITS) : pick(NAME_BITS.slice(0, 4))
    const agent = {
      id: `a${k}`, name, role: pick(ROLE_KEYS), model: pick(MODELS), state: pick(STATES),
      lane: null, ticket: null, item: chance(0.2) ? null : chance(0.5) ? `item-${k}` : pick(HOSTILE),
      tokens: int(0, 3_000_000), startedAt: int(0, 1_000_000),
    }
    if (chance(0.2)) agent.endedAt = agent.startedAt + int(0, 500_000)
    const r = rand()
    if (r < 0.15) {
      agent.lane = chance(0.5) ? null : 'bench'
    } else if (r < 0.25) {
      agent.lane = pick(UNKNOWN_LANES)
      if (chance(0.5)) agent.ticket = `${agent.lane}-ticket`
    } else if (r < 0.35) {
      agent.lane = pick(LANES).key
    } else {
      const key = focus && chance(0.85) ? focus : pick(LANES).key
      const list = raw.get(key)
      if (list.length === 0) {
        agent.lane = key
      } else {
        agent.lane = key
        agent.ticket = pick(list).id
      }
    }
    agents.push(agent)
  }

  const worked = agents.map((a) => a.ticket).filter((t) => t != null)
  let lanes = toLanes([...raw.values()].flat(), 6, worked)
  // Case 1 keeps the full six; other cases sometimes drop lanes, all of them now and then.
  if (index !== 1 && chance(0.4)) {
    const keep = chance(0.15) ? 0 : rand()
    lanes = lanes.filter(() => rand() < keep)
  }
  const weather = chance(0.5) ? null : { level: int(0, 4), label: 'SHOWERS', glyph: '☂', percent: int(0, 100) }
  const selected = agents.length > 0 && chance(0.3) ? pick(agents).id : null
  return { lanes, agents, weather, selected, now: 2_000_000 }
}

// Agents layout puts on the bench: no lane, 'bench', or a lane the board doesn't show.
function benchAgents(snapshot) {
  const keys = new Set(snapshot.lanes.map((l) => l.key).filter((k) => k !== 'bench'))
  return snapshot.agents.filter((a) => a.lane == null || !keys.has(a.lane))
}

function lastLaneAgents(snapshot) {
  const last = snapshot.lanes.at(-1)
  return last ? snapshot.agents.filter((a) => a.lane === last.key) : []
}

// Up to three agents hovered at every width: one in the last lane and one on the bench when the
// case has them, then others drawn at random.
function chooseHovers(rand, snapshot) {
  const chosen = []
  const add = (a) => { if (a && !chosen.includes(a) && chosen.length < 3) chosen.push(a) }
  const last = lastLaneAgents(snapshot)
  const bench = benchAgents(snapshot)
  if (last.length > 0) add(last[Math.floor(rand() * last.length)])
  if (bench.length > 0) add(bench[Math.floor(rand() * bench.length)])
  const rest = snapshot.agents.filter((a) => !chosen.includes(a))
  while (chosen.length < 3 && rest.length > 0) add(rest.splice(Math.floor(rand() * rest.length), 1)[0])
  return chosen.map((a) => a.id)
}

// One painted frame, kept as row texts: a row's text is its runs' text joined, so checking it is
// checking every run. A hovered frame shares the plain frame's string for every row the card
// left alone, which keeps the cache several times smaller.
function frameOf(snapshot, hovered, width, plain = null) {
  const out = paint(snapshot, { positions: {}, frame: 0, hovered }, width)
  const texts = out.rows.map((row, y) => {
    const text = rowText(row)
    return plain && plain.texts[y] === text ? plain.texts[y] : text
  })
  return { texts, height: out.height, rowCount: out.rows.length }
}

let sweep = null

// Paints every frame once; the four property tests share the result.
before(() => {
  const started = performance.now()
  const rand = mulberry32(SEED)
  const cases = []
  let painted = 0
  for (let index = 0; index < CASES; index++) {
    const snapshot = generate(rand, index)
    const some = chooseHovers(rand, snapshot)
    const widths = []
    for (let width = MIN_WIDTH; width <= MAX_WIDTH; width++) {
      const columns = layout(snapshot, width).columns
      const plain = frameOf(snapshot, null, width)
      const ids = FULL_HOVER_WIDTHS.has(width) ? snapshot.agents.map((a) => a.id) : some
      const hovered = ids.map((id) => ({ id, frame: frameOf(snapshot, id, width, plain) }))
      painted += 1 + hovered.length
      widths.push({ width, columns, plain, hovered })
    }
    cases.push({ index, snapshot, some, widths })
  }
  const ms = performance.now() - started
  sweep = { cases, painted, ms }
  assert.ok(ms < BUDGET_MS, `painting the sweep took ${Math.round(ms)} ms, over the ${BUDGET_MS} ms budget`)
}, { timeout: BUDGET_MS })

function* allFrames() {
  for (const c of sweep.cases) {
    for (const w of c.widths) {
      yield { c, w, frame: w.plain, hovered: null }
      for (const h of w.hovered) yield { c, w, frame: h.frame, hovered: h.id }
    }
  }
}

test('every row of every frame is exactly as wide as the laid-out pane', { timeout: BUDGET_MS }, (t) => {
  t.diagnostic(`seed ${SEED}: ${sweep.cases.length} cases, ${sweep.painted} frames painted in ${Math.round(sweep.ms)} ms`)
  for (const { c, w, frame, hovered } of allFrames()) {
    if (frame.height !== frame.rowCount) {
      assert.fail(where(c, w.width, `hovered ${hovered}: height ${frame.height} but ${frame.rowCount} rows`))
    }
    for (let y = 0; y < frame.texts.length; y++) {
      const got = cells(frame.texts[y])
      if (got !== w.columns) {
        assert.fail(where(c, w.width, `hovered ${hovered}: row ${y} is ${got} cells, want ${w.columns}: ${show(frame.texts[y])}`))
      }
    }
  }
})

test('no frame carries a control character', { timeout: BUDGET_MS }, () => {
  for (const { c, w, frame, hovered } of allFrames()) {
    for (let y = 0; y < frame.texts.length; y++) {
      if (CONTROL.test(frame.texts[y])) {
        assert.fail(where(c, w.width, `hovered ${hovered}: control character in row ${y}: ${show(frame.texts[y])}`))
      }
    }
  }
})

test('every worked ticket has a chip in its agent\'s lane, and chips stay apart and on the board', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    const onBoard = new Set(c.snapshot.lanes.map((l) => l.key).filter((k) => k !== 'bench'))
    for (const { width } of c.widths) {
      const plan = layout(c.snapshot, width)
      for (const agent of c.snapshot.agents) {
        if (agent.ticket == null || !onBoard.has(agent.lane)) continue
        const lane = plan.lanes.find((l) => l.key === agent.lane && l.total != null)
        if (!lane || !lane.chips.some((chip) => chip.id === agent.ticket)) {
          assert.fail(where(c, width, `${agent.id} works ${show(agent.ticket)} but lane ${agent.lane} has no chip for it`))
        }
      }
      const chips = plan.lanes.flatMap((l) => l.chips)
      for (const chip of chips) {
        if (chip.x < 0 || chip.x + chip.w > plan.columns || chip.y < 0 || chip.y >= plan.rows) {
          assert.fail(where(c, width, `chip ${show(chip)} leaves the ${plan.columns}x${plan.rows} board`))
        }
      }
      for (let i = 0; i < chips.length; i++) {
        for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i]
          const b = chips[j]
          if (a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w) {
            assert.fail(where(c, width, `chips overlap: ${show(a)} and ${show(b)}`))
          }
        }
      }
      for (const lane of plan.lanes) {
        const want = lane.total == null ? 0 : lane.total - lane.chips.length
        if (lane.more !== want) {
          assert.fail(where(c, width, `lane ${lane.key} says +${lane.more} more, want ${want}`))
        }
      }
    }
  }
})

test('the hover card shows every line and never changes the frame height', { timeout: BUDGET_MS }, () => {
  for (const c of sweep.cases) {
    const byId = new Map(c.snapshot.agents.map((a) => [a.id, a]))
    for (const w of c.widths) {
      for (const h of w.hovered) {
        if (h.frame.rowCount !== w.plain.rowCount || h.frame.height !== w.plain.height) {
          assert.fail(where(c, w.width, `hovering ${h.id} changed the row count from ${w.plain.rowCount} to ${h.frame.rowCount}`))
        }
        const agent = byId.get(h.id)
        const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
        const lines = cardLines(agent, role.label, c.snapshot.now)
        for (let i = 0; i < lines.length; i++) {
          let want = safe(lines[i])
          if (cells(want) > w.columns - 2) want = clipCells(want, w.columns - 2)
          if (want === '') continue
          if (!h.frame.texts.some((text) => text.includes(want))) {
            assert.fail(where(c, w.width, `hovering ${h.id}: card line ${i} ${show(want)} is not on the frame`))
          }
        }
      }
    }
  }
})

test('the generator really draws the hard boards', { timeout: BUDGET_MS }, () => {
  const seen = {
    'a lane with more worked tickets than fit its usual rows at width 20': false,
    'an id that is empty once made safe': false,
    'the same id in two lanes': false,
    'an agent on a lane the board does not show': false,
    'an agent in the last lane': false,
    'a wide, hostile name on a hover card': false,
    'the empty board': false,
    'all six lanes': false,
  }
  const perRow = Math.max(1, Math.floor((layout({ lanes: [], agents: [] }, 20).columns - 1) / (CHIP_W + 1)))
  for (const c of sweep.cases) {
    const { lanes, agents } = c.snapshot
    const worked = new Set(agents.map((a) => a.ticket).filter((t) => t != null))
    const keys = new Set(lanes.map((l) => l.key))
    if (lanes.length === 0 && agents.length === 0) seen['the empty board'] = true
    if (LANES.every((l) => keys.has(l.key))) seen['all six lanes'] = true
    const lanesOfId = new Map()
    for (const lane of lanes) {
      const cap = lane.key === 'done' ? 1 : 2
      const busy = new Set(lane.tickets.filter((t) => worked.has(t.id)).map((t) => t.id))
      if (busy.size > perRow * cap) seen['a lane with more worked tickets than fit its usual rows at width 20'] = true
      for (const t of lane.tickets) {
        if (safe(t.id) === '') seen['an id that is empty once made safe'] = true
        if (!lanesOfId.has(t.id)) lanesOfId.set(t.id, new Set())
        lanesOfId.get(t.id).add(lane.key)
      }
    }
    if ([...lanesOfId.values()].some((s) => s.size > 1)) seen['the same id in two lanes'] = true
    if (agents.some((a) => a.lane != null && a.lane !== 'bench' && !keys.has(a.lane))) seen['an agent on a lane the board does not show'] = true
    if (lastLaneAgents(c.snapshot).length > 0) seen['an agent in the last lane'] = true
    const hovered = c.some.map((id) => agents.find((a) => a.id === id))
    const hostileName = (name) => [...name].some(isWide) && (CONTROL.test(name) || ZERO_WIDTH.test(name))
    if (hovered.some((a) => hostileName(a.name))) seen['a wide, hostile name on a hover card'] = true
  }
  const missing = Object.keys(seen).filter((k) => !seen[k])
  assert.deepEqual(missing, [], `seed ${SEED} never drew: ${missing.join('; ')}`)
  assert.ok(sweep.cases.length >= 40)
})
