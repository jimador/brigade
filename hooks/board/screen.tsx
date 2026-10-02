import type { ClientSurface } from 'claude-code'

import type { Snapshot } from '../../types'
import { layout } from './lib/layout.mjs'
import { paint } from './lib/paint.mjs'
import { advance, hitTest } from './lib/stage.mjs'

type Cell = { x: number; y: number }
type Region = { id: string; x: number; y: number; w: number; h: number }
type Run = { text: string; color: string; backgroundColor: string; bold: boolean }
type View = { positions: Record<string, Cell>; frame: 0 | 1; hovered: string | null }

// The timer and the pointer listener start once, so they read the newest board and the
// sprite boxes last drawn from here rather than from what they saw when they started.
let latest: Snapshot = { lanes: [], agents: [], weather: null, selected: null, now: 0 }
let drawnRegions: Region[] = []

function widthOf(surface: ClientSurface<View>) {
  return Math.max(24, surface.columns || 60)
}

export default function Screen(props: Snapshot, surface: ClientSurface<View>) {
  latest = props
  if (surface.state === undefined) {
    surface.setState({ positions: {}, frame: 0, hovered: null })
    // Every quarter second the sprites take a step toward home and flip to their other frame.
    surface.every(250, () => {
      const now = surface.state ?? { positions: {}, frame: 0, hovered: null }
      surface.setState({
        ...now,
        frame: now.frame === 1 ? 0 : 1,
        positions: advance(now.positions, layout(latest, widthOf(surface)).homes),
      })
    })
    surface.onPointer(event => {
      const now = surface.state ?? { positions: {}, frame: 0, hovered: null }
      if (event.type === 'move') {
        const hovered = hitTest(drawnRegions, event.x, event.y)
        if (hovered !== now.hovered) surface.setState({ ...now, hovered })
      } else if (event.type === 'leave') {
        if (now.hovered !== null) surface.setState({ ...now, hovered: null })
      } else if (event.type === 'down') {
        surface.post({ select: hitTest(drawnRegions, event.x, event.y) })
      }
    })
  }

  const { Box, Text } = surface.elements
  const view = surface.state ?? { positions: {}, frame: 0, hovered: null }
  const frame = paint(props, view, widthOf(surface))
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
