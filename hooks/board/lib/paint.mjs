// Draws one frame of the board: the title and weather rows, each lane with its ticket chips,
// the agent sprites with their name tags, and the hover card on top. The result is rows of
// coloured text runs that a pane can print as they are.

import { createCanvas, putText, putSprite, toRuns, cellWidth, clip } from './canvas.mjs'
import { layout } from './layout.mjs'
import { SPRITES, PALETTE, ROLES, sizeOf, colorOf } from './sprites.mjs'
import { gauge } from './weather.mjs'
import { cardLines } from './stage.mjs'

// Where text starts so that it ends one cell short of the right edge, the same margin the
// title keeps on the left.
function rightX(columns, text) {
  return Math.max(0, columns - 1 - cellWidth(text))
}

function hasReading(weather) {
  return weather != null && typeof weather.percent === 'number' && Number.isFinite(weather.percent)
}

// Rows 0 and 1: the title on the left, the weather reading and its gauge on the right.
function paintHeadsUp(canvas, weather) {
  putText(canvas, 1, 0, 'BRIGADE', { color: PALETTE.header, bold: true })
  if (!hasReading(weather)) {
    const text = '· NO READING'
    putText(canvas, rightX(canvas.columns, text), 0, text, { color: PALETTE.dim })
    return
  }
  const text = `${weather.glyph} ${weather.label} ${weather.percent}%`
  const color = weather.level === 4 ? PALETTE.alert : PALETTE.ink
  putText(canvas, rightX(canvas.columns, text), 0, text, { color })
  const bar = gauge(weather.percent, 10)
  putText(canvas, rightX(canvas.columns, bar), 1, bar, { color: PALETTE.header })
}

// One ticket chip: a stripe in the ticket kind's colour, then the id on a light background.
function paintChip(canvas, chip, busy) {
  const kinds = PALETTE.kinds ?? {}
  const stripe = Object.hasOwn(kinds, chip.kind) ? kinds[chip.kind] : PALETTE.dim
  putText(canvas, chip.x, chip.y, '▌', { color: stripe, backgroundColor: PALETTE.chip })
  const room = Math.max(0, chip.w - 1)
  const label = clip(chip.id ?? '', room)
  const text = label + ' '.repeat(room - cellWidth(label))
  putText(canvas, chip.x + 1, chip.y, text, {
    color: PALETTE.chipInk,
    backgroundColor: PALETTE.chip,
    bold: busy.has(chip.id),
  })
}

// A lane's header row, its overflow count, and its chips.
function paintLane(canvas, lane, busy) {
  // A lane with no ticket count, like the bench, shows just its title.
  const header = lane.total == null ? `▌${lane.title}` : `▌${lane.title} ${lane.total}`
  const alert = lane.key === 'blocked' && lane.total > 0
  putText(canvas, 0, lane.y, header, { color: alert ? PALETTE.alert : PALETTE.header })
  if (lane.more > 0) {
    putText(canvas, cellWidth(header) + 1, lane.y, `+${lane.more}`, { color: PALETTE.dim })
  }
  for (const chip of lane.chips) paintChip(canvas, chip, busy)
}

// Where the hover card's top-left corner goes. Above the sprite when there's room, else below
// its name tag when every line fits, else beside the sprite (right if it fits, otherwise left)
// with its top pulled in so no line falls off the canvas. The canvas never grows for a card.
function cardSpot(canvas, region, cardW, cardH) {
  const across = Math.max(0, Math.min(region.x, canvas.columns - cardW))
  if (region.y - cardH >= 0) return { x: across, y: region.y - cardH }
  const below = region.y + region.h + 1
  if (below + cardH <= canvas.rows) return { x: across, y: below }
  const right = region.x + region.w + 1
  const x = right + cardW <= canvas.columns ? right : Math.max(0, region.x - 1 - cardW)
  const y = Math.max(0, Math.min(region.y, canvas.rows - cardH))
  return { x, y }
}

// The hover card: four lines on a light block. Every line is padded in cells to the same width,
// so the card is a clean rectangle, and cut short at the right edge when the pane is narrower.
function paintCard(canvas, agent, region, now) {
  const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
  const lines = cardLines(agent, role.label, now).map((line) => String(line ?? ''))
  const cardW = Math.max(...lines.map(cellWidth)) + 2
  const spot = cardSpot(canvas, region, cardW, lines.length)
  const room = Math.min(cardW, canvas.columns - spot.x)
  lines.forEach((line, i) => {
    const shown = clip(` ${line}`, room)
    const text = shown + ' '.repeat(room - cellWidth(shown))
    putText(canvas, spot.x, spot.y + i, text, { color: PALETTE.field, backgroundColor: PALETTE.ink })
  })
}

/**
 * Draws one frame of the board.
 * @param snapshot the board state: { lanes, agents, weather, selected, now }; weather may be null
 * @param view what's moving: { positions, frame, hovered }
 * @param columns how wide the pane is
 * @return { rows, regions, height }: the coloured runs, one hit box per sprite, and the row count
 */
export function paint(snapshot, view, columns) {
  const snap = snapshot ?? {}
  const v = view ?? {}
  const agents = snap.agents ?? []
  const positions = v.positions ?? {}
  const frame = v.frame === 1 ? 1 : 0
  const plan = layout(snap, columns)
  const canvas = createCanvas(plan.columns, plan.rows, PALETTE.field)

  paintHeadsUp(canvas, snap.weather)

  const busy = new Set(agents.map((a) => a.ticket).filter((t) => t != null))
  for (const lane of plan.lanes) paintLane(canvas, lane, busy)

  const regions = []
  for (const agent of agents) {
    const home = plan.homes[agent.id]
    if (!home) continue
    const at = Object.hasOwn(positions, agent.id) && positions[agent.id] ? positions[agent.id] : home
    putSprite(canvas, at.x, at.y, SPRITES[sizeOf(agent.model)][frame], colorOf(agent.role, agent.state))
    putText(canvas, at.x, at.y + home.h, home.tag, {
      color: PALETTE.ink,
      bold: agent.id === snap.selected,
    })
    regions.push({ id: agent.id, x: at.x, y: at.y, w: home.w, h: home.h })
  }

  if (v.hovered != null) {
    const agent = agents.find((a) => a.id === v.hovered)
    const region = regions.find((r) => r.id === v.hovered)
    if (agent && region) paintCard(canvas, agent, region, snap.now)
  }

  return { rows: toRuns(canvas), regions, height: canvas.rows }
}
