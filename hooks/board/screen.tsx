import type { ClientSurface } from 'claude-code'

import type { Snapshot } from '../../types'
import { arrange } from './lib/board-layout.mjs'
import { draw } from './lib/board-paint.mjs'
import { advance } from './lib/stage.mjs'

type Cell = { x: number; y: number }
type Region = { kind: string; id: string; x: number; y: number; w: number; h: number }
type Run = { text: string; color: string; backgroundColor: string; bold: boolean }
// Where each sprite stands, which walking frame shows, the agent under the pointer, and the card
// or message under the pointer.
type View = { positions: Record<string, Cell>; frame: 0 | 1; hovered: string | null; over: string | null }

const START: View = { positions: {}, frame: 0, hovered: null, over: null }

// The timer and the pointer listener start once, so they read the newest board and the
// regions last drawn from here rather than from what they saw when they started.
let latest: Snapshot = {
  project: { mode: 'tickets', repo: '', branch: null, title: '', detail: '' },
  lanes: [],
  agents: [],
  weather: null,
  messages: [],
  learnings: { total: 0, lines: [] },
  detail: null,
  now: 0,
}
let drawnRegions: Region[] = []

function widthOf(surface: ClientSurface<View>) {
  return Math.max(24, surface.columns || 60)
}

// The region under a cell. Regions drawn later sit on top, so the walk goes from the last one back.
function regionAt(regions: Region[], x: number, y: number) {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r
  }
  return null
}

export default function Screen(props: Snapshot, surface: ClientSurface<View>) {
  latest = props
  if (surface.state === undefined) {
    surface.setState(START)
    // Every quarter second the sprites take a step toward home and flip to their other frame,
    // stepping around each other and around the name lines on the board.
    surface.every(250, () => {
      const now = surface.state ?? START
      const plan = arrange(latest, widthOf(surface))
      surface.setState({
        ...now,
        frame: now.frame === 1 ? 0 : 1,
        positions: advance(now.positions, plan.homes, plan.obstacles),
      })
    })
    surface.onPointer(event => {
      const now = surface.state ?? START
      if (event.type === 'move') {
        // A sprite under the pointer gets its hover card; a card or a message gets lit up.
        const region = regionAt(drawnRegions, event.x, event.y)
        const hovered = region !== null && region.kind === 'agent' ? region.id : null
        const over = region !== null && (region.kind === 'card' || region.kind === 'message') ? region.id : null
        if (hovered !== now.hovered || over !== now.over) surface.setState({ ...now, hovered, over })
      } else if (event.type === 'leave') {
        if (now.hovered !== null || now.over !== null) surface.setState({ ...now, hovered: null, over: null })
      } else if (event.type === 'down') {
        // A click on an agent, a card or a message opens its detail box. With the box up, a click
        // on [x] or anywhere off the box closes it, and a click on the box itself does nothing.
        const region = regionAt(drawnRegions, event.x, event.y)
        if (region === null) return
        if (region.kind === 'agent' || region.kind === 'card' || region.kind === 'message') {
          surface.post({ open: { kind: region.kind, id: region.id } })
        } else if (region.kind === 'close') {
          surface.post({ close: true })
        }
      }
    })
  }

  const { Box, Text } = surface.elements
  const view = surface.state ?? START
  const frame = draw(props, view, widthOf(surface))
  drawnRegions = frame.regions
  return (
    <Box flexDirection="column">
      {frame.rows.map((runs: Run[]) => (
        <Text>
          {runs.map(run => (
            <Text color={run.color} backgroundColor={run.backgroundColor} bold={run.bold}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}
