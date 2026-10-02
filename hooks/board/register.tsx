import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Detail, Fleet, Learnings, Message, Note, Project, Snapshot, Stage, Weather, WorkLane } from '../../types'
import { boardDirFrom, laneOf, parseTicket } from './lib/board.mjs'
import { arrange } from './lib/board-layout.mjs'
import { draw } from './lib/board-paint.mjs'
import { pictureOf } from './lib/board-svg.mjs'
import { safeText } from './lib/canvas.mjs'
import { agentDetail, cardDetail, messageDetail, projectOf, ticketDetail } from './lib/detail.mjs'
import { envelope, findingsOf, ledgerTail, learningsFrom, messagesFrom, noteFrom } from './lib/dish.mjs'
import { activityOf, applyEvent, prune } from './lib/fleet.mjs'
import { ROLES } from './lib/sprites.mjs'
import { advance } from './lib/stage.mjs'
import { forecast } from './lib/weather.mjs'
import { PHASES, pickDish, planItems, ticketCards, toWorkLanes, workCards } from './lib/work.mjs'

const PANE = 'brigade-board'
// The dock width that fits all five lanes side by side.
const PANE_COLUMNS = 124
// How often the board looks at the disk and the context figures again.
const TICK_MS = 2000

const fleet = atom({ plugin: 'brigade', key: 'fleet' } as const, { agents: {}, order: [] } as Fleet)
const weather = atom({ plugin: 'brigade', key: 'weather' } as const, null as Weather | null)
// Which ticket each dish belongs to, by dish folder name. A missing dish is just unknown.
const dishes = atom({ plugin: 'brigade', key: 'dishes' } as const, {} as Record<string, string>)
// The header, the five lanes of cards, the Messages and Learnings panels, and the detail box.
const project = atom({ plugin: 'brigade', key: 'project' } as const, projectOf({ mode: 'tickets', repo: '', count: 0 }) as Project)
const work = atom({ plugin: 'brigade', key: 'work' } as const, toWorkLanes([]) as WorkLane[])
const messages = atom({ plugin: 'brigade', key: 'messages' } as const, [] as Message[])
const learnings = atom({ plugin: 'brigade', key: 'learnings' } as const, { total: 0, lines: [] } as Learnings)
const detail = atom({ plugin: 'brigade', key: 'detail' } as const, null as Detail | null)
// Where the sprites stand when the hooks module draws the board itself, whether the pane is open,
// and whether the terminal's region reported in or the pane fell back to rows drawn here.
const STAGE_START: Stage = { positions: {}, open: false, openedAt: null, ready: false, plain: false }
const stage = atom({ plugin: 'brigade', key: 'stage' } as const, STAGE_START)

// How long a finished agent stays on the board before it leaves.
const KEEP_MS = 120000
// The most tool calls we look at per agent while working out who it is. It is generous because
// a cook explores for a good while before its first write, and an inspector writes its verdict
// last. An agent that never gives itself away still stops costing anything after this many.
// Counted per agent id, for the life of the session.
const TOOL_LOOKS = 400
const toolLooks = new Map<string, number>()

// What each agent was last seen doing, by agent id, until the next refresh puts it on the roster.
// A tool call only sets an entry here, so saying what an agent is doing never costs a tool call a
// state read or write. The Planner's calls carry no agent id and go under 'main'.
const activities = new Map<string, string>()

// Folder and item names that are safe to put in a path.
const SLUG = /^[a-z0-9-]+$/
// Note file names that are safe to put in a path.
const NOTE_FILE = /^[A-Za-z0-9._-]+\.md$/

// Applies one roster event to the fleet. This runs on the session's hot path, so a failure
// here is swallowed: the board missing an event is far better than a tool call failing.
// With `planner`, the Planner is put on the roster first if it isn't there yet.
const record = async ($: EngineInterface, event: object, planner = false) => {
  try {
    const at = await $.clock.now()
    await update($, fleet, roster => {
      let next = roster
      if (planner && !Object.hasOwn(roster.agents, 'main')) {
        next = applyEvent(next, { type: 'spawn', id: 'main', at, description: 'planner', subagentType: 'planner', model: (event as { model?: string }).model })
      }
      return applyEvent(next, { ...event, at }) as Fleet
    })
  } catch {
    // The roster stays as it was.
  }
}

// Applies one tool event, but writes the roster only when the event changes it. Most tool calls
// teach us nothing, and those then cost one read and no redraw. Failures are swallowed, like
// in record.
const learn = async ($: EngineInterface, event: { type: 'tool'; id: string; paths: unknown[]; act: object }) => {
  try {
    const roster = await read($, fleet)
    if (same(roster, applyEvent(roster, event))) return
    // Only a write needs the time: it is when a newcomer joins the roster.
    const at = await $.clock.now()
    await update($, fleet, current => applyEvent(current, { ...event, at }) as Fleet)
  } catch {
    // The roster stays as it was.
  }
}

// The folder the board reads `.brigade/` from, without a trailing slash, and its last part, which
// names the repo. It is the repository's root, because in a git worktree the session's own folder
// has no `.brigade/`: that folder is untracked and lives only in the main checkout, and for a
// worktree the engine answers with the main checkout's root. Outside a repository, or when the
// engine can't say, it is the session's folder, as it always was.
//
// The board wants this several times a tick, and asking for the repository can be slow, so the
// answer is kept for as long as the session's folder stays the same. A failed ask is only kept
// until the next pass, so a hiccup at the start doesn't leave the board empty for good, and a
// call that keeps failing still costs one ask a pass at most. The ask itself is kept, not just
// its answer, so a click that lands while it is out waits for it instead of asking again.
type RepoAsk = { session: string; pass: number; failed: boolean; root: Promise<string> }
let repoAsk: RepoAsk | null = null
// Goes up at the start of every refresh pass.
let pass = 0

async function rootOf($: EngineInterface) {
  const session = (await $.session.root()).replace(/[\\/]+$/, '')
  const kept = repoAsk
  if (kept !== null && kept.session === session && !(kept.failed && kept.pass !== pass)) return kept.root
  const ask: RepoAsk = { session, pass, failed: false, root: Promise.resolve(session) }
  ask.root = repoRootOf($, session, () => {
    ask.failed = true
  })
  repoAsk = ask
  return ask.root
}

// The repository's root when the engine gives one, or the session's folder. No repository is an
// answer; a throw or an answer without a usable root is a failure, reported through `failed`.
async function repoRootOf($: EngineInterface, session: string, failed: () => void) {
  try {
    const repo: unknown = await $.session.repo()
    if (repo == null) return session
    const root = isPlain(repo) ? repo.root : undefined
    if (typeof root === 'string' && root !== '') return root.replace(/[\\/]+$/, '')
  } catch {
    // Read from the session's folder until the next pass asks again.
  }
  failed()
  return session
}

function repoOf(root: string) {
  return root.split(/[\\/]/).pop() ?? ''
}

// The agents on the roster, in the order they arrived.
function rosterAgents(roster: Fleet) {
  return roster.order.map(id => roster.agents[id]).filter(agent => agent != null)
}

// The ticket an agent is working, through its dish. Null when either is unknown.
function ticketOf(agent: Agent, byDish: Record<string, string>) {
  if (agent.dish == null || !Object.hasOwn(byDish, agent.dish)) return null
  const id = byDish[agent.dish]
  return typeof id === 'string' && id !== '' ? id : null
}

// The dish the board is showing, from the last refresh, or null when it shows the tickets.
let currentDish: string | null = null

// Everything the board draws, read from state so the pane redraws when any of it changes.
// Each agent's ticket and card are worked out here, fresh each time: in a dish it stands on its
// item's card, on the ticket board on its ticket's card, and with the crew when that card isn't
// showing. Only the fields the board draws are passed on.
async function snapshotOf($: EngineInterface): Promise<Snapshot> {
  const roster = await read($, fleet)
  const byDish = await read($, dishes)
  const head = await read($, project)
  const shown = await read($, work)
  const onBoard = new Set(shown.flatMap(lane => lane.cards.map(card => card.id)))
  const agents = rosterAgents(roster).map((agent): Agent => {
    const ticket = ticketOf(agent, byDish)
    let card: string | null = null
    if (head.mode === 'dish') {
      if (currentDish !== null && agent.dish === currentDish && agent.item != null && onBoard.has(agent.item)) card = agent.item
    } else if (ticket !== null && onBoard.has(ticket)) {
      card = ticket
    }
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      model: agent.model ?? null,
      state: agent.state,
      dish: agent.dish ?? null,
      item: agent.item ?? null,
      ticket,
      card,
      activity: agent.activity ?? null,
      tokens: agent.tokens,
      startedAt: agent.startedAt ?? null,
      endedAt: agent.endedAt ?? null,
    }
  })
  return {
    project: head,
    lanes: shown,
    agents,
    weather: await read($, weather),
    messages: await read($, messages),
    learnings: await read($, learnings),
    detail: await read($, detail),
    now: await $.clock.now(),
  }
}

type Ticket = NonNullable<ReturnType<typeof parseTicket>>

// Tickets we have already parsed, by file name, with the mtime we read them at. A file is only
// read again when its mtime moves, so a quiet board costs one folder listing per tick.
let cacheDir: string | null = null
let cache: Record<string, { mtimeMs: number; ticket: Ticket | null }> = {}

// Every ticket in the cache.
function cachedTickets() {
  return Object.values(cache).flatMap(hit => (hit.ticket ? [hit.ticket] : []))
}

// Whether two plain values would store the same, so an idle board skips the write and never redraws.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Rebuilds the ticket cache from the ticket folder named in .brigade/config.md. Any missing piece
// (config, folder, a file that won't read) stops here and the cache keeps what it had.
async function refreshTickets($: EngineInterface) {
  const root = await rootOf($)
  const config = `${root}/.brigade/config.md`
  if (!(await $.fs.exists(config))) return
  const named = boardDirFrom(await $.fs.read(config))
  if (named === null) return
  const dir = /^([A-Za-z]:)?[\\/]/.test(named) ? named : `${root}/${named.replace(/^\.[\\/]/, '')}`
  const entries = await $.fs.list(dir)
  // A different folder means none of the cached tickets apply any more.
  const seen: typeof cache = dir === cacheDir ? cache : {}
  const fresh: typeof cache = {}
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md') || entry.name.startsWith('_')) continue
    const known = seen[entry.name]
    fresh[entry.name] =
      known && known.mtimeMs === entry.mtimeMs
        ? known
        : { mtimeMs: entry.mtimeMs, ticket: parseTicket(await $.fs.read(`${dir}/${entry.name}`), entry.name) }
  }
  // Only a complete pass replaces the cache, which also drops files that have gone.
  cacheDir = dir
  cache = fresh
}

// Dishes whose PLAN.md moved in the last day get their folders scanned for notes, and so do
// dishes an agent is working, however old their plan.
const RECENT_MS = 24 * 60 * 60 * 1000
// How many messages the board keeps, and how many learnings.
const KEEP_MESSAGES = 8
const KEEP_LEARNINGS = 5
// How many messages the text board lists.
const SHOW_MESSAGES = 3
// The folders inside a dish that hold notes: research briefs, cook and inspector reports, and
// each agent's working memory.
const NOTE_DIRS = ['briefs', 'reports', 'state']

type Plan = ReturnType<typeof planItems>
// Dish files we have already read, by full path, with the mtime we read them at. A file is only
// read again when its mtime moves, so quiet dishes cost a few folder listings per tick, and a
// long plan is parsed once per change.
let dishCache: Record<string, { mtimeMs: number; plan?: Plan; note?: Note | null }> = {}
// Every dish with a plan, as the last complete pass found it: its folder name, when its plan
// last moved, the plan, and the notes in it (none for a dish that has gone quiet).
let dishesSeen: { dish: string; mtimeMs: number; plan: Plan; notes: Note[] }[] = []

// Reads every dish's plan, and the notes of the dishes that are still moving or being worked.
// Missing folders are skipped; a file that won't read throws, and the board keeps what it had
// until the next tick.
async function refreshDishes($: EngineInterface) {
  const root = await rootOf($)
  const base = `${root}/.brigade/dishes`
  const fresh: typeof dishCache = {}
  const seen: typeof dishesSeen = []
  const byDish: [string, string][] = []
  if (await $.fs.exists(base)) {
    const now = await $.clock.now()
    // The board can show an old dish because someone is working it, and then its notes must be
    // current. With nobody working, this adds no file read to a tick.
    const worked = new Set(rosterAgents(await read($, fleet)).flatMap(agent => (agent.state === 'working' && typeof agent.dish === 'string' ? [agent.dish] : [])))
    for (const folder of await $.fs.list(base)) {
      if (folder.kind !== 'dir' || !SLUG.test(folder.name)) continue
      const dir = `${base}/${folder.name}`
      const inside = await $.fs.list(dir)
      const planEntry = inside.find(entry => entry.kind === 'file' && entry.name === 'PLAN.md')
      if (!planEntry) continue
      const planPath = `${dir}/PLAN.md`
      const knownPlan = dishCache[planPath]
      const plan =
        knownPlan && knownPlan.mtimeMs === planEntry.mtimeMs && knownPlan.plan
          ? knownPlan.plan
          : (planItems(await $.fs.read(planPath)) as Plan)
      fresh[planPath] = { mtimeMs: planEntry.mtimeMs, plan }
      if (plan.ticket !== '') byDish.push([folder.name, plan.ticket])
      const found: Note[] = []
      if (!(now - planEntry.mtimeMs > RECENT_MS) || worked.has(folder.name)) {
        for (const sub of NOTE_DIRS) {
          if (!inside.some(entry => entry.kind === 'dir' && entry.name === sub)) continue
          for (const entry of await $.fs.list(`${dir}/${sub}`)) {
            if (entry.kind !== 'file' || !NOTE_FILE.test(entry.name)) continue
            const path = `${dir}/${sub}/${entry.name}`
            const known = dishCache[path]
            const note =
              known && known.mtimeMs === entry.mtimeMs && known.note !== undefined
                ? known.note
                : (noteFrom(await $.fs.read(path), entry.mtimeMs, `${sub}/${entry.name}`) as Note | null)
            fresh[path] = { mtimeMs: entry.mtimeMs, note }
            if (note) found.push(note)
          }
        }
      }
      seen.push({ dish: folder.name, mtimeMs: planEntry.mtimeMs, plan, notes: found })
    }
  }
  // Only a complete pass replaces the cache, which also drops files that have gone.
  dishCache = fresh
  dishesSeen = seen
  // fromEntries makes plain own keys, so a dish named like "__proto__" can't touch the prototype.
  const nextDishes = Object.fromEntries(byDish) as Record<string, string>
  if (!same(await read($, dishes), nextDishes)) await update($, dishes, () => nextDishes)
}

// Works out what the board shows from what the disk and the roster say: the dish being worked,
// with one card per work item, or the board's tickets when no dish is. Stores only what changed.
async function refreshWork($: EngineInterface) {
  const repo = repoOf(await rootOf($))
  const roster = rosterAgents(await read($, fleet))
  const byDish = await read($, dishes)
  const now = await $.clock.now()
  const plans = dishesSeen.map(seen => ({ dish: seen.dish, mtimeMs: seen.mtimeMs, items: seen.plan.items }))
  const picked = pickDish(plans, roster, now, RECENT_MS) as string | null
  const current = picked === null ? undefined : dishesSeen.find(seen => seen.dish === picked)
  let nextWork: WorkLane[]
  let nextProject: Project
  let nextMessages: Message[] = []
  if (current) {
    // Only this dish's agents count, and the items they are working always show.
    const crew = roster.filter(agent => agent.dish === current.dish)
    const pinned = crew.flatMap(agent => (agent.state === 'working' && agent.item != null ? [agent.item] : []))
    const cards = workCards(current.plan.items, current.notes, crew)
    nextWork = toWorkLanes(cards, pinned) as WorkLane[]
    const ticket = cachedTickets().find(hit => hit.id === current.plan.ticket) ?? null
    const done = cards.filter(card => card.phase === 'done').length
    nextProject = projectOf({ mode: 'dish', repo, plan: current.plan, ticket, done, total: cards.length }) as Project
    nextMessages = messagesFrom(current.notes, crew, KEEP_MESSAGES) as Message[]
  } else {
    const tickets = cachedTickets()
    const pinned = roster.flatMap(agent => {
      const ticket = ticketOf(agent, byDish)
      return ticket === null ? [] : [ticket]
    })
    nextWork = toWorkLanes(ticketCards(tickets, laneOf), pinned) as WorkLane[]
    nextProject = projectOf({ mode: 'tickets', repo, count: tickets.length }) as Project
  }
  // Set before the writes, so the redraw each write causes places agents on the right cards.
  currentDish = current ? current.dish : null
  if (!same(await read($, work), nextWork)) await update($, work, () => nextWork)
  if (!same(await read($, project), nextProject)) await update($, project, () => nextProject)
  if (!same(await read($, messages), nextMessages)) await update($, messages, () => nextMessages)
}

// The repo's learnings as last parsed, with the mtime of the file they came from.
let learned: { mtimeMs: number; value: Learnings } | null = null

// Reads .brigade/LEARNINGS.md, only when its mtime moved, and stores the newest few learnings.
// No file means no learnings.
async function refreshLearnings($: EngineInterface) {
  const path = `${await rootOf($)}/.brigade/LEARNINGS.md`
  let next: Learnings = { total: 0, lines: [] }
  if (await $.fs.exists(path)) {
    const { mtimeMs } = await $.fs.stat(path)
    next = learned !== null && learned.mtimeMs === mtimeMs ? learned.value : (learningsFrom(await $.fs.read(path), KEEP_LEARNINGS) as Learnings)
    learned = { mtimeMs, value: next }
  }
  if (!same(await read($, learnings), next)) await update($, learnings, () => next)
}

// Puts what each agent was last seen doing on the roster, in one write, and only when that
// changes something. The waiting entries are taken first, so calls that land meanwhile wait
// for the next tick rather than being lost.
async function foldActivities($: EngineInterface) {
  if (activities.size === 0) return
  const events = [...activities].map(([id, text]) => ({ type: 'activity', id, text }))
  activities.clear()
  const apply = (roster: Fleet) => events.reduce((next, event) => applyEvent(next, event) as Fleet, roster)
  const before = await read($, fleet)
  if (same(before, apply(before))) return
  await update($, fleet, apply)
}

// Re-reads the disk, the roster's latest doings and the context figures, and stores what changed.
// Runs on a timer, so it never throws: a failed part just leaves its piece of the board as it was
// until the next tick. Overlapping calls share one pass, so a slow tick can't land on top of a
// newer one.
let running: Promise<void> | null = null
const refresh = async ($: EngineInterface) => {
  if (running) return running
  running = (async () => {
    pass++
    try {
      // Agents that finished more than two minutes ago leave the board. Only a pass that
      // drops someone writes, so an idle board never redraws.
      const now = await $.clock.now()
      const before = await read($, fleet)
      if ((prune(before, now, KEEP_MS) as Fleet).order.length !== before.order.length) {
        await update($, fleet, roster => prune(roster, now, KEEP_MS) as Fleet)
        // Agents that left stop holding a tool-call count.
        const after = await read($, fleet)
        for (const id of [...toolLooks.keys()]) if (!Object.hasOwn(after.agents, id)) toolLooks.delete(id)
      }
    } catch {
      // The roster stays as it was.
    }
    try {
      await foldActivities($)
    } catch {
      // Agents keep saying what they said before.
    }
    try {
      await refreshTickets($)
    } catch {
      // The tickets stay as they were.
    }
    try {
      await refreshDishes($)
    } catch {
      // The dishes stay as they were.
    }
    try {
      await refreshWork($)
    } catch {
      // The lanes, header and messages stay as they were.
    }
    try {
      await refreshDetail($)
    } catch {
      // The detail box stays as it was.
    }
    try {
      await refreshLearnings($)
    } catch {
      // The learnings stay as they were.
    }
    try {
      const next = forecast((await $.session.usage()).context) as Weather
      if (!same(await read($, weather), next)) await update($, weather, () => next)
    } catch {
      // The context reading stays as it was.
    }
  })().finally(() => {
    running = null
  })
  return running
}

// What the detail box is about: the kind of thing clicked and its id, or null when no box is up.
// The box itself lives in state; this is what each tick rebuilds it from.
type Target = { kind: 'card' | 'agent' | 'message'; id: string }
let target: Target | null = null
// Goes up on every open and close, so a rebuild that started before one can't put back a box
// that has since closed, or swap in the box for an older click.
let generation = 0

const KINDS = new Set(['card', 'agent', 'message'])
const MAX_ID = 200
// A note's place inside its dish folder that is safe to put in a path.
const NOTE_PATH = /^(briefs|reports|state)\/[A-Za-z0-9._-]+\.md$/
// How many lines of an agent's working memory the box shows, and of a message's source file.
const MEMORY_LINES = 8
const BODY_LINES = 12

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// What the pane asked for, when it is exactly `{ open: { kind, id } }` or `{ close: true }`.
// The pane is our own code, but its message crosses a boundary, so anything else is dropped.
function requestOf(data: unknown): { open: Target } | { close: true } | null {
  if (!isPlain(data)) return null
  const keys = Object.keys(data)
  if (keys.length !== 1) return null
  if (keys[0] === 'close') return data.close === true ? { close: true } : null
  if (keys[0] !== 'open') return null
  const open = data.open
  if (!isPlain(open)) return null
  const fields = Object.keys(open)
  if (fields.length !== 2 || !Object.hasOwn(open, 'kind') || !Object.hasOwn(open, 'id')) return null
  const { kind, id } = open
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null
  if (typeof id !== 'string' || id === '' || id.length > MAX_ID) return null
  return { open: { kind: kind as Target['kind'], id } }
}

// A file's text, or null when it isn't there.
async function readIfThere($: EngineInterface, path: string) {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : null
}

// The first `limit` non-empty lines of a file after its frontmatter.
function bodyLines(text: string, limit: number) {
  const lines = text.split(/\r?\n/)
  let start = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end !== -1) start = end + 1
  }
  return lines.slice(start).filter(line => line.trim() !== '').slice(0, limit)
}

// The first paragraph under a ticket's `## Goal` heading, as one line, or '' when it has none.
function goalOf(text: string) {
  const out: string[] = []
  let inGoal = false
  for (const line of text.split(/\r?\n/)) {
    const bare = line.trim()
    if (!inGoal) {
      if (bare === '## Goal') inGoal = true
      continue
    }
    if (bare === '') {
      if (out.length > 0) break
      continue
    }
    if (bare.startsWith('#')) break
    out.push(bare)
  }
  return out.join(' ')
}

// Whether a ticket file name from our own listing of the ticket folder is safe to read: a
// markdown file right in that folder, not a hidden one, and nothing that could reach another folder.
function isTicketFile(name: string) {
  return name.endsWith('.md') && !/[\\/]/.test(name) && !name.startsWith('.')
}

// The newest note of one kind, by time; a note without a time counts as the oldest.
function newest(notes: Note[], kind: string) {
  const timeOf = (note: Note) => (Number.isFinite(note.at) ? note.at : 0)
  let best: Note | null = null
  for (const note of notes) if (note.kind === kind && (best === null || timeOf(note) > timeOf(best))) best = note
  return best
}

// A card's box. In a dish the id has to be one of the plan's items; on the ticket board it has
// to be a ticket we have read. Every path below comes from what the board already holds, never
// from the click: the dish and item slugs, a note's own file, a ticket's file name.
async function cardBox($: EngineInterface, id: string): Promise<Detail | null> {
  if (currentDish === null) return ticketBox($, id)
  const seen = dishesSeen.find(entry => entry.dish === currentDish)
  if (!seen || !SLUG.test(seen.dish)) return null
  const item = seen.plan.items.find(entry => entry.slug === id)
  if (!item || !SLUG.test(item.slug)) return null
  const crew = rosterAgents(await read($, fleet)).filter(agent => agent.dish === seen.dish)
  const [card] = workCards([item], seen.notes, crew) as { phase: string }[]
  const phaseTitle = PHASES.find(phase => phase.key === card?.phase)?.title ?? ''
  const mine = seen.notes.filter(note => note.item === item.slug)
  const report = newest(mine, 'report')
  const verdict = newest(mine, 'verdict')
  let findings: unknown[] = []
  if (verdict !== null && typeof verdict.file === 'string' && NOTE_PATH.test(verdict.file)) {
    const text = await readIfThere($, `${await rootOf($)}/.brigade/dishes/${seen.dish}/${verdict.file}`)
    if (text !== null) findings = findingsOf(text)
  }
  const agents = crew
    .filter(agent => agent.item === item.slug)
    .map(agent => ({ name: agent.name, role: roleLabel(agent.role), activity: agent.activity, state: agent.state }))
  return cardDetail({ item, phaseTitle, report, verdict, findings, agents }) as Detail
}

async function ticketBox($: EngineInterface, id: string): Promise<Detail | null> {
  const hit = Object.entries(cache).find(([, entry]) => entry.ticket !== null && entry.ticket.id === id)
  if (!hit || cacheDir === null) return null
  const [name, { ticket }] = hit
  let goal = ''
  if (isTicketFile(name)) {
    const text = await readIfThere($, `${cacheDir}/${name}`)
    if (text !== null) goal = goalOf(text)
  }
  return ticketDetail({ ticket, goal }) as Detail
}

// An agent's box, for an agent on the roster. Its working memory is read from its own dish and
// item, when both are plain slugs.
async function agentBox($: EngineInterface, id: string): Promise<Detail | null> {
  const roster = await read($, fleet)
  if (!Object.hasOwn(roster.agents, id)) return null
  const agent = roster.agents[id]
  if (agent == null) return null
  const ticket = ticketOf(agent, await read($, dishes))
  let memory: string[] = []
  if (typeof agent.dish === 'string' && typeof agent.item === 'string' && SLUG.test(agent.dish) && SLUG.test(agent.item)) {
    const text = await readIfThere($, `${await rootOf($)}/.brigade/dishes/${agent.dish}/state/${agent.item}.md`)
    if (text !== null) memory = ledgerTail(text, MEMORY_LINES)
  }
  return agentDetail({ agent: { ...agent, ticket }, roleLabel: roleLabel(agent.role), memory, now: await $.clock.now() }) as Detail
}

// A message's box, for a message in the Messages panel. The file it came from is the note's own,
// inside the dish on the board.
async function messageBox($: EngineInterface, id: string): Promise<Detail | null> {
  const message = (await read($, messages)).find(entry => entry.id === id)
  if (!message) return null
  let findings: unknown[] = []
  let body: string[] = []
  const dish = currentDish
  if (dish !== null && SLUG.test(dish) && typeof message.file === 'string' && NOTE_PATH.test(message.file)) {
    const text = await readIfThere($, `${await rootOf($)}/.brigade/dishes/${dish}/${message.file}`)
    if (text !== null) {
      if (envelope(text).doc === 'verdict') findings = findingsOf(text)
      body = bodyLines(text, BODY_LINES)
    }
  }
  return messageDetail({ message, findings, body }) as Detail
}

// The box for a target, or null when the board no longer holds what it is about.
function boxFor($: EngineInterface, want: Target) {
  if (want.kind === 'card') return cardBox($, want.id)
  if (want.kind === 'agent') return agentBox($, want.id)
  return messageBox($, want.id)
}

// Whether two targets are about the same thing. Two nulls match: no box either way.
function sameTarget(a: Target | null, b: Target | null) {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id)
}

// Stores the box while `still()` says it is current. It is asked again inside the write itself,
// so an open or a close that lands during the read just before can't be written over.
async function showDetail($: EngineInterface, next: Detail | null, still: () => boolean) {
  if (!still()) return
  if (same(await read($, detail), next)) return
  await update($, detail, current => (still() ? next : current))
}

// Opens or closes the box for what the pane posted. An open whose subject the board doesn't hold
// leaves everything as it was.
async function detailFrom($: EngineInterface, data: unknown) {
  const request = requestOf(data)
  if (request === null) return
  const mine = ++generation
  const current = () => mine === generation
  if ('close' in request) {
    target = null
    await showDetail($, null, current)
    return
  }
  const built = await boxFor($, request.open)
  if (built === null || mine !== generation) return
  target = request.open
  await showDetail($, built, current)
}

// Rebuilds the open box so it stays current, and takes it down once its subject has gone. A box
// with nothing behind it, left over from before a reload, comes down too. A click can land while
// the rebuild is reading files, so the box is only written while the stored target is still the
// one it was built for: a newer click's box, or a close, wins.
async function refreshDetail($: EngineInterface) {
  const mine = generation
  const want = target
  const built = want === null ? null : await boxFor($, want)
  if (mine !== generation || !sameTarget(target, want)) return
  const after = built === null ? null : want
  target = after
  await showDetail($, built, () => mine === generation && sameTarget(target, after))
}

// Whether this module load has started its refresh timer. A reload runs the module again and
// starts over; a session.start that fires again within one load leaves the timer alone.
let ticking = false

// The role's label, or the role itself when the board doesn't know it.
function roleLabel(role: string) {
  return Object.hasOwn(ROLES, role) ? ROLES[role as keyof typeof ROLES].label : role
}

// 'To do 2: usage-docs, admin-toggle', or just 'To do 0' for an empty lane.
function laneLine(lane: WorkLane) {
  const head = `${lane.title} ${lane.total}`
  return lane.cards.length === 0 ? head : `${head}: ${lane.cards.map(card => card.id).join(', ')}`
}

// 'Miso · cook · token-bucket · editing bucket.ts', leaving out whatever isn't known.
function agentLine(agent: Agent) {
  return [agent.name, roleLabel(agent.role), agent.item ?? agent.ticket, agent.activity].filter(part => typeof part === 'string' && part !== '').join(' · ')
}

// The plain-text board's longest line, and how many agents it lists before counting the rest.
const PLAIN_MAX = 200
const PLAIN_AGENTS = 12

// One line of the plain-text board. Its text comes from files and tool calls, so control
// characters become spaces, invisible marks go, and it is cut to PLAIN_MAX characters.
function plain(text: string) {
  return Array.from(safeText(text)).slice(0, PLAIN_MAX).join('')
}

function contextLine(reading: Weather | null) {
  const percent = reading?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? `Context ${percent}%` : 'Context --'
}

// The desktop app can't load the board's drawing region, so there the board is a picture with a
// row of buttons under it that open the detail box. The app refuses a picture wider or taller
// than this many pixels, and it checks that after the hook has returned, so we check first.
const PICTURE_MAX_PX = 4096
// How many buttons of each kind go under the picture, and the longest label a button gets.
const BUTTON_CARDS = 12
const BUTTON_AGENTS = 12
const BUTTON_MESSAGES = 4
const LABEL_MAX = 24

type Picture = { source: string; width: number; height: number }
type DetailButton = { key: string; label: string; open: Target }

// A string, or the fallback when it is missing or empty.
function or(value: unknown, fallback: string) {
  return typeof value === 'string' && value !== '' ? value : fallback
}

// A button label from file text. Control characters become spaces and invisible marks go, as on
// every board line; half of a surrogate pair and the engine's own placeholder character go too,
// because the app refuses a button whose label holds one. Cut to LABEL_MAX characters, and a
// label with nothing left to read says what kind of thing the button opens.
function labelOf(text: string, kind: string) {
  const kept = Array.from(safeText(text)).filter(ch => !/^[\ud800-\udfff]$/.test(ch) && ch !== '\u{10eeee}')
  const label = kept.slice(0, LABEL_MAX).join('')
  return label.trim() === '' ? kind : label
}

// An agent's tooltip, on one line: 'Basil · cook · claude-haiku-4-5 · editing bucket.ts'.
function tooltipOf(agent: Agent) {
  return plain([or(agent.name, agent.id), roleLabel(agent.role), or(agent.model, 'unknown model'), or(agent.activity, agent.state)].join(' · '))
}

// The board as one SVG picture: every sprite where the walk has got it to, or at its home when it
// hasn't started, stepping between its two frames, with a tooltip over each one. Throws when the
// board is too big for a picture the app will draw.
function pictureFor(snapshot: Snapshot, positions: Stage['positions']): Picture {
  const still = { positions, hovered: null, over: null }
  const zero = draw(snapshot, { ...still, frame: 0 }, PANE_COLUMNS)
  const one = draw(snapshot, { ...still, frame: 1 }, PANE_COLUMNS)
  // The painter names each sprite by the safe form of its agent's id.
  const byId = new Map(snapshot.agents.map(agent => [safeText(agent.id), agent]))
  const titles = (zero.regions as { kind: string; id: string; x: number; y: number; w: number; h: number }[]).flatMap(region => {
    const agent = region.kind === 'agent' ? byId.get(region.id) : undefined
    return agent ? [{ x: region.x, y: region.y, w: region.w, h: region.h, text: tooltipOf(agent) }] : []
  })
  const picture = pictureOf({ rows: zero.rows, altRows: one.rows, columns: PANE_COLUMNS, titles }) as Picture
  const fits = (px: number) => Number.isFinite(px) && px > 0 && px <= PICTURE_MAX_PX
  if (!fits(picture.width) || !fits(picture.height)) throw new Error('the board is too big for a picture')
  return picture
}

// The buttons that open the detail box on desktop, in the board's own order: the cards lane by
// lane, the agents as they arrived, then the messages the Messages panel shows. Each key says only
// the kind and the place in the row, so no file text ever becomes an address.
function detailButtons(snapshot: Snapshot): DetailButton[] {
  const cards = snapshot.lanes.flatMap(lane => lane.cards).slice(0, BUTTON_CARDS)
  const agents = snapshot.agents.slice(0, BUTTON_AGENTS)
  const shown = snapshot.messages.slice(0, BUTTON_MESSAGES)
  return [
    ...cards.map((card, i) => ({ key: `card-${i}`, label: labelOf(card.id, 'card'), open: { kind: 'card' as const, id: card.id } })),
    ...agents.map((agent, i) => ({ key: `agent-${i}`, label: labelOf(agent.name, 'agent'), open: { kind: 'agent' as const, id: agent.id } })),
    ...shown.map((message, i) => ({ key: `message-${i}`, label: labelOf(`${message.from} → ${message.to}`, 'message'), open: { kind: 'message' as const, id: message.id } })),
  ]
}

// What a button under the picture does when pressed: the same open or close a click on the board
// posts. A press comes after the drawing, so it may write. A failure leaves the box as it was.
async function pressed($: EngineInterface, data: unknown) {
  try {
    await detailFrom($, data)
  } catch {
    // The detail box stays as it was until the next press.
  }
}

type Elements = ReturnType<EngineInterface['ui']['resolve']>
type Run = { text: string; color: string; backgroundColor: string; bold: boolean }

// The row of buttons under a board the hooks module draws itself: `Details:`, then Close details
// while a box is up, then one button per card, agent and message. An empty board gets no row.
function detailRow($: EngineInterface, { Box, Button, Text }: Elements, snapshot: Snapshot) {
  const closing = snapshot.detail !== null ? [{ key: 'close-details', label: 'Close details' }] : []
  const opening = detailButtons(snapshot)
  if (closing.length + opening.length === 0) return []
  return [
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text>Details:</Text>
      {closing.map(button => (
        <Button key={button.key} label={button.label} role="dismiss" onPress={() => pressed($, { close: true })} />
      ))}
      {opening.map(button => (
        <Button key={button.key} label={button.label} onPress={() => pressed($, { open: button.open })} />
      ))}
    </Box>,
  ]
}

// The app refuses a drawing holding more than 100000 characters of text, and checks that after the
// hook has returned, so the rows are measured first. The margin leaves room for the buttons.
const ROWS_MAX_CHARS = 99000

// The painted board as rows of coloured text runs, the way the terminal's region draws it, with
// every sprite where the walk has got it to. The terminal is monospaced, so the rows line up.
// Throws when the board is too big for the app to draw as text.
function boardRows(snapshot: Snapshot, positions: Stage['positions']) {
  const rows = draw(snapshot, { positions, frame: 0, hovered: null, over: null }, PANE_COLUMNS).rows as Run[][]
  const chars = rows.reduce((sum, runs) => sum + runs.reduce((inRow, run) => inRow + String(run.text).length, 0), 0)
  if (chars > ROWS_MAX_CHARS) throw new Error('the board is too big to draw as rows')
  return rows
}

// How often the walk takes a step while the pane is open, and how long a terminal waits for its
// region to report in before drawing the board itself.
const STEP_MS = 500
const FALLBACK_MS = 3000

// How the pane was last drawn: by the terminal's region, as a picture, as rows drawn here, or as
// plain lines. A render may not write state, so it notes this here and the walk's step reads it.
let drawnAs: 'region' | 'picture' | 'rows' | 'lines' | null = null
// The walk's clock while the pane is open. There is never more than one.
let walker: { cancel(): void } | null = null
// A region has reported in. Kept here as well as in state so that a step in a healthy terminal
// returns without reading anything.
let regionReady = false
// A step is still running, so a slow one can't overlap the next.
let stepping = false

// Notes that the pane is open and starts the walk. Running the command on a pane that is already
// open changes nothing, so a second clock never starts. Whether the region reported in, and the
// fallback, carry over from earlier opens: a terminal whose region drew once keeps it, and one
// whose region never drew goes straight to its rows.
async function openStage($: EngineInterface) {
  if (walker !== null) return
  const at = await $.clock.now()
  await update($, stage, current => ({ ...current, open: true, openedAt: at }))
  // Another open may have started the clock while this one was writing.
  if (walker !== null) return
  walker = $.clock.every(STEP_MS, () => {
    void step($)
  })
}

// Stops the walk when the pane closes. The clock goes first, so a failed write can't leave it
// running. The sprites keep their places for the next open.
async function closeStage($: EngineInterface) {
  const running = walker
  walker = null
  running?.cancel()
  if ((await read($, stage)).open) await update($, stage, current => ({ ...current, open: false }))
}

// One tick of the walk's clock. In a terminal whose region reported in there is nothing to do. In a
// terminal still waiting on its region, the step checks whether it has waited too long. Where the
// board is drawn here, as a picture or as rows, the sprites take a step. Runs on a timer, so it
// never throws.
async function step($: EngineInterface) {
  const how = drawnAs
  if (stepping || (how === 'region' && regionReady)) return
  if (how !== 'region' && how !== 'picture' && how !== 'rows') return
  stepping = true
  try {
    const now = await read($, stage)
    if (!now.open) return
    if (how === 'region') await fallBack($, now)
    else await walk($, now)
  } catch {
    // This step is skipped; the next one tries again.
  } finally {
    stepping = false
  }
}

// A terminal region that hasn't reported in by FALLBACK_MS after the pane opened is taken for one
// that failed to load, and the pane switches to rows drawn here. Ready is checked again inside the
// write, so a region that reports in at the last moment still wins.
async function fallBack($: EngineInterface, now: Stage) {
  if (now.ready) {
    regionReady = true
    return
  }
  if (now.plain || now.openedAt === null) return
  if ((await $.clock.now()) - now.openedAt < FALLBACK_MS) return
  await update($, stage, current => (current.ready ? current : { ...current, plain: true }))
}

// Moves every sprite one step toward its home on the board as it stands now. Nothing moving means
// nothing written, so a settled board never redraws.
async function walk($: EngineInterface, now: Stage) {
  const plan = arrange(await snapshotOf($), PANE_COLUMNS) as { homes: Record<string, unknown>; obstacles: unknown[] }
  const next = advance(now.positions, plan.homes, plan.obstacles) as Stage['positions']
  if (same(now.positions, next)) return
  await update($, stage, current => ({ ...current, positions: next }))
}

// Whether a post is exactly the region's `{ ready: true }`, with nothing else in it.
function isReady(data: unknown) {
  return isPlain(data) && Object.keys(data).length === 1 && Object.hasOwn(data, 'ready') && data.ready === true
}

// The terminal's region drew. From now on the step leaves the terminal alone, and a pane that had
// fallen back to rows gets its region again.
async function reportIn($: EngineInterface) {
  regionReady = true
  const now = await read($, stage)
  if (now.ready && !now.plain) return
  await update($, stage, current => ({ ...current, ready: true, plain: false }))
}

export const register: Register = on => {
  // Every hook below follows one rule: the board's own work is wrapped so its failure is
  // swallowed, and the hook hands back exactly what next(e) gave it, or lets what next(e) threw
  // pass through untouched. The session must never wait on, or break over, the board.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'brigade-board', description: 'Open the brigade board' })
    } catch {
      // No board command this session; the session goes on.
    }
    try {
      // The first scan runs on its own; refresh never throws, and the session doesn't wait for it.
      void refresh($)
      if (!ticking) {
        $.clock.every(TICK_MS, () => {
          void refresh($)
        })
        ticking = true
      }
    } catch {
      // The board stays as it was until the board command opens it.
    }
    return next(e)
  })

  on('command.run', { command: 'brigade-board' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Brigade board', columns: PANE_COLUMNS })
    try {
      await openStage($)
    } catch {
      // The board shows without walking until the next open.
    }
    return { text: 'Board opened.' }
  })

  on('ui.close', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (e.id === PANE) await closeStage($)
    } catch {
      // The clock has already stopped; only the stage's open flag may be stale.
    }
    return ran
  })

  // Every agent of the session goes on the board as it starts, works and finishes. These hooks
  // run for every tool call and model request, so each one does as little as it can and always
  // hands the event on unchanged.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    try {
      // A refused spawn, or one that resolved to nothing, started no agent to put on the board.
      if (ran != null && ran.agentId !== undefined) {
        await record($, {
          type: 'spawn',
          id: ran.agentId,
          model: ran.model,
          description: e.description,
          subagentType: e.subagentType,
          name: e.name,
          prompt: e.prompt,
        })
      }
    } catch {
      // The agent stays off the board.
    }
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    const ran = yield* next(e)
    try {
      const usage = ran?.usage
      const tokens = usage ? usage.input_tokens + usage.output_tokens : 0
      // A step without an agent id is the main loop, which is the Planner.
      if (e.agentId === undefined) await record($, { type: 'step', id: 'main', model: e.model, tokens }, true)
      else await record($, { type: 'step', id: e.agentId, model: e.model, tokens })
    } catch {
      // The step goes uncounted.
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    const fields = e as unknown as Record<string, unknown>
    // What the call does, for saying what its agent is doing and for working out its role.
    let act: { tool: unknown; filePath: unknown; command: unknown } | null = null
    try {
      act = { tool: fields.tool, filePath: fields.file_path, command: fields.command }
      // Every call says what its agent is doing, for the agent's whole life: no cap, no state.
      const doing = activityOf(act)
      if (typeof doing === 'string') activities.set(id ?? 'main', doing)
    } catch {
      // The agent keeps saying what it said before.
    }
    if (id === undefined || act === null) return next(e)
    try {
      // Every call counts toward the cap, so past it an agent's tool calls cost nothing more here.
      const looks = toolLooks.get(id) ?? 0
      if (looks < TOOL_LOOKS) toolLooks.set(id, looks + 1)
      if (looks < TOOL_LOOKS) {
        const paths = [fields.file_path, fields.command].filter(value => typeof value === 'string')
        // A write can tell us the role; reads and mentions never do.
        await learn($, { type: 'tool', id, paths, act })
      }
    } catch {
      // Nothing learned from this call.
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId !== undefined) await record($, { type: 'complete', id: e.agentId, reason: e.reason })
    } catch {
      // The agent keeps its last state on the board.
    }
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId === PANE) {
      try {
        if (isReady(e.data)) await reportIn($)
        else await detailFrom($, e.data)
      } catch {
        // The detail box, or the region's ready flag, stays as it was until the next post.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snapshot = await snapshotOf($)
    const shown = await read($, stage)
    const elements = $.ui.resolve(e)
    const { Box, Client, Svg, Text } = elements
    if (e.surface === 'terminal' && !shown.plain) {
      drawnAs = 'region'
      return <Client key="stage" module="./screen.tsx" width="100%" props={snapshot} />
    }
    // The terminal whose region never reported in gets the painted board as rows; desktop can't
    // load a region at all and gets it as a picture. Either way the detail box, when it is up, is
    // already drawn in, and the buttons that open it sit underneath.
    try {
      if (e.surface === 'terminal') {
        const rows = (
          <Box flexDirection="column">
            {boardRows(snapshot, shown.positions).map(runs => (
              <Text>
                {runs.map(run => (
                  <Text color={run.color} backgroundColor={run.backgroundColor} bold={run.bold}>
                    {run.text}
                  </Text>
                ))}
              </Text>
            ))}
            {detailRow($, elements, snapshot)}
          </Box>
        )
        drawnAs = 'rows'
        return rows
      }
      if (e.surface === 'desktop') {
        const picture = pictureFor(snapshot, shown.positions)
        const drawn = (
          <Box flexDirection="column">
            <Svg source={picture.source} alt="Brigade board" width={picture.width} height={picture.height} isInteractive={true} />
            {detailRow($, elements, snapshot)}
          </Box>
        )
        drawnAs = 'picture'
        return drawn
      }
    } catch {
      // Not drawn this time; the plain lines below still show the board.
    }
    drawnAs = 'lines'
    // Surfaces without a region get the same board as plain lines. Text from files only ever
    // goes through Text, so nothing in it can turn into a link or markup, and every line goes
    // through plain first. A crowd of agents is listed up to a dozen, then counted.
    const listed = snapshot.agents.slice(0, PLAIN_AGENTS)
    const unlisted = snapshot.agents.length - listed.length
    return (
      <Box flexDirection="column">
        <Text bold>{plain(snapshot.project.title)}</Text>
        <Text>{plain(snapshot.project.detail)}</Text>
        <Text>{plain(contextLine(snapshot.weather))}</Text>
        {snapshot.lanes.map(lane => (
          <Text>{plain(laneLine(lane))}</Text>
        ))}
        {listed.map(agent => (
          <Text>{plain(agentLine(agent))}</Text>
        ))}
        {(unlisted > 0 ? [`+${unlisted} more`] : []).map(line => (
          <Text>{line}</Text>
        ))}
        {snapshot.messages.slice(0, SHOW_MESSAGES).map(message => (
          <Text>{plain(`${message.from} → ${message.to}: ${message.text}`)}</Text>
        ))}
      </Box>
    )
  })
}
