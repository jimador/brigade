// Works out where everything on the board sits for a pane of a given width: each lane's header
// row, its ticket chips, and where each agent's sprite stands. It only places things; drawing
// happens elsewhere.

import { SIZES, sizeOf, ROLES } from './sprites.mjs'
import { cellWidth } from './canvas.mjs'

// How many cells wide a ticket chip is.
export const CHIP_W = 14

// The two rows at the top hold the title and the weather line, so lanes start below them.
const FIRST_LANE_Y = 2
// Narrowest pane we lay out for; anything smaller is treated as this wide.
const MIN_COLUMNS = 24
// Cells between neighbouring sprite slots.
const SPRITE_GAP = 2

const BENCH = { key: 'bench', title: 'BENCH', total: 0, tickets: [] }

// The name tag under a sprite: the role's mark, a space, then the agent's name.
function tagOf(agent) {
  // Own keys only, so a role like 'toString' can't pick up an Object method.
  const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
  return `${role.mark} ${agent.name}`
}

// Lays out ticket chips row by row from x = 1, and says how many tickets didn't fit. Tickets
// someone is working go first, in their own order, and the lane grows past its usual row cap
// when that's what it takes to show every one of them.
function placeChips(lane, top, columns, worked) {
  const perRow = Math.max(1, Math.floor((columns - 1) / (CHIP_W + 1)))
  const cap = lane.key === 'done' ? 1 : 2
  const all = lane.tickets ?? []
  const busy = all.filter((t) => worked.has(t.id))
  const tickets = [...busy, ...all.filter((t) => !worked.has(t.id))]
  const maxRows = Math.max(cap, Math.ceil(busy.length / perRow))
  const shown = Math.min(tickets.length, perRow * maxRows)
  const chips = []
  for (let i = 0; i < shown; i++) {
    const t = tickets[i]
    chips.push({
      id: t.id,
      kind: t.kind,
      x: 1 + (i % perRow) * (CHIP_W + 1),
      y: top + Math.floor(i / perRow),
      w: CHIP_W,
    })
  }
  return { chips, rowCount: Math.ceil(shown / perRow), more: lane.total - shown }
}

// Puts agents into sprite rows starting at `top` and returns their homes and the rows used.
// Agents working a ticket shown in this lane go first, sorted by where their chip sits, and the
// first agent on each ticket tries to stand under its chip.
function placeSprites(agents, order, chips, top, columns) {
  const chipX = new Map(chips.map((c) => [c.id, c.x]))
  const working = agents.filter((a) => chipX.has(a.ticket))
  const idle = agents.filter((a) => !chipX.has(a.ticket))
  // Sort is stable, but say the tie-break out loud: snapshot order.
  working.sort((a, b) => chipX.get(a.ticket) - chipX.get(b.ticket) || order.get(a) - order.get(b))

  // The right edge leaves one blank cell, the same margin chips keep.
  const limit = columns - 1
  const rows = [[]]
  const claimed = new Set()
  let cursor = 1
  for (const agent of [...working, ...idle]) {
    const size = SIZES[sizeOf(agent.model)]
    const tag = tagOf(agent)
    const slot = Math.max(size.w, cellWidth(tag))
    let want = 1
    if (chipX.has(agent.ticket) && !claimed.has(agent.ticket)) {
      claimed.add(agent.ticket)
      want = chipX.get(agent.ticket)
    }
    let x = Math.max(cursor, want)
    if (x + slot > limit && rows.at(-1).length > 0) {
      rows.push([])
      cursor = 1
      x = Math.max(cursor, want)
    }
    // Still no room under the chip, so take the leftmost free spot instead.
    if (x + slot > limit) x = cursor
    rows.at(-1).push({ agent, x, w: size.w, h: size.h, tag })
    cursor = x + slot + SPRITE_GAP
  }

  const homes = {}
  let y = top
  for (const row of rows) {
    if (row.length === 0) continue
    const tallest = Math.max(...row.map((s) => s.h))
    // Bottom-align every sprite so they all stand on the same line, tag row just below.
    const baseline = y + tallest
    for (const s of row) homes[s.agent.id] = { x: s.x, y: baseline - s.h, w: s.w, h: s.h, tag: s.tag }
    y += tallest + 1
  }
  return { homes, rowCount: y - top }
}

// Turns a board snapshot into positions for a pane `columns` cells wide.
export function layout(snapshot, columns) {
  const width = Number.isFinite(columns) ? Math.max(MIN_COLUMNS, Math.floor(columns)) : MIN_COLUMNS
  const sourceLanes = snapshot?.lanes ?? []
  const agents = snapshot?.agents ?? []
  const order = new Map(agents.map((a, i) => [a, i]))
  const worked = new Set(agents.map((a) => a.ticket).filter((t) => t != null))

  // Agents whose lane is missing, 'bench', or unknown wait on a bench lane at the top.
  const known = new Set(sourceLanes.map((l) => l.key).filter((k) => k !== 'bench'))
  const standing = new Map()
  for (const agent of agents) {
    const key = agent.lane != null && known.has(agent.lane) ? agent.lane : BENCH.key
    if (!standing.has(key)) standing.set(key, [])
    standing.get(key).push(agent)
  }
  const lanes = standing.has(BENCH.key) ? [BENCH, ...sourceLanes] : sourceLanes

  const out = []
  const homes = {}
  let y = FIRST_LANE_Y
  for (const lane of lanes) {
    const header = y
    const chips = placeChips(lane, header + 1, width, worked)
    y = header + 1 + chips.rowCount
    // Only the added bench takes bench agents, never a snapshot lane that happens to be keyed 'bench'.
    const here = lane.key === BENCH.key && lane !== BENCH ? [] : standing.get(lane.key) ?? []
    if (here.length > 0) {
      const sprites = placeSprites(here, order, chips.chips, y, width)
      Object.assign(homes, sprites.homes)
      y += sprites.rowCount
    }
    // The bench holds agents, not tickets, so it has no ticket count to show.
    const total = lane === BENCH ? null : lane.total
    out.push({ key: lane.key, title: lane.title, total, y: header, chips: chips.chips, more: chips.more })
    // One blank row before the next lane.
    y += 1
  }

  return { columns: width, rows: y, lanes: out, homes }
}
