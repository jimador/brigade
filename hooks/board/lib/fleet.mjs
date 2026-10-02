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

// How much of a shell command we look at. This runs on every shell call of every agent, and a
// command can be any length, so anything past this point never decides a role.
const COMMAND_LIMIT = 4_000

// Splits a command into the single commands of its pipelines and lists.
const COMMAND_BREAK = /[;&|\n]/

// The words that make a command the steward's: making or removing a worktree, and landing a
// branch. Each is found with one forward scan from a given point, so a long command full of
// near misses still costs time in step with its length.
const GIT = /\bgit\b/g
const WORKTREE = /\bworktree\s+(?:add|remove)\b/g
const MERGE = /\bmerge\b/g
const FF_ONLY = /--ff-only\b/g

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

// Where `pattern` next matches in `text` at or after `from`, or -1.
function findFrom(pattern, text, from) {
  pattern.lastIndex = from
  const match = pattern.exec(text)
  return match ? match.index + match[0].length : -1
}

// True when one command (no ';', '&', '|' or newline in it) is 'git … worktree add|remove' or
// 'git … merge … --ff-only', with the words in that order.
function isStewardCommand(piece) {
  const git = findFrom(GIT, piece, 0)
  if (git === -1) return false
  if (findFrom(WORKTREE, piece, git) !== -1) return true
  const merge = findFrom(MERGE, piece, git)
  return merge !== -1 && findFrom(FF_ONLY, piece, merge) !== -1
}

function roleFromCommand(fullCommand) {
  const command = fullCommand.slice(0, COMMAND_LIMIT)
  if (command.split(COMMAND_BREAK).some(isStewardCommand)) return 'steward'
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

// How much of a shell command decides what its agent is doing. This runs on every tool call of
// every agent, so a huge command must cost no more than a short one.
const ACTIVITY_COMMAND_LIMIT = 400

// The longest activity the board will ever be handed, and the longest file and program names
// inside one.
const ACTIVITY_MAX = 32
const FILE_NAME_MAX = 24
const PROGRAM_NAME_MAX = 16

const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const BRIEFING_TOOLS = new Set(['Agent', 'Task', 'Workflow'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])

// Bits of a shell command that mean it runs a test suite, found by plain substring search.
const TEST_RUNS = [
  'node --test', 'npm test', 'npm run test', 'pnpm test', 'yarn test', 'pytest', 'go test', 'cargo test',
  'gradle test', 'gradlew test', 'mvn test', 'plugin test', 'regression.sh',
]

// Programs that run the script named by their first argument, so 'bash tests/run.sh' runs a
// script under a test folder just as './tests/run.sh' does.
const SCRIPT_RUNNERS = new Set(['sh', 'bash', 'zsh', 'node', 'python', 'python3'])

// Characters that must never reach the board: control characters (newlines and escapes among
// them), invisible formatting such as right-to-left overrides, line and paragraph separators,
// and half of a broken surrogate pair. Each one becomes a space.
const UNDRAWABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu

// Makes outside text safe to draw and at most `max` characters long. Only `max + 1` characters
// are ever looked at, and a wide character made of two halves is never cut in two.
function drawable(value, max) {
  let out = value.slice(0, max + 1).replace(UNDRAWABLE, ' ').slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}

function isSeparator(code) {
  return code === 0x2f || code === 0x5c
}

// The last part of a path, ignoring trailing slashes, so '/a/b/' gives 'b'. One backward scan.
function lastSegment(path) {
  let end = path.length
  while (end > 0 && isSeparator(path.charCodeAt(end - 1))) end--
  let start = end
  while (start > 0 && !isSeparator(path.charCodeAt(start - 1))) start--
  return path.slice(start, end)
}

// The drawable last part of a path clipped to `max`, or null when there is nothing to show.
function nameOf(path, max) {
  const name = drawable(lastSegment(path), max)
  return name.trim() ? name : null
}

function unquoted(word) {
  return word.replace(/["']/g, '')
}

// True when one command of a list runs a script under a 'test' or 'tests' folder, either
// directly or through a shell, node or python.
function runsTestScript(piece) {
  const words = piece.trim().split(/\s+/)
  let program = unquoted(words[0])
  if (SCRIPT_RUNNERS.has(lastSegment(program))) {
    program = unquoted(words.slice(1).find((word) => !word.startsWith('-')) ?? '')
  }
  const path = `/${program}`
  return path.includes('/test/') || path.includes('/tests/')
}

function commandActivity(fullCommand) {
  const raw = fullCommand.slice(0, ACTIVITY_COMMAND_LIMIT)
  const command = raw.replace(UNDRAWABLE, ' ')
  if (TEST_RUNS.some((run) => command.includes(run))) return 'running tests'
  // Split before scrubbing, since a newline ends a command just as ';' does.
  if (raw.split(COMMAND_BREAK).some((piece) => runsTestScript(piece.replace(UNDRAWABLE, ' ')))) {
    return 'running tests'
  }
  const first = command.trim().split(/\s+/, 1)[0]
  const word = unquoted(first ?? '')
  if (word === 'git') return 'running git'
  const program = nameOf(word, PROGRAM_NAME_MAX)
  return program ? `running ${program}` : null
}

// What one tool call looks like to a person watching, in two or three words, or null when it
// says nothing useful. `act` is { tool, filePath, command }, all optional. The answer is short
// and holds nothing but plain characters, because the board draws it as it is.
export function activityOf(act) {
  if (!act || typeof act !== 'object') return null
  const tool = act.tool
  if (WRITE_TOOLS.has(tool) || tool === 'Read') {
    const name = nameOf(text(act.filePath), FILE_NAME_MAX)
    if (!name) return null
    return `${tool === 'Read' ? 'reading' : 'editing'} ${name}`
  }
  if (SEARCH_TOOLS.has(tool)) return 'searching'
  if (tool === 'Bash') return commandActivity(text(act.command))
  if (BRIEFING_TOOLS.has(tool)) return 'briefing agents'
  if (WEB_TOOLS.has(tool)) return 'on the web'
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
    activity: null,
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

// Returns a new roster with one event applied: 'spawn', 'step', 'tool', 'activity' or
// 'complete'. A 'tool' event is { type, id, at, paths, act }; its paths fill the dish and item,
// its act the role. An 'activity' event is { type, id, text } and says what a working agent is
// doing now; it never adds an agent or wakes a finished one.
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
    agent.activity = null
    return next
  }

  if (event.type === 'activity') {
    if (!known) return next
    const agent = next.agents[event.id]
    if (agent.state !== 'working') return next
    // The text is drawn on the board as it is, so it is made safe here too, whoever sent it.
    const said = typeof event.text === 'string' ? drawable(event.text, ACTIVITY_MAX) : ''
    agent.activity = said.trim() ? said : null
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
