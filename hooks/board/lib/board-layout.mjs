// Works out where everything on the task board goes, in character cells, for a pane of a given
// width: the header and its context meter, the five lanes of cards with the agents working them,
// the crew standing aside, the Messages and Learnings panels, the legend and the detail box.
// It only places things and clips their text to fit; drawing happens elsewhere.
//
// Every string it hands back has been through safeText and fits the cells it was given, because
// ids, titles, names and messages all come from files. Ids too: a card, lane, agent or message id
// comes back in its safe form, and agents are matched to cards on that form. So the painter looks
// an agent up as homes[safeText(id)], and two ids that differ only by a control character or an
// invisible mark are the same id to the board.

import { SIZES, sizeOf, ROLES, FAMILIES } from './sprites.mjs'
import { cellWidth, clip, safeText } from './canvas.mjs'

// Narrowest pane we lay out for; anything smaller is treated as this wide.
const MIN_COLUMNS = 24
// Header rows 0 to 2, a blank row 3, then the lanes.
const LANES_TOP = 4
// The context meter: an 8-cell cloud, a space, then 12 cells of text with the gauge under it.
const METER_W = 21
const METER_TEXT_W = 12
const ICON_W = 8
// Below this the meter drops its cloud.
const METER_ICON_MIN = 40
// The header text stops this many cells short of the meter.
const METER_GAP = 2
const LANE_MAX_W = 30
const MAX_LANES_PER_ROW = 5
// Below this the two panels stack instead of sitting side by side.
const PANELS_SIDE_MIN = 70
const MAX_MESSAGES = 4
const MAX_LEARNINGS = 5
const MODAL_MAX_W = 72
// A board showing the detail box is never shorter than this, so the box has room to say something.
const MODAL_MIN_ROWS = 12
// Cells between slots side by side in the crew, which has the whole width to use.
const CREW_SLOT_GAP = 2
// Blank rows between one row of crew slots and the next, so sprites in different rows never touch.
const CREW_ROW_GAP = 1
const ELLIPSIS = '…'

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function list(value) {
  return Array.isArray(value) ? value : []
}

// Outside values as text: strings as they are, numbers and booleans spelled out, anything else empty.
function text(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

// An id as the board keeps it: its text made safe, like every other string handed back.
function idOf(value) {
  return safeText(text(value))
}

function widthOf(columns) {
  return typeof columns === 'number' && Number.isFinite(columns) ? Math.max(MIN_COLUMNS, Math.floor(columns)) : MIN_COLUMNS
}

// Breaks a word too wide for a whole line into line-sized pieces, one walk over its characters.
function pieces(word, width) {
  const out = []
  let piece = ''
  let used = 0
  for (const ch of word) {
    const w = cellWidth(ch)
    // A character wider than the whole line can never be drawn, so it is left out.
    if (w > width) continue
    if (used + w > width) {
      out.push(piece)
      piece = ''
      used = 0
    }
    piece += ch
    used += w
  }
  if (piece !== '') out.push(piece)
  return out
}

// The safe form of `value` broken into lines at most `width` cells wide, at spaces where it can
// be, and inside a word only when the word alone is wider than a line. Stops once it has `limit`
// lines plus one, which is enough to know the text was cut.
function wrap(value, width, limit = Infinity) {
  const lines = []
  let line = ''
  let used = 0
  for (const word of safeText(value).split(' ')) {
    if (lines.length > limit) break
    if (word === '') continue
    const w = cellWidth(word)
    if (line !== '' && used + 1 + w <= width) {
      line += ` ${word}`
      used += 1 + w
      continue
    }
    if (line !== '') lines.push(line)
    if (w <= width) {
      line = word
      used = w
      continue
    }
    const parts = pieces(word, width)
    line = parts.pop() ?? ''
    used = cellWidth(line)
    lines.push(...parts)
  }
  if (line !== '') lines.push(line)
  return lines
}

// At most `max` wrapped lines; when there were more, the last kept line takes as much of the rest
// as fits and ends in '…' so a reader can see the text goes on.
function fitLines(value, width, max) {
  const lines = wrap(value, width, max)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max - 1)
  kept.push(clip(lines.slice(max - 1).join(' '), width - 1).trimEnd() + ELLIPSIS)
  return kept
}

function roleOf(agent) {
  // Own keys only, so a role like 'toString' can't pick up an Object method.
  return Object.hasOwn(ROLES, agent.role) ? ROLES[agent.role] : ROLES.agent
}

// '♨ Miso · cook': the role's mark, the agent's name, the role's label.
function nameLine(agent) {
  const role = roleOf(agent)
  return `${role.mark} ${text(agent.name)} · ${role.label}`
}

// What the agent is doing, or how it ended when it has nothing to say.
function activityLine(agent) {
  const said = text(agent.activity)
  if (safeText(said).trim() !== '') return said
  if (agent.state === 'done') return 'finished'
  if (agent.state === 'failed') return 'failed'
  return ''
}

// The agents the board can place: one per id, the first one listed wins, so two can never share a home.
function uniqueAgents(value) {
  const seen = new Set()
  const out = []
  for (const agent of list(value)) {
    if (!isObject(agent) || (typeof agent.id !== 'string' && typeof agent.id !== 'number')) continue
    const id = idOf(agent.id)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, agent })
  }
  return out
}

// Turns measured slot items into rows, left to right, starting a new row when the next one won't
// fit in `room` cells. Each item gets `dx`, its offset from the left edge.
function intoRows(items, room, gap) {
  const rows = []
  let row = null
  for (const item of items) {
    if (row && row.used + gap + item.w <= room) {
      item.dx = row.used + gap
      row.used += gap + item.w
      row.items.push(item)
    } else {
      item.dx = 0
      row = { items: [item], used: item.w }
      rows.push(row)
    }
  }
  return rows
}

// The agents standing on one card, placed inside its border from (left, top) with `room` cells
// across, one agent to a row. The name and activity go to the right of the sprite when the whole
// name fits there, else under it, so a name is never cut just to sit beside its sprite.
function cardSlots(agents, left, top, room) {
  const slots = []
  let y = top
  for (const { id, agent } of agents) {
    const size = SIZES[sizeOf(agent.model)]
    const fullName = nameLine(agent)
    const beside = size.w + 1 + cellWidth(fullName) <= room
    const textRoom = beside ? room - size.w - 1 : room
    // Beside, the name shares the sprite's row and the activity goes on the next; under it, the
    // two lines follow the sprite.
    const textX = beside ? left + size.w + 1 : left
    const textY = beside ? y : y + size.h
    slots.push({
      agentId: id, x: left, y, w: size.w, h: size.h,
      name: { x: textX, y: textY, text: clip(fullName, textRoom) },
      activity: { x: textX, y: textY + 1, text: clip(activityLine(agent), textRoom) },
    })
    y += beside ? Math.max(size.h, 2) : size.h + 2
  }
  return { slots, height: y - top }
}

// One card at (x, y), `w` wide: the id, up to two title lines, the tag, then the agents on it.
function placeCard(source, agents, x, y, w) {
  const room = w - 2
  const idText = clip(text(source.id), room)
  const titleLines = fitLines(text(source.title), room, 2)
  const rawTag = text(source.tag)
  const tag = safeText(rawTag).trim() === '' ? null : clip(rawTag, room)
  const above = 1 + titleLines.length + (tag === null ? 0 : 1)
  const placed = cardSlots(agents, x + 1, y + 1 + above, room)
  const inner = Math.max(2, above + placed.height)
  return {
    id: idOf(source.id), x, y, w, h: inner + 2, idText, titleLines, tag, alert: source.alert === true, slots: placed.slots,
  }
}

// The crew: agents with no card on the board, left to right from `top`, wrapping onto more rows.
// The name and activity go to the right of the sprite when the whole name fits there, else under it.
function crewSlots(agents, top, columns) {
  const items = agents.map(({ id, agent }) => {
    const size = SIZES[sizeOf(agent.model)]
    const fullName = nameLine(agent)
    const beside = size.w + 1 + cellWidth(fullName) <= columns
    const room = beside ? columns - size.w - 1 : columns
    const name = clip(fullName, room)
    const activity = clip(activityLine(agent), room)
    const textW = Math.max(cellWidth(name), cellWidth(activity))
    const w = beside ? size.w + 1 + textW : Math.min(columns, Math.max(size.w, textW))
    return { id, size, name, activity, beside, w }
  })
  const slots = []
  let y = top
  for (const [i, row] of intoRows(items, columns, CREW_SLOT_GAP).entries()) {
    if (i > 0) y += CREW_ROW_GAP
    // Every slot in a row starts on the row's top line, and the row is as tall as its tallest slot.
    let rowH = 0
    for (const item of row.items) {
      const x = item.dx
      // Beside the sprite the name shares its row and the activity goes on the next; under it,
      // the two lines follow the sprite.
      const textX = item.beside ? x + item.size.w + 1 : x
      const textY = item.beside ? y : y + item.size.h
      slots.push({
        agentId: item.id, x, y, w: item.size.w, h: item.size.h,
        name: { x: textX, y: textY, text: item.name },
        activity: { x: textX, y: textY + 1, text: item.activity },
      })
      rowH = Math.max(rowH, item.beside ? Math.max(item.size.h, 2) : item.size.h + 2)
    }
    y += rowH
  }
  return { slots, height: y - top }
}

// Rows 0 to 2 and the context meter at the top right of rows 0 and 1.
function placeHeader(project, columns) {
  const p = isObject(project) ? project : {}
  const narrow = columns < METER_ICON_MIN
  const w = narrow ? METER_TEXT_W : METER_W
  const x = columns - w
  const room = x - METER_GAP
  const top = [text(p.repo), text(p.branch)].filter((part) => part !== '').join(' · ')
  return {
    y: 0,
    repo: clip(top, room),
    title: clip(text(p.title), room),
    detail: clip(text(p.detail), room),
    meter: { x, y: 0, w, icon: narrow ? null : { x }, text: { x: narrow ? x : x + ICON_W + 1 } },
  }
}

// Messages and Learnings from row `top`: side by side when the pane is wide enough, else stacked.
// Text inside a panel is clipped to its width less the border and a cell of padding each side.
function placePanels(snap, top, columns) {
  const side = columns >= PANELS_SIDE_MIN
  const mW = side ? Math.floor(columns * 0.6) : columns
  const lW = side ? columns - mW - 1 : columns
  const lX = side ? mW + 1 : 0

  const shownMessages = list(snap.messages).filter(isObject).slice(0, MAX_MESSAGES)
  const source = isObject(snap.learnings) ? snap.learnings : {}
  const all = list(source.lines)
  const lines = all.slice(0, MAX_LEARNINGS).map((line) => clip(text(line), lW - 4))
  const total = Number.isFinite(source.total) ? Math.max(Math.floor(source.total), lines.length) : all.length
  const more = total - lines.length

  // An empty panel keeps one blank row inside its border for the painter's "nothing here" line.
  const mH = 2 + Math.max(1, shownMessages.length * 2)
  const lH = 2 + Math.max(1, lines.length + (more > 0 ? 1 : 0))
  const mY = top
  const lY = side ? top : top + mH + 1
  const height = side ? Math.max(mH, lH) : null

  const rows = shownMessages.map((m, i) => ({
    id: idOf(m.id),
    y: mY + 1 + i * 2,
    head: clip(`${text(m.from)} → ${text(m.to)}`, mW - 4),
    text: clip(text(m.text), mW - 4),
  }))
  const messages = { x: 0, y: mY, w: mW, h: height ?? mH, rows }
  const learnings = { x: lX, y: lY, w: lW, h: height ?? lH, lines, more }
  return { messages, learnings, bottom: Math.max(mY + messages.h, lY + learnings.h) }
}

// The legend, right-aligned on row `y`. When the pane is too narrow for the whole line it drops the
// 'Color: ' label, then the dots, so the four family words always show.
function placeLegend(y, columns) {
  const words = FAMILIES.map((f) => f.label)
  const shapes = [['Color: ', ' · '], ['', ' · '], ['', ' ']]
  const fits = shapes.find(([label, sep]) => cellWidth(label + words.join(sep)) <= columns) ?? shapes.at(-1)
  const [label, sep] = fits
  const legendText = label + words.join(sep)
  const x = columns - cellWidth(legendText)
  const spans = []
  let at = x + cellWidth(label)
  for (const family of FAMILIES) {
    const w = cellWidth(family.label)
    spans.push({ x: at, w, family: family.key })
    at += w + cellWidth(sep)
  }
  return { y, x, text: legendText, spans }
}

// The detail box, centred on a board `rows` tall. Lines are wrapped to the box less its border and
// padding; when they don't all fit, the last one that would show becomes '…'.
function placeModal(detail, columns, rows) {
  const w = Math.min(columns - 4, MODAL_MAX_W)
  const width = w - 4
  const room = rows - 2 - 4
  const wrapped = []
  for (const line of list(detail.lines)) {
    if (wrapped.length > room) break
    const parts = wrap(text(line), width, room)
    // A blank line stays, so paragraphs keep their spacing.
    wrapped.push(...(parts.length > 0 ? parts : ['']))
  }
  const lines = wrapped.length <= room ? wrapped : [...wrapped.slice(0, room - 1), ELLIPSIS]
  const h = 4 + lines.length
  return { x: Math.floor((columns - w) / 2), y: Math.floor((rows - h) / 2), w, h, title: clip(text(detail.title), width), lines }
}

// Everything the painter needs to draw the board `columns` cells wide, in cells. Same input, same output.
export function arrange(snapshot, columns) {
  const width = widthOf(columns)
  const snap = isObject(snapshot) ? snapshot : {}
  const header = placeHeader(snap.project, width)

  // Which agents stand on which card: the first card on the board with the agent's card id.
  const sourceLanes = list(snap.lanes).filter(isObject)
  const onBoard = new Set()
  for (const lane of sourceLanes) for (const c of list(lane.cards)) if (isObject(c)) onBoard.add(idOf(c.id))
  const waiting = new Map()
  const crewAgents = []
  for (const entry of uniqueAgents(snap.agents)) {
    const card = entry.agent.card
    const key = card == null ? null : idOf(card)
    if (key !== null && onBoard.has(key)) {
      if (!waiting.has(key)) waiting.set(key, [])
      waiting.get(key).push(entry)
    } else {
      crewAgents.push(entry)
    }
  }
  const takeAgents = (id) => {
    const here = waiting.get(id) ?? []
    waiting.delete(id)
    return here
  }

  // Lanes, side by side in bands; a band starts one blank row below the tallest lane above it.
  const perRow = Math.min(MAX_LANES_PER_ROW, Math.max(1, Math.floor((width + 1) / 21)))
  const laneW = Math.min(LANE_MAX_W, Math.floor((width - (perRow - 1)) / perRow))
  const lanes = []
  let next = LANES_TOP
  for (let first = 0; first < sourceLanes.length; first += perRow) {
    const bandTop = next
    let bandBottom = bandTop
    for (let j = 0; j < perRow && first + j < sourceLanes.length; j++) {
      const source = sourceLanes[first + j]
      const x = j * (laneW + 1)
      let y = bandTop + 1
      const cards = list(source.cards).filter(isObject).map((c) => {
        const placed = placeCard(c, takeAgents(idOf(c.id)), x, y, laneW)
        y += placed.h
        return placed
      })
      // The lanes arrive capped: `total` may count cards not shown, never fewer than are.
      const total = Number.isFinite(source.total) ? Math.max(Math.floor(source.total), cards.length) : cards.length
      const more = total - cards.length
      if (more > 0) y += 1
      lanes.push({ key: idOf(source.key), title: clip(text(source.title), laneW), total, x, y: bandTop, w: laneW, more, cards })
      bandBottom = Math.max(bandBottom, y)
    }
    next = bandBottom + 1
  }

  // The crew label goes on the first free row; its slots start on the row under it.
  let crew = null
  if (crewAgents.length > 0) {
    const placed = crewSlots(crewAgents, next + 1, width)
    crew = { y: next, slots: placed.slots }
    next += 1 + placed.height + 1
  }

  const panels = placePanels(snap, next, width)
  const detail = isObject(snap.detail) ? snap.detail : null
  // The legend takes the row after the panels; a board with the detail box up is at least 12 rows.
  const rows = Math.max(panels.bottom + 1, detail ? MODAL_MIN_ROWS : 0)
  const legend = placeLegend(rows - 1, width)
  const modal = detail ? placeModal(detail, width, rows) : null

  const homes = []
  const obstacles = []
  const allCards = lanes.flatMap((lane) => lane.cards)
  for (const s of [...allCards.flatMap((c) => c.slots), ...(crew ? crew.slots : [])]) {
    homes.push([s.agentId, { x: s.x, y: s.y, w: s.w, h: s.h }])
    obstacles.push({ x: s.name.x, y: s.name.y, w: cellWidth(s.name.text), h: 1 })
    obstacles.push({ x: s.activity.x, y: s.activity.y, w: cellWidth(s.activity.text), h: 1 })
  }

  // Click targets, later ones on top: cards, messages, then the detail box's three.
  const regions = [
    ...allCards.map((c) => ({ kind: 'card', id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })),
    ...panels.messages.rows.map((row) => ({
      kind: 'message', id: row.id, x: panels.messages.x + 1, y: row.y, w: panels.messages.w - 2, h: 2,
    })),
  ]
  if (modal) {
    regions.push(
      // A click anywhere off the box closes it, a click on the box does nothing, a click on [x] closes it.
      { kind: 'close', id: 'close', x: 0, y: 0, w: width, h: rows },
      { kind: 'modal', id: 'modal', x: modal.x, y: modal.y, w: modal.w, h: modal.h },
      { kind: 'close', id: 'close', x: modal.x + modal.w - 4, y: modal.y, w: 3, h: 1 },
    )
  }

  return {
    columns: width,
    rows,
    header,
    lanes,
    crew,
    messages: panels.messages,
    learnings: panels.learnings,
    legend,
    // Built from entries so an agent id like '__proto__' is just another key.
    homes: Object.fromEntries(homes),
    obstacles,
    regions,
    modal,
  }
}
