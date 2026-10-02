// Keeps the roster of agents seen in this session. Each agent is worked out from whatever the
// engine tells us about it (a label, an agent type, the files it writes, the paths it touches)
// and followed from its first sighting until it finishes. Every function here returns new
// objects; nothing is mutated.
import { freeName } from './sprites.mjs'

// Agent types, checked in this order by substring. 'cook-heavy' and 'cook-opus' sit before
// 'cook' so a heavy cook is never mistaken for a plain one.
const TYPE_ROLES = [
  ['planner', 'planner'],
  ['cook-heavy', 'heavy'],
  ['cook-opus', 'heavy'],
  ['scout', 'scout'],
  ['cook', 'cook'],
  ['inspector', 'inspector'],
  ['analyst', 'analyst'],
]

// The word in front of the first colon of a label like 'cook:board-tickets:0'.
const LABEL_ROLES = { scout: 'scout', cook: 'cook', inspect: 'inspector' }

// The Planner's own state file. It sits where item state files live but names no item.
const PLANNER_STATE = /(?:^|\/)state\/planner\.md/

// What a written file says about its writer, checked in this order. Only writes count: an
// inspector reads the cook's report and ledger all the time, and that doesn't make it a cook.
const WRITTEN_ROLES = [
  [/-verdict|plan-check|acceptance/, 'inspector'],
  [/reports\/[a-z0-9-]+-cook/, 'cook'],
  [/\/briefs\//, 'scout'],
  [/analyst|retro/, 'analyst'],
  [/\.brigade\/worktrees\//, 'cook'],
]

// The tools that write the file named in their file path.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// An item's ledger. A shell command that writes one is a cook keeping its memory.
const ITEM_STATE = /\/state\/[a-z0-9-]+\.md$/

// Shell commands only the steward runs: making or removing a worktree, and landing a branch.
// Each stays inside one command of a pipeline or list, so 'git log; echo worktree add' is no match.
const STEWARD_COMMANDS = [
  /\bgit\b[^;&|\n]*\bworktree\s+(?:add|remove)\b/,
  /\bgit\b[^;&|\n]*\bmerge\b[^;&|\n]*--ff-only\b/,
]

// A shell word, quoted or bare. Quotes are dropped from what it captures.
const WORD = String.raw`(?:"([^"]*)"|'([^']*)'|([^\s;&|<>()]+))`
// '> path', '>> path', '2> path' or '&> path', but not '>&2' or '2>&1', which write no file.
const REDIRECT = new RegExp(String.raw`>>?(?!&)\s*${WORD}`, 'g')
// 'tee path…' up to the end of its command; every word that isn't an option is a file it writes.
const TEE = /\btee\b([^;&|<>\n]*)/g

// Path clues for the item, checked in this order within each piece of text. The worktree
// folder is '<delivery>--<item>', and the delivery part never holds '--' itself.
const PATH_ITEMS = [
  /\.brigade\/worktrees\/(?:(?!--)[^/\s])*--([a-z0-9-]+)/,
  /packets\/([a-z0-9-]+)\.md/,
  /state\/([a-z0-9-]+)\.md/,
  /reports\/([a-z0-9-]+)-(?:cook|verdict)/,
]

const DISH = /\.brigade\/dishes\/([a-z0-9-]+)\//

// A label shaped '<word>:<slug>' or '<word>:<slug>:<digits>'.
const LABEL = /^\s*([A-Za-z]+):([a-z0-9-]+)(?::\d+)?\s*$/

function text(value) {
  return typeof value === 'string' ? value : ''
}

// The prompt first, then each path, skipping anything that isn't text.
function clues(evidence) {
  const paths = Array.isArray(evidence.paths) ? evidence.paths : []
  return [evidence.prompt, ...paths].map(text).filter(Boolean)
}

// Blanks out the Planner's state file so it can't pass for an item's state file.
function withoutPlannerState(value) {
  return value.replace(new RegExp(PLANNER_STATE.source, 'g'), ' ')
}

function roleFromType(subagentType) {
  const type = text(subagentType).toLowerCase()
  if (!type) return null
  for (const [needle, role] of TYPE_ROLES) if (type.includes(needle)) return role
  return null
}

function roleFromLabel(description) {
  const label = text(description)
  const colon = label.indexOf(':')
  if (colon === -1) return null
  const word = label.slice(0, colon).trim().toLowerCase()
  return Object.hasOwn(LABEL_ROLES, word) ? LABEL_ROLES[word] : null
}

function roleFromWrittenPath(path) {
  for (const [pattern, role] of WRITTEN_ROLES) if (pattern.test(path)) return role
  return null
}

function unquote(value) {
  return value.replace(/^(["'])(.*)\1$/, '$2')
}

// Every file a shell command writes with a redirect or with tee.
function shellTargets(command) {
  const targets = []
  for (const match of command.matchAll(REDIRECT)) targets.push(match[1] ?? match[2] ?? match[3])
  for (const match of command.matchAll(TEE)) {
    for (const word of match[1].trim().split(/\s+/)) {
      if (word && !word.startsWith('-')) targets.push(unquote(word))
    }
  }
  return targets.filter(Boolean)
}

function roleFromCommand(command) {
  if (STEWARD_COMMANDS.some((pattern) => pattern.test(command))) return 'steward'
  for (const target of shellTargets(command)) {
    const role = roleFromWrittenPath(target)
    if (role) return role
    if (ITEM_STATE.test(target) && !PLANNER_STATE.test(target)) return 'cook'
  }
  return null
}

// The role one tool call proves, or null. `act` is { tool, filePath, command }, all optional.
// Writing proves a role; reading, searching or just naming a path never does.
export function roleFromAct(act) {
  if (!act || typeof act !== 'object') return null
  if (WRITE_TOOLS.has(act.tool)) return roleFromWrittenPath(text(act.filePath))
  if (act.tool === 'Bash') return roleFromCommand(text(act.command))
  return null
}

function itemFromClues(pieces) {
  for (const piece of pieces) {
    const cleaned = withoutPlannerState(piece)
    for (const pattern of PATH_ITEMS) {
      const match = cleaned.match(pattern)
      if (match) return match[1]
    }
  }
  return null
}

function dishFromClues(pieces) {
  for (const piece of pieces) {
    const match = piece.match(DISH)
    if (match) return match[1]
  }
  return null
}

// Works out who an agent is from loose evidence: { description, subagentType, name, prompt,
// paths, act }, every field optional. Returns { role, dish, item }; dish and item may be null.
// The role comes from the agent type, then the label, then what `act` writes. The prompt and
// paths only give the dish and item. The slug in a label never decides the role either, so
// 'inspect:cook-roster:1' is an inspector.
export function identify(evidence) {
  const ev = evidence && typeof evidence === 'object' ? evidence : {}
  const pieces = clues(ev)
  const role = roleFromType(ev.subagentType) ?? roleFromLabel(ev.description) ?? roleFromAct(ev.act) ?? 'agent'
  const label = text(ev.description).match(LABEL)
  const item = label ? label[2] : itemFromClues(pieces)
  return { role, dish: dishFromClues(pieces), item }
}

// A fresh, empty roster.
export function emptyFleet() {
  return { agents: {}, order: [] }
}

// Copies the roster one level deep, so changing one agent never touches the caller's copy.
function copyFleet(fleet) {
  const source = fleet && typeof fleet === 'object' ? fleet : emptyFleet()
  const agents = {}
  for (const [id, agent] of Object.entries(source.agents ?? {})) agents[id] = { ...agent }
  return { agents, order: [...(source.order ?? [])] }
}

function blank(value) {
  return value === null || value === undefined || value === ''
}

// Adds a new agent to an already-copied roster, taking identity from whatever evidence the
// event carries (often none). Its name is one nobody on the roster has right now; counting the
// roster instead would hand out a name twice once an agent has been pruned.
function addAgent(fleet, event) {
  const who = identify(event)
  const taken = fleet.order.map((id) => fleet.agents[id]?.name).filter(Boolean)
  fleet.agents[event.id] = {
    id: event.id,
    name: freeName(taken),
    role: who.role,
    dish: who.dish,
    item: who.item,
    model: blank(event.model) ? null : event.model,
    description: blank(event.description) ? null : event.description,
    subagentType: blank(event.subagentType) ? null : event.subagentType,
    state: 'working',
    tokens: 0,
    startedAt: event.at ?? null,
    endedAt: null,
    ticket: null,
    lane: null,
  }
  fleet.order.push(event.id)
  return fleet.agents[event.id]
}

// Fills in what's still unknown about an agent from fresh evidence. A role counts as unknown
// while it is still the catch-all 'agent'.
function fillIdentity(agent, who) {
  if (agent.role === 'agent') agent.role = who.role
  if (blank(agent.dish)) agent.dish = who.dish
  if (blank(agent.item)) agent.item = who.item
}

// Returns a new roster with one event applied: 'spawn', 'step', 'tool' or 'complete'. A 'tool'
// event is { type, id, at, paths, act }; its paths fill the dish and item, its act the role.
// Events without an id, or of a type we don't know, give back an unchanged copy.
export function applyEvent(fleet, event) {
  const next = copyFleet(fleet)
  if (!event || typeof event !== 'object' || blank(event.id)) return next
  const known = Object.hasOwn(next.agents, event.id)

  if (event.type === 'spawn') {
    if (!known) {
      addAgent(next, event)
      return next
    }
    const agent = next.agents[event.id]
    fillIdentity(agent, identify(event))
    for (const field of ['model', 'description', 'subagentType']) {
      if (blank(agent[field]) && !blank(event[field])) agent[field] = event[field]
    }
    if (blank(agent.startedAt) && !blank(event.at)) agent.startedAt = event.at
    return next
  }

  if (event.type === 'step') {
    const agent = known ? next.agents[event.id] : addAgent(next, { id: event.id, at: event.at })
    const tokens = Number(event.tokens)
    if (Number.isFinite(tokens)) agent.tokens += tokens
    if (!blank(event.model)) agent.model = event.model
    return next
  }

  if (event.type === 'tool') {
    const agent = known ? next.agents[event.id] : addAgent(next, { id: event.id, at: event.at })
    fillIdentity(agent, identify({ paths: event.paths, act: event.act }))
    return next
  }

  if (event.type === 'complete') {
    if (!known) return next
    const agent = next.agents[event.id]
    agent.endedAt = event.at ?? null
    agent.state = event.reason === 'error' || event.reason === 'aborted' ? 'failed' : 'done'
    return next
  }

  return next
}

// Times may arrive as epoch milliseconds or as date strings; both become milliseconds.
function toMs(value) {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return NaN
}

// Drops agents that ended more than keepMs before now. Agents still working always stay.
export function prune(fleet, now, keepMs) {
  const next = copyFleet(fleet)
  const cutoff = toMs(now) - keepMs
  const keep = next.order.filter((id) => {
    const agent = next.agents[id]
    if (!agent || blank(agent.endedAt)) return true
    const ended = toMs(agent.endedAt)
    return !(Number.isFinite(ended) && ended < cutoff)
  })
  const agents = {}
  for (const id of keep) if (next.agents[id]) agents[id] = next.agents[id]
  return { agents, order: keep }
}
