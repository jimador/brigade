import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fleet, Lane, Snapshot, Weather } from '../../types'
import { ROLES } from './lib/sprites.mjs'

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

function markOf(role: string) {
  return (Object.hasOwn(ROLES, role) ? ROLES[role as keyof typeof ROLES] : ROLES.agent).mark
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brigade-board', description: 'Open the brigade board' })
    return next(e)
  })

  on('command.run', { command: 'brigade-board' }, async $ => {
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
