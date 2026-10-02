import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fleet, Lane, Snapshot, Weather } from '../../types'
import { boardDirFrom, parseTicket, toLanes } from './lib/board.mjs'
import { ROLES } from './lib/sprites.mjs'
import { forecast } from './lib/weather.mjs'

const PANE = 'brigade-board'
const lanes = atom({ plugin: 'brigade', key: 'lanes' } as const, [] as Lane[])
const fleet = atom({ plugin: 'brigade', key: 'fleet' } as const, { agents: {}, order: [] } as Fleet)
const weather = atom({ plugin: 'brigade', key: 'weather' } as const, null as Weather | null)
const selected = atom({ plugin: 'brigade', key: 'selected' } as const, null as string | null)

// Everything the board draws, read from state so the pane redraws when any of it changes.
async function snapshotOf($: EngineInterface): Promise<Snapshot> {
  const roster = await read($, fleet)
  return {
    lanes: await read($, lanes),
    agents: roster.order.map(id => roster.agents[id]).filter(agent => agent != null),
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
  const next = toLanes(tickets) as Lane[]
  if (!same(await read($, lanes), next)) await update($, lanes, () => next)
}

// Re-reads the ticket folder and the context figures and stores what changed. Runs on a timer,
// so it never throws: a failed read just leaves the board as it was until the next tick.
// Overlapping calls share one pass, so a slow tick can't land on top of a newer one.
let running: Promise<void> | null = null
const refresh = async ($: EngineInterface) => {
  if (running) return running
  running = (async () => {
    try {
      await refreshLanes($)
    } catch {
      // Lanes stay as they were.
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

function markOf(role: string) {
  return (Object.hasOwn(ROLES, role) ? ROLES[role as keyof typeof ROLES] : ROLES.agent).mark
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brigade-board', description: 'Open the brigade board' })
    await refresh($)
    $.clock.every(5000, () => {
      void refresh($)
    })
    return next(e)
  })

  on('command.run', { command: 'brigade-board' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Brigade board' })
    return { text: 'Board opened.' }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId === PANE) await selectFrom($, e.data)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snapshot = await snapshotOf($)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Box, Client } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Client key="stage" module="./screen.tsx" width="100%" props={snapshot} />
        </Box>
      )
    }
    // Surfaces without a region get the same board as plain lines.
    const { Box, Text } = $.ui.resolve(e)
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
      </Box>
    )
  })
}
