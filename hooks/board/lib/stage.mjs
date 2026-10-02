// The board's stage: where each agent sprite stands, which one the pointer is
// over, and what its hover card says. Pure functions only, so the pane can
// call them on every tick without any setup.

// Moves value toward target by at most `step`, landing exactly on it when close.
function stepToward(value, target, step) {
  const gap = target - value
  if (Math.abs(gap) <= step) return target
  return value + Math.sign(gap) * step
}

function isCell(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y)
}

function isBox(b) {
  return isCell(b) && Number.isFinite(b.w) && Number.isFinite(b.h)
}

// Two boxes overlap when they share at least one cell.
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// A sprite counts as on the board once any cell of its box reaches x = 0.
// Until then it is waiting in the wings and can't be in anyone's way.
function onBoard(box) {
  return box.x + box.w > 0
}

// How many ticks a sprite needs to walk home with nothing in its way.
function distance(p, home) {
  return Math.max(Math.ceil(Math.abs(home.x - p.x) / 2), Math.abs(home.y - p.y))
}

// A sprite that has been stuck this many ticks in a row jumps straight home.
const PATIENCE = 8

// Takes one step for every sprite that has a home, without ever drawing two
// sprites on top of each other or a sprite over a name line (the obstacles).
//
// A sprite we haven't seen before walks in from just off the left edge, level
// with its home. Each step is up to 2 cells across and 1 up or down; when the
// full step is blocked the sprite tries just the across part, then just the up
// or down part, and otherwise waits. Sprites move one at a time, nearest home
// first (ties by id), so each one sees where the earlier ones ended up.
//
// Waiting can't last for ever. A sprite stuck for 8 ticks jumps home as soon
// as nobody is standing there, and a tick in which nobody moves at all while
// someone has been stuck that long sends everyone home at once, which is what
// untangles two sprites that need each other's place. Homes never overlap, so
// a jump always lands somewhere clear.
//
// How long a sprite has been stuck rides along as a `wait` field on its
// position; callers just hand back what they got. Sprites whose agent has no
// home any more simply disappear. The inputs are left alone.
export function advance(positions, homes, obstacles = []) {
  const now = positions ?? {}
  const where = homes ?? {}
  const walls = Array.isArray(obstacles) ? obstacles.filter(isBox) : []
  const ids = Object.keys(where)

  // Where every sprite stands right now. As each one moves this gets its new
  // spot, so later sprites dodge the moved ones and the not-yet-moved ones.
  const at = {}
  for (const id of ids) {
    const home = where[id]
    const seen = Object.hasOwn(now, id) && isCell(now[id])
    const from = seen ? now[id] : { x: -home.w, y: home.y }
    const wait = seen && Number.isInteger(from.wait) && from.wait > 0 ? from.wait : 0
    at[id] = { x: from.x, y: from.y, wait }
  }

  // True when sprite `id` could stand at `p` without touching anyone else
  // or any name line.
  const isFree = (id, p) => {
    const box = { x: p.x, y: p.y, w: where[id].w, h: where[id].h }
    if (!onBoard(box)) return true
    if (walls.some((wall) => overlaps(box, wall))) return false
    return ids.every((other) => {
      if (other === id) return true
      const theirs = { x: at[other].x, y: at[other].y, w: where[other].w, h: where[other].h }
      return !onBoard(theirs) || !overlaps(box, theirs)
    })
  }

  const order = ids.slice().sort((a, b) =>
    distance(at[a], where[a]) - distance(at[b], where[b]) || (a < b ? -1 : a > b ? 1 : 0))

  let moved = false
  for (const id of order) {
    const home = where[id]
    const from = at[id]
    if (from.x === home.x && from.y === home.y) {
      at[id] = { x: home.x, y: home.y, wait: 0 }
      continue
    }
    const to = { x: stepToward(from.x, home.x, 2), y: stepToward(from.y, home.y, 1) }
    const tries = [to, { x: to.x, y: from.y }, { x: from.x, y: to.y }]
    const step = tries.find((p) => (p.x !== from.x || p.y !== from.y) && isFree(id, p))
    if (step) {
      at[id] = { x: step.x, y: step.y, wait: 0 }
      moved = true
      continue
    }
    const wait = from.wait + 1
    // A sprite handed to us already overlapping something (the layout moved
    // under it) can't wait where it is, so it goes home now if home is clear.
    if ((wait >= PATIENCE || !isFree(id, from)) && isFree(id, home)) {
      at[id] = { x: home.x, y: home.y, wait: 0 }
      moved = true
      continue
    }
    at[id] = { x: from.x, y: from.y, wait }
  }

  // Nobody moved and somebody has run out of patience: everyone is waiting
  // on someone else, so they all go home together. The same happens in the
  // rare tick that would otherwise end with an overlap left over from the
  // input, because everyone at home is always a clear board.
  const jammed = !moved && ids.some((id) => at[id].wait >= PATIENCE)
  if (jammed || ids.some((id) => !isFree(id, at[id]))) {
    for (const id of ids) at[id] = { x: where[id].x, y: where[id].y, wait: 0 }
  }

  return Object.fromEntries(ids.map((id) => {
    const { x, y, wait } = at[id]
    return [id, wait > 0 ? { x, y, wait } : { x, y }]
  }))
}

// True once every sprite with a home is standing exactly on it.
export function settled(positions, homes) {
  const now = positions ?? {}
  return Object.keys(homes ?? {}).every((id) => {
    const at = Object.hasOwn(now, id) ? now[id] : null
    return at != null && at.x === homes[id].x && at.y === homes[id].y
  })
}

// Finds the sprite under a cell. Regions drawn later sit on top, so the last
// match wins. A region covers x from its left edge up to, but not including,
// x + w (same for y), so neighbours that touch never both claim a cell.
export function hitTest(regions, x, y) {
  const list = regions ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id
  }
  return null
}

// A short token count: plain under a thousand, whole thousands as 'k', and
// millions with one decimal as 'M'. Anything that isn't a real number reads '0'.
export function kTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (Math.round(abs) < 1000) return sign + String(Math.round(abs))
  // 999,500 and up would round to '1000k', so it reads as millions instead.
  if (Math.round(abs / 1000) < 1000) return `${sign}${Math.round(abs / 1000)}k`
  return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

// How long something has been running, in its largest sensible unit:
// '40s', '12m', or '1h05m'. Partial units are dropped, never rounded up.
export function elapsed(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '0s'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h${String(mins % 60).padStart(2, '0')}m`
}

// The four lines on an agent's hover card. A working inspector says
// 'reviewing' because that's what it is actually doing; everyone else shows
// their state as is. The clock stops at endedAt once the agent is finished.
export function cardLines(agent, roleLabel, now) {
  const word = agent.state === 'working' && agent.role === 'inspector' ? 'reviewing' : agent.state
  return [
    `${agent.name} · ${roleLabel}`,
    agent.model,
    agent.item == null ? 'item —' : `item ${agent.item}`,
    `${word} · ${kTokens(agent.tokens)} tokens · ${elapsed((agent.endedAt ?? now) - agent.startedAt)}`,
  ]
}
