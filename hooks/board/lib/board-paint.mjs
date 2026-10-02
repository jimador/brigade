// Draws one frame of the task board in character cells: the project header and its context meter,
// the five lanes of ticket cards, the agents as pixel sprites on the cards they work, the crew, the
// Messages and Learnings panels, the legend, the hover card and the detail box. Where everything
// goes comes from the layout; this file only decides how it looks. The result is rows of coloured
// text runs a pane can print as they are, plus the click regions that match what was drawn.

import { arrange } from './board-layout.mjs'
import { createCanvas, putText, putSprite, toRuns, cellWidth, clip, safeText } from './canvas.mjs'
import { SPRITES, sizeOf, ROLES, PALETTE, FAMILIES, CLOUD, colorOf } from './sprites.mjs'
import { gauge } from './weather.mjs'
import { cardLines } from './stage.mjs'

const ROUND = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }
const DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' }
const GAUGE_W = 10

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function isCell(p) {
  return isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y)
}

// An id the way the layout keeps it, so a lookup from the view matches what the layout handed back.
function idOf(value) {
  return typeof value === 'string' || typeof value === 'number' ? safeText(String(value)) : null
}

// A box outline `w` by `h` at (x, y) in one colour. The inside is left alone.
function putBox(canvas, x, y, w, h, edges, style) {
  if (w < 2 || h < 2) return
  const across = edges.h.repeat(w - 2)
  putText(canvas, x, y, edges.tl + across + edges.tr, style)
  putText(canvas, x, y + h - 1, edges.bl + across + edges.br, style)
  for (let row = y + 1; row < y + h - 1; row++) {
    putText(canvas, x, row, edges.v, style)
    putText(canvas, x + w - 1, row, edges.v, style)
  }
}

// Paints the inside of a box (everything but its border) with blanks in `bg`.
function fillInside(canvas, x, y, w, h, bg) {
  if (w < 3 || h < 3) return
  const blank = ' '.repeat(w - 2)
  for (let row = y + 1; row < y + h - 1; row++) putText(canvas, x + 1, row, blank, { color: bg, backgroundColor: bg })
}

// The colour of one cloud pixel: '#' is cloud, '*' is lightning, anything else is empty.
function cloudColor(pixel) {
  if (pixel === '#') return PALETTE.ink
  if (pixel === '*') return PALETTE.bolt
  return null
}

// The cloud, one cell at a time. A cell holds two pixels stacked, and the cloud has two colours,
// so a cell with cloud on top and lightning below needs both a foreground and a background.
function paintCloud(canvas, x, y) {
  for (let p = 0; p < CLOUD.length; p += 2) {
    const upper = CLOUD[p] ?? ''
    const lower = CLOUD[p + 1] ?? ''
    for (let i = 0; i < Math.max(upper.length, lower.length); i++) {
      const top = cloudColor(upper[i])
      const bottom = cloudColor(lower[i])
      if (top === null && bottom === null) continue
      let cell
      if (top !== null && top === bottom) cell = ['█', { color: top, backgroundColor: PALETTE.field }]
      else if (bottom === null) cell = ['▀', { color: top, backgroundColor: PALETTE.field }]
      else if (top === null) cell = ['▄', { color: bottom, backgroundColor: PALETTE.field }]
      else cell = ['▀', { color: top, backgroundColor: bottom }]
      putText(canvas, x + i, y + p / 2, cell[0], cell[1])
    }
  }
}

// The gauge and percent colour: calm below half full, a warning from half, alarm from three quarters.
function bandColor(percent) {
  if (percent >= 75) return PALETTE.alert
  if (percent >= 50) return PALETTE.bolt
  return PALETTE.header
}

// The context meter: the cloud, `Context 61%` on row 0 and its gauge on row 1. With no reading it
// says `Context --` and draws no gauge. It never names the weather.
function paintMeter(canvas, meter, weather) {
  if (meter.icon) paintCloud(canvas, meter.icon.x, meter.y)
  const raw = isObject(weather) ? weather.percent : null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    putText(canvas, meter.text.x, meter.y, 'Context --', { color: PALETTE.dim })
    return
  }
  const percent = Math.round(Math.min(100, Math.max(0, raw)))
  const color = bandColor(percent)
  putText(canvas, meter.text.x, meter.y, 'Context ', { color: PALETTE.ink })
  putText(canvas, meter.text.x + 8, meter.y, `${percent}%`, { color })
  putText(canvas, meter.text.x, meter.y + 1, gauge(percent, GAUGE_W), { color })
}

function paintHeader(canvas, header, weather) {
  putText(canvas, 0, header.y, header.repo, { color: PALETTE.dim })
  putText(canvas, 0, header.y + 1, header.title, { color: PALETTE.ink, bold: true })
  putText(canvas, 0, header.y + 2, header.detail, { color: PALETTE.dim })
  paintMeter(canvas, header.meter, weather)
}

// A slot's name and activity lines. On a card they keep the card's background.
function paintSlotText(canvas, slot, hovered, bg) {
  putText(canvas, slot.name.x, slot.name.y, slot.name.text, { color: PALETTE.ink, backgroundColor: bg, bold: slot.agentId === hovered })
  putText(canvas, slot.activity.x, slot.activity.y, slot.activity.text, { color: PALETTE.dim, backgroundColor: bg })
}

// One card: a rounded border, the card colour inside, the id, the title, the tag as a pill, and the
// name and activity of each agent on it. The border lights up when the pointer is over the card.
function paintCard(canvas, card, view) {
  const edge = card.id === view.over ? PALETTE.ink : card.alert ? PALETTE.alert : PALETTE.cardEdge
  fillInside(canvas, card.x, card.y, card.w, card.h, PALETTE.card)
  putBox(canvas, card.x, card.y, card.w, card.h, ROUND, { color: edge, backgroundColor: PALETTE.field })
  const x = card.x + 1
  const room = card.w - 2
  const onCard = { backgroundColor: PALETTE.card }
  putText(canvas, x, card.y + 1, card.idText, { ...onCard, color: PALETTE.dim })
  card.titleLines.forEach((line, i) => putText(canvas, x, card.y + 2 + i, line, { ...onCard, color: PALETTE.ink }))
  if (card.tag !== null) {
    // A space either side when there is room, so the pill reads as a pill.
    const pill = cellWidth(card.tag) + 2 <= room ? ` ${card.tag} ` : card.tag
    putText(canvas, x, card.y + 2 + card.titleLines.length, pill, {
      color: PALETTE.field, backgroundColor: card.alert ? PALETTE.alert : PALETTE.dim,
    })
  }
  for (const slot of card.slots) paintSlotText(canvas, slot, view.hovered, PALETTE.card)
}

// A lane: its header row, its cards stacked under it, and `+N more` when it holds more than it shows.
function paintLane(canvas, lane, view) {
  const shouting = lane.key === 'rework' && lane.total > 0
  putText(canvas, lane.x, lane.y, clip(`${lane.title} ${lane.total}`, lane.w), { color: shouting ? PALETTE.alert : PALETTE.header })
  for (const card of lane.cards) paintCard(canvas, card, view)
  if (lane.more > 0) {
    const y = lane.y + 1 + lane.cards.reduce((sum, card) => sum + card.h, 0)
    putText(canvas, lane.x, y, clip(`+${lane.more} more`, lane.w), { color: PALETTE.dim })
  }
}

function paintCrew(canvas, crew, view) {
  if (!crew) return
  putText(canvas, 0, crew.y, 'Crew', { color: PALETTE.dim })
  for (const slot of crew.slots) paintSlotText(canvas, slot, view.hovered, undefined)
}

// A panel's rounded border with its title set into the top edge.
function paintPanel(canvas, panel, title) {
  putBox(canvas, panel.x, panel.y, panel.w, panel.h, ROUND, { color: PALETTE.cardEdge })
  putText(canvas, panel.x + 2, panel.y, clip(` ${title} `, panel.w - 4), { color: PALETTE.header })
}

function paintMessages(canvas, panel, view) {
  paintPanel(canvas, panel, 'Messages')
  const x = panel.x + 2
  if (panel.rows.length === 0) {
    putText(canvas, x, panel.y + 1, clip('No messages yet', panel.w - 4), { color: PALETTE.dim })
    return
  }
  for (const row of panel.rows) {
    const over = row.id === view.over
    putText(canvas, x, row.y, row.head, { color: PALETTE.ink, bold: true })
    putText(canvas, x, row.y + 1, row.text, over ? { color: PALETTE.ink, bold: true } : { color: PALETTE.dim })
  }
}

function paintLearnings(canvas, panel) {
  paintPanel(canvas, panel, 'Learnings in play')
  const x = panel.x + 2
  const room = panel.w - 4
  if (panel.lines.length === 0 && panel.more <= 0) {
    putText(canvas, x, panel.y + 1, clip('None recorded', room), { color: PALETTE.dim })
    return
  }
  panel.lines.forEach((line, i) => putText(canvas, x, panel.y + 1 + i, line, { color: PALETTE.ink }))
  if (panel.more > 0) putText(canvas, x, panel.y + 1 + panel.lines.length, clip(`+${panel.more} more`, room), { color: PALETTE.dim })
}

// The legend in dim, then each family word again in its own colour.
function paintLegend(canvas, legend) {
  putText(canvas, legend.x, legend.y, legend.text, { color: PALETTE.dim })
  for (const span of legend.spans) {
    const family = FAMILIES.find((f) => f.key === span.family)
    if (family) putText(canvas, span.x, legend.y, family.label, { color: family.color })
  }
}

// Where the hover card's top-left corner goes: above the sprite when there is room, else below it,
// else beside it (right when it fits, otherwise left), always pulled inside the canvas.
function hoverSpot(canvas, box, cardW, cardH) {
  const across = Math.max(0, Math.min(box.x, canvas.columns - cardW))
  if (box.y - cardH >= 0) return { x: across, y: box.y - cardH }
  const below = box.y + box.h
  if (below + cardH <= canvas.rows) return { x: across, y: below }
  const right = box.x + box.w + 1
  const x = right + cardW <= canvas.columns ? right : Math.max(0, Math.min(box.x - 1 - cardW, canvas.columns - cardW))
  const y = Math.max(0, Math.min(box.y, canvas.rows - cardH))
  return { x, y }
}

// The hover card: four lines on a light block, every line padded to the same width so the card is
// a clean rectangle, and cut at the right edge when the pane is narrower than the card.
function paintHover(canvas, agent, box, now) {
  const role = Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
  const lines = cardLines(agent, role.label, now).map((line) => safeText(line ?? ''))
  const cardW = Math.max(...lines.map(cellWidth)) + 2
  const spot = hoverSpot(canvas, box, cardW, lines.length)
  const room = Math.min(cardW, canvas.columns - spot.x)
  lines.forEach((line, i) => {
    const shown = clip(` ${line}`, room)
    putText(canvas, spot.x, spot.y + i, shown + ' '.repeat(room - cellWidth(shown)), {
      color: PALETTE.field, backgroundColor: PALETTE.ink,
    })
  })
}

// The detail box: a filled card-coloured box with a double border, its title, [x] and its lines.
function paintModal(canvas, modal) {
  const { x, y, w, h } = modal
  fillInside(canvas, x, y, w, h, PALETTE.card)
  putBox(canvas, x, y, w, h, DOUBLE, { color: PALETTE.ink, backgroundColor: PALETTE.card })
  putText(canvas, x + w - 4, y, '[x]', { color: PALETTE.header, backgroundColor: PALETTE.card })
  putText(canvas, x + 2, y + 1, modal.title, { color: PALETTE.ink, backgroundColor: PALETTE.card, bold: true })
  modal.lines.forEach((line, i) => putText(canvas, x + 2, y + 3 + i, line, { color: PALETTE.ink, backgroundColor: PALETTE.card }))
}

// The agents by the id the layout gave them, the first listed winning, as the layout does.
function agentsById(snapshot) {
  const byId = new Map()
  for (const agent of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
    if (!isObject(agent)) continue
    const id = idOf(agent.id)
    if (id !== null && !byId.has(id)) byId.set(id, agent)
  }
  return byId
}

/**
 * Draws one frame of the task board.
 * @param snapshot the board state: project, lanes, agents, weather, messages, learnings, detail, now
 * @param view what is moving and under the pointer: { positions, frame, hovered, over }
 * @param columns how wide the pane is
 * @return { rows, regions, height }: coloured runs per row, click regions (sprites after the cards
 *   and messages, before the detail box's, each with the frame it was drawn on), and the row count
 */
export function draw(snapshot, view, columns) {
  const snap = isObject(snapshot) ? snapshot : {}
  const v = isObject(view) ? view : {}
  const positions = isObject(v.positions) ? v.positions : {}
  const frame = v.frame === 1 ? 1 : 0
  const look = { hovered: idOf(v.hovered), over: idOf(v.over) }
  const plan = arrange(snap, columns)
  const canvas = createCanvas(plan.columns, plan.rows, PALETTE.field)

  paintHeader(canvas, plan.header, snap.weather)
  for (const lane of plan.lanes) paintLane(canvas, lane, look)
  paintCrew(canvas, plan.crew, look)
  paintMessages(canvas, plan.messages, look)
  paintLearnings(canvas, plan.learnings)
  paintLegend(canvas, plan.legend)

  // Sprites go on after everything else so nothing hides them, each where it is walking or at home.
  // Movement on the board means something happened, so a sprite settled at home stands still on
  // frame 0 and only a walking one shows the view's frame.
  const agents = agentsById(snap)
  const sprites = []
  for (const [id, home] of Object.entries(plan.homes)) {
    const agent = agents.get(id)
    if (!agent) continue
    const live = Object.hasOwn(positions, id) && isCell(positions[id]) ? positions[id] : home
    const box = { x: Math.floor(live.x), y: Math.floor(live.y), w: home.w, h: home.h }
    const shown = box.x === home.x && box.y === home.y ? 0 : frame
    putSprite(canvas, box.x, box.y, SPRITES[sizeOf(agent.model)][shown], colorOf(agent.role, agent.state, agent.model))
    sprites.push({ kind: 'agent', id, ...box, frame: shown })
  }

  if (look.hovered !== null) {
    const agent = agents.get(look.hovered)
    const box = sprites.find((s) => s.id === look.hovered)
    if (agent && box) paintHover(canvas, agent, box, snap.now)
  }

  if (plan.modal) paintModal(canvas, plan.modal)

  // Sprites sit above the cards under them for clicks, and below the detail box.
  const firstClose = plan.regions.findIndex((r) => r.kind === 'close')
  const at = firstClose === -1 ? plan.regions.length : firstClose
  const regions = [...plan.regions.slice(0, at), ...sprites, ...plan.regions.slice(at)]

  return { rows: toRuns(canvas), regions, height: canvas.rows }
}
