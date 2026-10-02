// Works out which lane each work item sits in, from a dish's plan, the notes agents left on disk
// and the live roster. Pure text and plain objects in, plain objects out: nothing here reads files.
// Plan text comes from disk, so every slug, status and goal is treated as data: no pattern is ever
// built from it, lookups go through Maps and Sets, and a line that doesn't parse is skipped.

// The five lanes of the task board, left to right.
export const PHASES = [
  { key: 'todo', title: 'To do' }, { key: 'cooking', title: 'Cooking' }, { key: 'review', title: 'In review' },
  { key: 'rework', title: 'Rework' }, { key: 'done', title: 'Done' },
]

const PACKET = '## Packet: '

// Drops one pair of matching quotes around a value, if it has them.
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) return value.slice(1, -1)
  }
  return value
}

// A frontmatter scalar as a plain string; YAML's spellings of "nothing" come back as ''.
function scalar(value) {
  const text = unquote(value.trim())
  return text === 'null' || text === '~' ? '' : text
}

// Splits flow-style YAML on the commas that sit outside brackets, braces and quotes, in one walk
// over the characters. Returns null when the brackets don't balance or a quote is left open, so a
// broken line gets skipped instead of half-read. A quote only opens a string at the start of a
// value, which keeps an apostrophe inside a plain word (like "don't") from swallowing the line.
function splitTop(text) {
  const parts = []
  const closers = []
  let quote = ''
  let start = 0
  let prev = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (quote === '"' && ch === '\\') i++
      else if (ch === quote) { quote = ''; prev = ch }
      continue
    }
    if ((ch === '"' || ch === "'") && (prev === '' || prev === ':' || prev === ',' || prev === '[' || prev === '{')) {
      quote = ch
    } else if (ch === '[') {
      closers.push(']')
    } else if (ch === '{') {
      closers.push('}')
    } else if (ch === ']' || ch === '}') {
      if (closers.pop() !== ch) return null
    } else if (ch === ',' && closers.length === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    if (ch !== ' ' && ch !== '\t') prev = ch
  }
  if (quote || closers.length > 0) return null
  parts.push(text.slice(start))
  return parts
}

// The entries of a `[a, b, c]` value, or null when the value isn't a bracketed list.
function listOf(value) {
  const text = value.trim()
  if (!text.startsWith('[') || !text.endsWith(']')) return null
  const parts = splitTop(text.slice(1, -1))
  if (!parts) return null
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

// One `- { slug: ..., status: ..., ... }` line as an item, or null when it doesn't parse.
function itemFrom(line) {
  const text = line.trim()
  if (!text.startsWith('-')) return null
  const body = text.slice(1).trim()
  if (!body.startsWith('{') || !body.endsWith('}')) return null
  const parts = splitTop(body.slice(1, -1))
  if (!parts) return null
  const fields = new Map()
  for (const part of parts) {
    if (part.trim() === '') continue
    const at = part.indexOf(':')
    if (at <= 0) return null
    fields.set(part.slice(0, at).trim(), part.slice(at + 1))
  }
  const slug = scalar(fields.get('slug') ?? '')
  if (slug === '') return null
  const names = (key) => (listOf(fields.get(key) ?? '') ?? []).map((entry) => unquote(entry))
  return {
    slug,
    status: scalar(fields.get('status') ?? ''),
    heavy: scalar(fields.get('heavy') ?? '') === 'true',
    dependsOn: names('depends_on'),
    files: names('files'),
    attempts: (listOf(fields.get('attempts') ?? '') ?? []).length,
    goal: '',
  }
}

// Every item of a PLAN.md: the envelope fields from its frontmatter, each `items:` line, and the
// goal from that item's `## Packet: <slug>` section. A packet section only ends at the next
// `## Packet: ` line; other `## ` headings inside it (a ledger's `## World state`, a heading in a
// code sample) belong to it. The goal is the first paragraph under the section's `### Goal`.
// Everything happens in a single pass over the lines.
export function planItems(planText) {
  const out = { dish: '', ticket: '', branch: '', tier: '', kind: '', items: [] }
  const lines = String(planText ?? '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return out

  const env = new Map()
  const items = []
  const seen = new Set()
  const goals = new Map()
  let closed = false
  let inItems = false
  let slug = null
  let goalState = 'done'
  let goalLines = []

  // Saves the goal being read, if any, for the current packet.
  const finishGoal = () => {
    if (slug !== null && (goalState === 'start' || goalState === 'in')) goals.set(slug, goalLines.join(' '))
    goalState = 'done'
    goalLines = []
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!closed) {
      const bare = line.trim()
      if (bare === '---') { closed = true; continue }
      // Blank lines and comments don't end the items list.
      if (bare === '' || bare.startsWith('#')) continue
      const first = line[0]
      if (first === ' ' || first === '\t' || first === '-') {
        if (inItems) {
          const item = itemFrom(line)
          if (item && !seen.has(item.slug)) { seen.add(item.slug); items.push(item) }
        }
        continue
      }
      const at = line.indexOf(':')
      inItems = false
      if (at <= 0) continue
      const key = line.slice(0, at).trim()
      const value = line.slice(at + 1)
      if (key === 'items' && value.trim() === '') inItems = true
      else env.set(key, scalar(value))
      continue
    }

    if (line.startsWith(PACKET)) {
      finishGoal()
      slug = line.slice(PACKET.length).trim()
      goalState = goals.has(slug) ? 'done' : 'seek'
      continue
    }
    if (slug === null || goalState === 'done') continue
    const text = line.trim()
    if (goalState === 'seek') {
      if (text === '### Goal') goalState = 'start'
    } else if (text === '' || text.startsWith('#') || text.startsWith('```')) {
      if (goalState === 'in' || text !== '') finishGoal()
    } else {
      goalLines.push(text)
      goalState = 'in'
    }
  }
  if (!closed) return out
  finishGoal()

  out.dish = env.get('dish') ?? ''
  out.ticket = env.get('ticket') ?? ''
  out.branch = env.get('delivery_branch') ?? ''
  out.tier = env.get('tier') ?? ''
  out.kind = env.get('kind') ?? ''
  out.items = items.map((item) => ({ ...item, goal: goals.get(item.slug) ?? '' }))
  return out
}

// A note's time, with anything that isn't a number counted as the dawn of time.
function timeOf(note) {
  return Number.isFinite(note.at) ? note.at : 0
}

// The pill for a verdict that sent the work back, with its finding count when there is one.
function sentBack(findings) {
  const count = Math.floor(Number(findings))
  if (!Number.isFinite(count) || count <= 0) return 'sent back'
  return 'sent back · ' + count + (count === 1 ? ' finding' : ' findings')
}

function lane(phase, tag = null, alert = false) {
  return { phase, tag, alert }
}

// The lane the plan's own status points at, for when nothing on disk or in the roster says more.
function byStatus(item) {
  switch (item.status) {
    case 'done': return lane('done')
    case 'blocked': return lane('rework', 'blocked', true)
    case 'rework': return lane('rework', 'sent back', true)
    case 'in_review': return lane('review')
    case 'dispatched': return lane('cooking')
    default: return lane('todo', item.heavy === true ? 'heavy' : null)
  }
}

// Which lane one item is in, and the pill on its card. The live roster wins over what's on disk,
// what's on disk wins over the plan's status, and the first rule that matches decides:
//   1. an inspector working on it: in review
//   2. a cook working on it: cooking (a second pass if a review has already failed it)
//   3. its newest report says blocked and is newer than any verdict: rework, blocked
//   4. its newest verdict has no newer report: PASS is done, FAIL is rework with the finding
//      count. A PASS goes stale when the plan has sent the item round again.
//   5. it has a report the inspector hasn't answered yet: in review
//   6. the plan's status
// "Newer" means a later time; when a report and a verdict share a time, the verdict wins.
export function phaseOf(item, notes, agents) {
  const slug = typeof item?.slug === 'string' ? item.slug : ''
  let report = null
  let verdict = null
  let failed = false
  for (const note of notes ?? []) {
    if (!note || slug === '' || note.item !== slug) continue
    if (note.kind === 'report') {
      if (!report || timeOf(note) > timeOf(report)) report = note
    } else if (note.kind === 'verdict') {
      if (note.gist === 'FAIL') failed = true
      if (!verdict || timeOf(note) > timeOf(verdict)) verdict = note
    }
  }
  const working = (agents ?? []).filter((a) => a && a.state === 'working' && slug !== '' && a.item === slug)

  if (working.some((a) => a.role === 'inspector')) return lane('review')
  if (working.some((a) => a.role === 'cook' || a.role === 'heavy')) return lane('cooking', failed ? 'second pass' : null)

  const reportIsNewer = report !== null && (verdict === null || timeOf(report) > timeOf(verdict))
  if (reportIsNewer && report.gist === 'blocked') return lane('rework', 'blocked', true)
  if (verdict !== null && !reportIsNewer) {
    const stale = item.status === 'dispatched' || item.status === 'rework'
    if (verdict.gist === 'PASS' && !stale) return lane('done')
    if (verdict.gist === 'FAIL') return lane('rework', sentBack(verdict.findings), true)
  }
  if (reportIsNewer) return lane('review')
  return byStatus(item)
}

// The first sentence of a goal: up to the first full stop, question or exclamation mark that ends
// the text or is followed by a space. A dot inside "v1.2" doesn't count.
function firstSentence(text) {
  const goal = String(text ?? '').trim()
  for (let i = 0; i < goal.length; i++) {
    const ch = goal[i]
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    const next = goal[i + 1]
    if (next === undefined || next === ' ' || next === '\t' || next === '\n') return goal.slice(0, i + 1)
  }
  return goal
}

// The longest card title. Titles come from files, and a goal with no full stop could otherwise
// hand the board a whole file as one title.
const TITLE_MAX = 160

// Cuts text longer than `max` characters to `max`, the last one an ellipsis. A character made of
// two halves is never cut in two.
function capped(text, max) {
  if (text.length <= max) return text
  let cut = text.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut + '…'
}

// One card per plan item, in plan order, titled by the first sentence of its goal (or its slug).
export function workCards(items, notes, agents) {
  return (items ?? [])
    .filter((item) => item && typeof item.slug === 'string' && item.slug !== '')
    .map((item) => ({
      id: item.slug,
      title: capped(firstSentence(item.goal) || item.slug, TITLE_MAX),
      ...phaseOf(item, notes, agents),
    }))
}

// How the board's own lanes fold into the five phases.
const TICKET_PHASES = new Map([
  ['backlog', 'todo'], ['todo', 'todo'], ['in_progress', 'cooking'],
  ['in_review', 'review'], ['blocked', 'rework'], ['done', 'done'],
])

// One card per board ticket, for when no ticket is being worked. `laneOf` turns a ticket's status
// into the board's lane key; a blocked ticket gets the blocked pill, any other shows its kind.
export function ticketCards(tickets, laneOf) {
  return (tickets ?? []).filter((t) => t && t.id != null && t.id !== '').map((t) => {
    const id = String(t.id)
    const key = typeof laneOf === 'function' ? laneOf(t.status) : 'backlog'
    const phase = TICKET_PHASES.get(key) ?? 'todo'
    const title = capped(typeof t.title === 'string' && t.title !== '' ? t.title : id, TITLE_MAX)
    if (phase === 'rework') return { id, title, phase, tag: 'blocked', alert: true }
    return { id, title, phase, tag: typeof t.kind === 'string' && t.kind !== '' ? t.kind : null, alert: false }
  })
}

// How many cards a lane shows: its own cap, else the default, else four. Only the caps object's
// own keys count, so nothing leaks in from its prototype.
function capFor(caps, key) {
  const own = (name) => (caps !== null && typeof caps === 'object' && Object.hasOwn(caps, name) ? caps[name] : undefined)
  const cap = Number(own(key) ?? own('default') ?? 4)
  return Number.isNaN(cap) ? 4 : Math.max(0, Math.floor(cap))
}

// The five lanes in order. Done shows its newest items first (the plan's last ones); every other
// lane keeps plan order. A pinned card (say, one an agent stands on) always shows and comes first,
// even when that pushes the lane past its cap; `total` counts every card in the phase.
export function toWorkLanes(cards, pinned = [], caps = { default: 4, done: 2 }) {
  const pins = new Set(pinned ?? [])
  const all = (cards ?? []).filter((card) => card)
  return PHASES.map(({ key, title }) => {
    const mine = all.filter((card) => card.phase === key)
    if (key === 'done') mine.reverse()
    const first = mine.filter((card) => pins.has(card.id))
    const rest = mine.filter((card) => !pins.has(card.id))
    const room = Math.max(0, capFor(caps, key) - first.length)
    return { key, title, total: mine.length, cards: first.concat(rest.slice(0, room)) }
  })
}

// The dish the board should show. A dish someone is working on right now wins: the one belonging
// to the most recently started working agent, as long as there's a plan for it. Otherwise the plan
// that changed most recently in the last `recentMs` and still has unfinished items. Otherwise none.
export function pickDish(plans, agents, now, recentMs = 86400000) {
  const known = (plans ?? []).filter((p) => p && typeof p.dish === 'string' && p.dish !== '')
  const dishes = new Set(known.map((p) => p.dish))

  let busiest = null
  for (const a of agents ?? []) {
    if (!a || a.state !== 'working' || !dishes.has(a.dish)) continue
    const started = Number.isFinite(a.startedAt) ? a.startedAt : -Infinity
    if (!busiest || started > busiest.started) busiest = { dish: a.dish, started }
  }
  if (busiest) return busiest.dish

  let freshest = null
  for (const p of known) {
    if (!Number.isFinite(p.mtimeMs) || !(now - p.mtimeMs <= recentMs)) continue
    if (!(p.items ?? []).some((i) => i && i.status !== 'done')) continue
    if (!freshest || p.mtimeMs > freshest.mtimeMs) freshest = p
  }
  return freshest ? freshest.dish : null
}
