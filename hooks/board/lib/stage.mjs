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

// Takes one step for every sprite that has a home. A sprite we haven't seen
// before walks in from just off the left edge, level with its home. Sprites
// whose agent has no home any more simply disappear. The inputs are left alone.
export function advance(positions, homes) {
  const now = positions ?? {}
  return Object.fromEntries(
    Object.keys(homes ?? {}).map((id) => {
      const home = homes[id]
      const from = Object.hasOwn(now, id) && isCell(now[id])
        ? now[id]
        : { x: -home.w, y: home.y }
      return [id, { x: stepToward(from.x, home.x, 2), y: stepToward(from.y, home.y, 1) }]
    }),
  )
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
