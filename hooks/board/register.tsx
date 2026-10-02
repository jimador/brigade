import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Fleet, Lane, Memory, Note, Snapshot, Weather } from '../../types'
import { boardDirFrom, laneOf, parseTicket, toLanes } from './lib/board.mjs'
import { latest, ledgerTail, noteFrom, planInfo } from './lib/dish.mjs'
import { applyEvent, prune } from './lib/fleet.mjs'
import { ROLES } from './lib/sprites.mjs'
import { forecast } from './lib/weather.mjs'

const PANE = 'brigade-board'
const lanes = atom({ plugin: 'brigade', key: 'lanes' } as const, [] as Lane[])
const fleet = atom({ plugin: 'brigade', key: 'fleet' } as const, { agents: {}, order: [] } as Fleet)
const weather = atom({ plugin: 'brigade', key: 'weather' } as const, null as Weather | null)
const selected = atom({ plugin: 'brigade', key: 'selected' } as const, null as string | null)
// Which ticket each dish belongs to, by dish slug. Filled in elsewhere; a missing dish is just unknown.
const dishes = atom({ plugin: 'brigade', key: 'dishes' } as const, {} as Record<string, string>)
// The newest things agents wrote (reports, verdicts, briefs, memory updates), newest first.
const notes = atom({ plugin: 'brigade', key: 'notes' } as const, [] as Note[])
// The working memory of the agent the operator clicked. `lines` is null when the agent has no
// memory file yet. It lives in state so that storing it redraws the pane straight away.
const memory = atom({ plugin: 'brigade', key: 'memory' } as const, null as Memory | null)

// How long a finished agent stays on the board before it leaves.
const KEEP_MS = 120000
// The most tool calls we look at per agent while working out who it is. It is generous because
// a cook explores for a good while before its first write, and an inspector writes its verdict
// last. An agent that never gives itself away still stops costing anything after this many.
// Counted per agent id, for the life of the session.
const TOOL_LOOKS = 400
const toolLooks = new Map<string, number>()

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

// The ticket id and status of every ticket in the cache, so an agent's lane can be looked up.
function statusById() {
  const out = new Map<string, string>()
  for (const hit of Object.values(cache)) if (hit.ticket) out.set(hit.ticket.id, hit.ticket.status)
  return out
}

// The ticket an agent is working, through its dish. Null when either is unknown.
function ticketOf(agent: Agent, byDish: Record<string, string>) {
  if (agent.dish == null || !Object.hasOwn(byDish, agent.dish)) return null
  const id = byDish[agent.dish]
  return typeof id === 'string' && id !== '' ? id : null
}

// Everything the board draws, read from state so the pane redraws when any of it changes.
// An agent's ticket and lane are worked out here, fresh each time, from its dish and the
// ticket cache; an agent without a known ticket waits on the bench.
async function snapshotOf($: EngineInterface): Promise<Snapshot> {
  const roster = await read($, fleet)
  const byDish = await read($, dishes)
  const statuses = statusById()
  const agents = roster.order
    .map(id => roster.agents[id])
    .filter(agent => agent != null)
    .map((agent): Agent => {
      const ticket = ticketOf(agent, byDish)
      const status = ticket === null ? undefined : statuses.get(ticket)
      return { ...agent, ticket, lane: status === undefined ? 'bench' : laneOf(status) }
    })
  return {
    lanes: await read($, lanes),
    agents,
    weather: await read($, weather),
    selected: await read($, selected),
    now: await $.clock.now(),
  }
}

// The pane's region posts what it wants selected. That comes from code, so only a known
// agent id or null gets through; anything else is dropped.
async function selectFrom($: EngineInterface, data: unknown) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== 'select') return
  const pick = (data as { select: unknown }).select
  if (pick === null) {
    await update($, selected, () => null)
    return
  }
  if (typeof pick !== 'string') return
  const roster = await read($, fleet)
  if (!Object.hasOwn(roster.agents, pick)) return
  await update($, selected, () => pick)
}

type Ticket = NonNullable<ReturnType<typeof parseTicket>>

// Tickets we have already parsed, by file name, with the mtime we read them at. A file is only
// read again when its mtime moves, so a quiet board costs one folder listing per tick.
let cacheDir: string | null = null
let cache: Record<string, { mtimeMs: number; ticket: Ticket | null }> = {}

// Whether two plain values would store the same, so an idle board skips the write and never redraws.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Rebuilds the lanes from the ticket folder named in .brigade/config.md. Any missing piece
// (config, folder, a file that won't read) stops here and the lanes keep what they had.
async function refreshLanes($: EngineInterface) {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
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
  const tickets = Object.values(fresh).flatMap(hit => (hit.ticket ? [hit.ticket] : []))
  // Tickets an agent is working always show, however full their lane is.
  const roster = await read($, fleet)
  const byDish = await read($, dishes)
  const pinned = roster.order.flatMap(id => {
    const agent = roster.agents[id]
    const ticket = agent ? ticketOf(agent, byDish) : null
    return ticket === null ? [] : [ticket]
  })
  const next = toLanes(tickets, 6, pinned) as Lane[]
  if (!same(await read($, lanes), next)) await update($, lanes, () => next)
}

// Only dishes whose PLAN.md moved in the last day get their folders scanned for notes.
const RECENT_MS = 24 * 60 * 60 * 1000
// How many notes the board keeps, and how many it shows.
const KEEP_NOTES = 12
const SHOW_NOTES = 8
// How many live lines of the clicked agent's working memory to show.
const MEMORY_LINES = 8
// The folders inside a dish that hold notes: research briefs, cook and inspector reports, and
// each agent's working memory.
const NOTE_DIRS = ['briefs', 'reports', 'state']

type Plan = ReturnType<typeof planInfo>
// Dish files we have already read, by full path, with the mtime we read them at. A file is only
// read again when its mtime moves, so quiet dishes cost a few folder listings per tick.
let dishCache: Record<string, { mtimeMs: number; plan?: Plan; note?: Note | null }> = {}

// Reads every dish's plan to learn which ticket it belongs to, and gathers the newest notes
// from the dishes that are still moving. Missing folders are skipped; a file that won't read
// throws, and the board keeps what it had until the next tick.
async function refreshNotes($: EngineInterface) {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  const base = `${root}/.brigade/dishes`
  if (!(await $.fs.exists(base))) return
  const now = await $.clock.now()
  const fresh: typeof dishCache = {}
  const byDish: [string, string][] = []
  const all: Note[] = []
  for (const folder of await $.fs.list(base)) {
    if (folder.kind !== 'dir') continue
    const dir = `${base}/${folder.name}`
    const inside = await $.fs.list(dir)
    const planEntry = inside.find(entry => entry.kind === 'file' && entry.name === 'PLAN.md')
    if (!planEntry) continue
    const planPath = `${dir}/PLAN.md`
    const knownPlan = dishCache[planPath]
    const plan =
      knownPlan && knownPlan.mtimeMs === planEntry.mtimeMs && knownPlan.plan
        ? knownPlan.plan
        : planInfo(await $.fs.read(planPath))
    fresh[planPath] = { mtimeMs: planEntry.mtimeMs, plan }
    if (plan.dish !== '' && plan.ticket !== '') byDish.push([plan.dish, plan.ticket])
    if (now - planEntry.mtimeMs > RECENT_MS) continue
    for (const sub of NOTE_DIRS) {
      if (!inside.some(entry => entry.kind === 'dir' && entry.name === sub)) continue
      for (const entry of await $.fs.list(`${dir}/${sub}`)) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
        const path = `${dir}/${sub}/${entry.name}`
        const known = dishCache[path]
        const note =
          known && known.mtimeMs === entry.mtimeMs && known.note !== undefined
            ? known.note
            : (noteFrom(await $.fs.read(path), entry.mtimeMs) as Note | null)
        fresh[path] = { mtimeMs: entry.mtimeMs, note }
        if (note) all.push(note)
      }
    }
  }
  // Only a complete pass replaces the cache, which also drops files that have gone.
  dishCache = fresh
  // fromEntries makes plain own keys, so a dish slug like "__proto__" can't touch the prototype.
  const nextDishes = Object.fromEntries(byDish) as Record<string, string>
  if (!same(await read($, dishes), nextDishes)) await update($, dishes, () => nextDishes)
  const nextNotes = latest(all, KEEP_NOTES) as Note[]
  if (!same(await read($, notes), nextNotes)) await update($, notes, () => nextNotes)
}

// Reads the working memory of the clicked agent, when it is one with a dish and an item, and
// stores it only when it changed, so an idle board never redraws.
async function refreshMemory($: EngineInterface) {
  const id = await read($, selected)
  const agent = id === null ? undefined : (await read($, fleet)).agents[id]
  let next: Memory | null = null
  if (id !== null && agent && agent.dish != null && agent.item != null) {
    const root = (await $.session.root()).replace(/[\\/]+$/, '')
    const path = `${root}/.brigade/dishes/${agent.dish}/state/${agent.item}.md`
    const lines = (await $.fs.exists(path)) ? (ledgerTail(await $.fs.read(path), MEMORY_LINES) as string[]) : null
    next = { id, name: agent.name, lines }
  }
  if (!same(await read($, memory), next)) await update($, memory, () => next)
}

// One line per note: time (UTC), who wrote it, for which item, and what it says. A time no date
// can hold (infinite, or past the year 275760) shows as --:-- rather than breaking the pane.
function noteLine(note: Note) {
  const when = new Date(typeof note.at === 'number' ? note.at : NaN)
  const time = Number.isNaN(when.getTime()) ? '--:--' : when.toISOString().slice(11, 16)
  return `${time} ${note.role} ${note.item} · ${note.kind} ${note.gist}`
}

// The memory lines as one fenced code block, so nothing in them renders as a link. The fence is
// longer than any run of backticks inside, so the text can't close it early.
function memoryBlock(lines: string[]) {
  const body = lines.join('\n')
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${body}\n${fence}`
}

// Re-reads the ticket folder and the context figures and stores what changed. Runs on a timer,
// so it never throws: a failed read just leaves the board as it was until the next tick.
// Overlapping calls share one pass, so a slow tick can't land on top of a newer one.
let running: Promise<void> | null = null
const refresh = async ($: EngineInterface) => {
  if (running) return running
  running = (async () => {
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
      await refreshLanes($)
    } catch {
      // Lanes stay as they were.
    }
    try {
      await refreshNotes($)
    } catch {
      // Notes and the dish tickets stay as they were.
    }
    try {
      await refreshMemory($)
    } catch {
      // The memory shown stays as it was.
    }
    try {
      const next = forecast((await $.session.usage()).context) as Weather
      if (!same(await read($, weather), next)) await update($, weather, () => next)
    } catch {
      // Weather stays as it was.
    }
  })().finally(() => {
    running = null
  })
  return running
}

// Whether this module load has started its five-second refresh. A reload runs the module again
// and starts over; a session.start that fires again within one load leaves the timer alone.
let ticking = false

function markOf(role: string) {
  return (Object.hasOwn(ROLES, role) ? ROLES[role as keyof typeof ROLES] : ROLES.agent).mark
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
        $.clock.every(5000, () => {
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
    await $.ui.open({ id: PANE, title: 'Brigade board' })
    return { text: 'Board opened.' }
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
    if (id === undefined) return next(e)
    try {
      // Every call counts toward the cap, so past it an agent's tool calls cost nothing at all.
      const looks = toolLooks.get(id) ?? 0
      if (looks < TOOL_LOOKS) toolLooks.set(id, looks + 1)
      if (looks < TOOL_LOOKS) {
        const fields = e as unknown as Record<string, unknown>
        const paths = [fields.file_path, fields.command].filter(value => typeof value === 'string')
        // What the call does, so a write can tell us the role; reads and mentions never do.
        const act = { tool: fields.tool, filePath: fields.file_path, command: fields.command }
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
        await selectFrom($, e.data)
        // Read the clicked agent's memory now rather than on the next tick, so it shows at once.
        await refreshMemory($)
      } catch {
        // The selection and the memory shown stay as they were until the next click or tick.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snapshot = await snapshotOf($)
    const recent = (await read($, notes)).slice(0, SHOW_NOTES)
    const { Box, Client, Markdown, Text } = $.ui.resolve(e)
    // What agents wrote, and the clicked agent's memory. Note text comes from files, so it only
    // ever goes through Text; the memory goes through one Markdown as a code block.
    const current = await read($, memory)
    const shown = current !== null && current.id === snapshot.selected ? current : null
    const below = (
      <>
        <Text bold>NOTES</Text>
        {recent.map(note => (
          <Text>{noteLine(note)}</Text>
        ))}
        {shown !== null && <Text bold>{`MEMORY · ${shown.name}`}</Text>}
        {shown !== null &&
          (shown.lines === null ? <Text>no memory file yet</Text> : <Markdown text={memoryBlock(shown.lines)} />)}
      </>
    )
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      return (
        <Box flexDirection="column">
          <Client key="stage" module="./screen.tsx" width="100%" props={snapshot} />
          {below}
        </Box>
      )
    }
    // Surfaces without a region get the same board as plain lines.
    return (
      <Box flexDirection="column">
        <Text bold>BRIGADE</Text>
        {snapshot.lanes.map(lane => (
          <Text>
            {lane.title} {lane.total}
          </Text>
        ))}
        {snapshot.agents.map(agent => (
          <Text>
            {markOf(agent.role)} {agent.name} · {agent.model} · {agent.state}
          </Text>
        ))}
        {below}
      </Box>
    )
  })
}
