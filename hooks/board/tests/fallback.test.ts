import { expect, mock, test } from 'claude-code/testing'

import { arrange } from '../lib/board-layout.mjs'
import { draw } from '../lib/board-paint.mjs'
import { register } from '../register.tsx'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 124, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const

type T = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Ui = Awaited<ReturnType<T['ui']['mount']>>
type Surface = 'terminal' | 'desktop'
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
type Box = { x: number; y: number; w: number; h: number }

const LANES = [
  ['todo', 'To do'],
  ['cooking', 'Cooking'],
  ['review', 'In review'],
  ['rework', 'Rework'],
  ['done', 'Done'],
] as const

// The five lanes, with the named cards in them.
function lanes(cards: Partial<Record<(typeof LANES)[number][0], string[]>>) {
  return LANES.map(([key, title]) => {
    const ids = cards[key] ?? []
    return { key, title, total: ids.length, cards: ids.map(id => ({ id, title: id, phase: key, tag: null, alert: false })) }
  })
}

// Basil, a cook working the dish whose ticket is acme-12, so he stands on that card.
const BASIL = { id: 'c1', name: 'Basil', role: 'cook', model: 'claude-haiku-4-5', state: 'working', dish: 'acme-limits', item: null, tokens: 0, startedAt: 0, endedAt: null, activity: null }
const BOARD = {
  dishes: { 'acme-limits': 'acme-12' },
  fleet: { agents: { c1: BASIL }, order: ['c1'] },
  work: lanes({ todo: ['acme-12', 'acme-13'] }),
}

// A state store the test fills in directly, which also notes every key read and written.
function store(on: On, values: Record<string, unknown> = {}) {
  const kept = new Map<string, { value: unknown; version: number }>(Object.entries(values).map(([key, value]) => [key, { value, version: 1 }]))
  const reads: string[] = []
  const writes: string[] = []
  on('state.get', async ($$, e) => {
    reads.push(e.key)
    return { value: kept.get(e.key) ?? { value: undefined, version: 0 } }
  })
  on('state.set', async ($$, e) => {
    const now = kept.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } }
    writes.push(e.key)
    kept.set(e.key, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } }
  })
  return { kept, reads, writes }
}

const pane = (surface: Surface) => ({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } }) as const

const mount = ($: T, surface: Surface) => $.ui.mount(pane(surface))

async function sourceOf(ui: Ui) {
  const svg = await ui.find({ type: 'Svg' })
  return svg === undefined ? '' : String((svg.props as { source?: unknown }).source ?? '')
}

// The colours the picture draws a sprite in, by model family.
const HAIKU = '#4cc9f0'
const OPUS = '#ffd166'

// The one path the picture draws in a colour, as its `d`, or null when there is none.
function pathIn(source: string, color: string) {
  const hits = [...source.matchAll(new RegExp(`<path fill="${color}" d="([^"]*)"/>`, 'g'))]
  expect(hits.length).toBeLessThanOrEqual(1)
  return hits.length === 0 ? null : hits[0][1]
}

// Where the sprite drawn in a colour sits, in cells: its path's first corner, 9 by 18 pixels a cell.
function spriteAt(source: string, color: string) {
  const hit = /^M([\d.]+) ([\d.]+)/.exec(pathIn(source, color) ?? '')
  return hit === null ? null : { x: Math.floor(Number(hit[1]) / 9), y: Math.floor(Number(hit[2]) / 18) }
}

// The drawing of the sprite in a colour, wherever it stands: its path with every corner counted
// from the first one, so two paths match when they draw the same frame.
function shapeOf(source: string, color: string) {
  const d = pathIn(source, color) ?? ''
  const first = /^M([\d.]+) ([\d.]+)/.exec(d)
  if (first === null) return ''
  const [x0, y0] = [Number(first[1]), Number(first[2])]
  return d.replace(/M([\d.]+) ([\d.]+)/g, (_, x, y) => `M${(Number(x) - x0).toFixed(1)} ${(Number(y) - y0).toFixed(1)}`)
}

async function buttons(ui: Ui) {
  return (await ui.findAll({ type: 'Button' })).map(b => ({ key: String((b.props as { key?: unknown }).key), label: b.text }))
}

// The kit mounts the pane 124 of the app's columns wide, so the picture is drawn at 174.
const PICTURE_COLUMNS = 174

test('on desktop a sprite walks to its card when the card moves lane, two steps a tick', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept } = store(on, BOARD)
  await $.command.run(OPEN)
  let ui = await mount($, 'desktop')
  await clock.advance(10000)
  await ui.unmount()
  ui = await mount($, 'desktop')
  const before = await sourceOf(ui)
  const settled = spriteAt(before, HAIKU)
  const still = shapeOf(before, HAIKU)
  expect(settled).not.toBeNull()
  // The card moves from To do to Done, the far end of the board.
  kept.set('work', { value: lanes({ todo: ['acme-13'], done: ['acme-12'] }), version: (kept.get('work')?.version ?? 0) + 1 })
  await clock.advance(500)
  await ui.unmount()
  ui = await mount($, 'desktop')
  // One tick in, Basil has taken two steps: more than one step's 2 cells across, at most 4.
  const first = await sourceOf(ui)
  const walking = spriteAt(first, HAIKU)
  expect(walking).not.toBeNull()
  const across = Math.abs((walking?.x ?? 0) - (settled?.x ?? 0))
  expect(across).toBeGreaterThan(2)
  expect(across).toBeLessThanOrEqual(4)
  // While he walks his drawing changes from one tick to the next, in shape as well as place.
  await clock.advance(500)
  await ui.unmount()
  ui = await mount($, 'desktop')
  const second = await sourceOf(ui)
  expect(spriteAt(second, HAIKU)).not.toEqual(walking)
  expect(shapeOf(second, HAIKU)).not.toBe(shapeOf(first, HAIKU))
  await clock.advance(60000)
  await ui.unmount()
  ui = await mount($, 'desktop')
  const after = await sourceOf(ui)
  expect(after).not.toBe(before)
  // Home again he stands still, drawn as at rest.
  expect(shapeOf(after, HAIKU)).toBe(still)
  await ui.unmount()
  // He now stands on the acme-12 card in the Done lane, where the layout puts him.
  const tree = (await $.ui.render(pane('terminal'))) as Node
  const home = (arrange(tree.props?.props, PICTURE_COLUMNS) as { homes: Record<string, Box> }).homes.c1
  expect(home.x).toBeGreaterThanOrEqual(100)
  expect(spriteAt(after, HAIKU)).toEqual({ x: home.x, y: home.y })
})

test('on desktop an agent that joins while the pane is open appears at its home', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept } = store(on, BOARD)
  await $.command.run(OPEN)
  let ui = await mount($, 'desktop')
  await clock.advance(10000)
  await ui.unmount()
  // Sage, an opus cook on no card, joins the roster while the pane is open.
  const sage = { ...BASIL, id: 'c2', name: 'Sage', model: 'claude-opus-4-1', dish: null }
  kept.set('fleet', { value: { agents: { c1: BASIL, c2: sage }, order: ['c1', 'c2'] }, version: (kept.get('fleet')?.version ?? 0) + 1 })
  await clock.advance(500)
  ui = await mount($, 'desktop')
  const at = spriteAt(await sourceOf(ui), OPUS)
  await ui.unmount()
  // One tick later he is drawn where the painter puts a sprite that stands at home.
  const tree = (await $.ui.render(pane('terminal'))) as Node
  const drawn = draw(tree.props?.props, { positions: {}, frame: 0, hovered: null, over: null }, PICTURE_COLUMNS) as { regions: ({ kind: string; id: string } & Box)[] }
  const region = drawn.regions.find(r => r.kind === 'agent' && r.id === 'c2')
  expect(region).toBeDefined()
  expect(at).toEqual({ x: region?.x, y: region?.y })
})

test('a settled board costs no stage writes', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept } = store(on, BOARD)
  await $.command.run(OPEN)
  const ui = await mount($, 'desktop')
  await clock.advance(10000)
  const version = kept.get('stage')?.version ?? 0
  // The first step put Basil at his home, so the stage was written once after the open.
  expect(version).toBeGreaterThan(1)
  // Twenty more steps with nobody left to move.
  await clock.advance(10000)
  expect(kept.get('stage')?.version).toBe(version)
  await ui.unmount()
})

test('a terminal whose region reports in keeps the region after 10 seconds', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept } = store(on, BOARD)
  await $.command.run(OPEN)
  // The region draws as it mounts, and its first drawing posts { ready: true }.
  const ui = await mount($, 'terminal')
  expect(kept.get('stage')?.value).toMatchObject({ open: true, ready: true, plain: false })
  await clock.advance(10000)
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(kept.get('stage')?.value).toMatchObject({ ready: true, plain: false })
  await ui.unmount()
})

test('in the terminal with a ready region the step does no work', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept, reads, writes } = store(on, BOARD)
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  expect(kept.get('stage')?.value).toMatchObject({ ready: true })
  reads.length = 0
  writes.length = 0
  // Twenty steps. arrange needs a snapshot, and a snapshot reads state, so no read means no arrange.
  await clock.advance(10000)
  expect(reads).toEqual([])
  expect(writes).toEqual([])
  await ui.unmount()
})

test('a terminal whose region never reports in falls back to rows and buttons after 3 seconds', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const { kept, writes } = store(on, BOARD)
  await $.command.run(OPEN)
  const opened = writes.length
  // Rendering without mounting draws the hooks module's tree and never runs the region, which is
  // what a region that fails to load looks like from here.
  expect(((await $.ui.render(pane('terminal'))) as Node).type).toBe('Client')
  await clock.advance(2500)
  expect(((await $.ui.render(pane('terminal'))) as Node).type).toBe('Client')
  expect(kept.get('stage')?.value).toMatchObject({ plain: false })
  // While it waits on the region the step only watches the time: no sprite walks, nothing is written.
  expect(writes.length).toBe(opened)
  await clock.advance(500)
  expect(kept.get('stage')?.value).toMatchObject({ ready: false, plain: true })
  const ui = await mount($, 'terminal')
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  // The rows are the painted board, lane headers side by side, not the plain lines.
  expect(await ui.find({ type: 'Text', text: /To do 2 +Cooking 0 +In review 0 +Rework 0 +Done 0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Details:$/ })).toBeDefined()
  const row = await buttons(ui)
  expect(row).toContainEqual({ key: 'card-0', label: 'acme-12' })
  expect(row).toContainEqual({ key: 'agent-0', label: 'Basil' })
  // The buttons open the detail box as they do under the picture.
  await ui.press({ key: 'agent-0' })
  expect(kept.get('detail')?.value).toMatchObject({ kind: 'agent', id: 'c1' })
  // The kit cannot post from a region that is no longer drawn, so the late { ready: true } is
  // covered below through the hooks module itself.
  let refused = ''
  try {
    await ui.post({ ready: true }, { in: 'stage' })
  } catch (err) {
    refused = String(err)
  }
  expect(refused).toContain('holds no Client')
  await ui.unmount()
})

test('a terminal board too big to draw as rows falls back to the plain lines', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const ids = Array.from({ length: 400 }, (_, i) => `t-${i}`)
  store(on, { ...BOARD, work: lanes({ todo: ids }) })
  await $.command.run(OPEN)
  await $.ui.render(pane('terminal'))
  await clock.advance(3000)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^To do 400: t-0, t-1/ })).toBeDefined()
  await ui.unmount()
})

test('a session that never opens the pane writes no stage', async ($, on) => {
  const clock = mock.clock(on)
  const { writes } = store(on, BOARD)
  on('command.register', async () => ({ value: {} }))
  on('session.start', async ($$, e) => ({ cwd: e.cwd }))
  on('tool.call', async () => ({ result: 'ok' }))
  await $.session.start({ cwd: '/repo' })
  await $.tool.call({ agentId: 'c1', tool: 'Read', file_path: '/repo/src/bucket.ts' } as never)
  await clock.advance(10000)
  expect(writes.filter(key => key === 'stage')).toEqual([])
})

// The kit has no way to close a pane the way a person does: its `$.ui` offers render, scroll,
// focus, press, input, select and mount, and unmounting runs no ui.close. So the tests below load
// the hooks module themselves and drive its hooks with a small hand-made engine: a state store, a
// clock the test moves, and the element names. The module loaded here is its own copy, separate
// from the one the kit runs, and each test leaves its pane closed.
type Hook = (...args: unknown[]) => Promise<unknown>
type Timer = { ms: number; due: number; fn: () => void; cancelled: boolean }

function bench() {
  const hooks: Record<string, Hook> = {}
  register(((name: string, ...rest: unknown[]) => {
    hooks[name] = rest[rest.length - 1] as Hook
  }) as never)
  const kept = new Map<string, { value: unknown; version: number }>(Object.entries(BOARD).map(([key, value]) => [key, { value, version: 1 }]))
  const reads: string[] = []
  const timers: Timer[] = []
  let now = 1000
  const engine = {
    state: {
      get: async (e: { key: string }) => {
        reads.push(e.key)
        return kept.get(e.key) ?? { value: undefined, version: 0 }
      },
      set: async (e: { key: string }, value: unknown, options?: { ifVersion?: number }) => {
        const was = kept.get(e.key) ?? { value: undefined, version: 0 }
        if (options?.ifVersion !== undefined && options.ifVersion !== was.version) return { isSet: false, version: was.version }
        kept.set(e.key, { value, version: was.version + 1 })
        return { isSet: true, version: was.version + 1 }
      },
    },
    clock: {
      now: async () => now,
      every: (ms: number, fn: () => void) => {
        const timer = { ms, due: now + ms, fn, cancelled: false }
        timers.push(timer)
        return {
          cancel() {
            timer.cancelled = true
          },
        }
      },
    },
    command: { register: async () => ({}) },
    ui: {
      open: async () => ({ isPlaced: true }),
      resolve: () => ({ Box: 'Box', Button: 'Button', Client: 'Client', Svg: 'Svg', Text: 'Text' }),
    },
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 1))
  return {
    kept,
    reads,
    timers,
    live: () => timers.filter(timer => !timer.cancelled),
    open: () => hooks['command.run'](engine, OPEN),
    close: (id = 'brigade-board', next: (e: unknown) => Promise<unknown> = async () => undefined) => hooks['ui.close'](engine, { id, origin: { kind: 'person' } }, next),
    post: (data: unknown) => hooks['ui.message'](engine, { surface: 'terminal', component: 'Pane', requestId: 'brigade-board', element: 'stage', data }, async (e: unknown) => e),
    render: async (surface: Surface) => (await hooks['ui.render'](engine, { surface, component: 'Pane', requestId: 'brigade-board', props: PANE })) as Node,
    start: () => hooks['session.start'](engine, { cwd: '/repo' }, async (e: unknown) => e),
    // Moves the clock on, firing each live timer as its time comes and letting its work finish.
    advance: async (ms: number) => {
      const end = now + ms
      for (;;) {
        const next = timers.filter(timer => !timer.cancelled && timer.due <= end).sort((a, b) => a.due - b.due)[0]
        if (next === undefined) break
        now = next.due
        next.due += next.ms
        next.fn()
        await flush()
      }
      now = end
      await flush()
    },
  }
}

// Every node of a tree of the given type, depth first.
function nodes(tree: unknown, type: string): Node[] {
  if (tree === null || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type))
  const node = tree as Node
  return [...(node.type === type ? [node] : []), ...nodes(node.children ?? [], type)]
}

test('a session that never opens the pane runs no clock but the board tick', async () => {
  const b = bench()
  await b.start()
  await b.advance(10000)
  expect(b.timers.map(timer => timer.ms)).toEqual([2000])
  expect(b.kept.has('stage')).toBe(false)
})

test('closing the pane stops its clock, and opening it again starts exactly one', async () => {
  const b = bench()
  await b.open()
  expect(b.live().map(timer => timer.ms)).toEqual([500])
  // With no viewport to measure, the picture is drawn at the dock's 124 columns.
  const svg = nodes(await b.render('desktop'), 'Svg')[0]
  expect(String(svg?.props?.source)).toContain('viewBox="0 0 1116 ')
  await b.advance(2000)
  expect(b.kept.get('stage')?.value).toMatchObject({ open: true, openedAt: 1000 })
  // Running the command again while the pane is open adds no second clock and keeps the time it opened.
  await b.open()
  expect(b.timers).toHaveLength(1)
  expect(b.kept.get('stage')?.value).toMatchObject({ open: true, openedAt: 1000 })
  // A close of some other pane changes nothing.
  await b.close('someone-else')
  expect(b.live()).toHaveLength(1)
  // A close that a later hook refuses leaves the walk running, and its error goes on untouched.
  const refusal = new Error('kept open')
  let thrown: unknown = null
  try {
    await b.close('brigade-board', async () => {
      throw refusal
    })
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBe(refusal)
  expect(b.live()).toHaveLength(1)
  // The close hands back exactly what the chain answered.
  const answer = { closed: true }
  expect(await b.close('brigade-board', async () => answer)).toBe(answer)
  expect(b.live()).toHaveLength(0)
  expect(b.kept.get('stage')?.value).toMatchObject({ open: false })
  b.reads.length = 0
  await b.advance(5000)
  // No step ran: no snapshot was read, so arrange was never called.
  expect(b.reads).toEqual([])
  await b.open()
  expect(b.live()).toHaveLength(1)
  expect(b.timers).toHaveLength(2)
  expect(b.kept.get('stage')?.value).toMatchObject({ open: true, openedAt: 8000 })
  await b.close()
  expect(b.live()).toHaveLength(0)
})

test('opening the pane again gives a terminal that fell back its region, and another 3 seconds', async () => {
  const b = bench()
  await b.open()
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(3000)
  expect(b.kept.get('stage')?.value).toMatchObject({ ready: false, plain: true })
  expect(nodes(await b.render('terminal'), 'Client')).toHaveLength(0)
  await b.close()
  // The region may only have loaded slowly, so the next open tries it again.
  await b.open()
  expect(b.kept.get('stage')?.value).toMatchObject({ open: true, ready: false, plain: false })
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(2500)
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(500)
  expect(b.kept.get('stage')?.value).toMatchObject({ ready: false, plain: true })
  await b.close()
})

test('the rows fallback keeps the walk-in from the left edge, one step a tick', async () => {
  const b = bench()
  await b.open()
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(3000)
  expect(b.kept.get('stage')?.value).toMatchObject({ plain: true })
  expect(nodes(await b.render('terminal'), 'Client')).toHaveLength(0)
  // Basil starts just off the left edge, three cells out, and comes in 2 cells a tick.
  await b.advance(500)
  expect((b.kept.get('stage')?.value as { positions: Record<string, { x: number }> }).positions.c1?.x).toBe(-1)
  await b.advance(500)
  expect((b.kept.get('stage')?.value as { positions: Record<string, { x: number }> }).positions.c1?.x).toBe(1)
  await b.close()
})

test('only an exact { ready: true } counts, and a late one brings the region back', async () => {
  const b = bench()
  await b.open()
  expect((await b.render('terminal')).type).toBe('Client')
  for (const data of [{ ready: true, extra: 1 }, { ready: 'true' }, { ready: false }, { ready: 1 }, [true], null, 'ready', { open: { ready: true } }]) {
    await b.post(data)
  }
  expect(b.kept.get('stage')?.value).toMatchObject({ ready: false, plain: false })
  await b.advance(2500)
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(500)
  expect(b.kept.get('stage')?.value).toMatchObject({ ready: false, plain: true })
  const rows = await b.render('terminal')
  expect(nodes(rows, 'Client')).toHaveLength(0)
  expect(nodes(rows, 'Button').length).toBeGreaterThan(0)
  // The region turns up after all: the fallback is dropped and the region drawn again.
  await b.post({ ready: true })
  expect(b.kept.get('stage')?.value).toMatchObject({ ready: true, plain: false })
  expect((await b.render('terminal')).type).toBe('Client')
  await b.advance(10000)
  expect((await b.render('terminal')).type).toBe('Client')
  await b.close()
  // A terminal whose region drew keeps it when the pane opens again.
  await b.open()
  expect(b.kept.get('stage')?.value).toMatchObject({ open: true, ready: true, plain: false })
  expect((await b.render('terminal')).type).toBe('Client')
  await b.close()
})

test('a state read that fails while the pane draws gives the plain lines, never a throw', async () => {
  const b = bench()
  // The kit's runtime refuses a plain assignment over a built-in method, so the store's own
  // methods are swapped with defineProperty. A read goes through reads.push and then kept.get, so
  // the push marks the next get as a read and a write's own lookup is left alone.
  const swap = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true })
  let failing = ''
  let reading = false
  swap(b.reads, 'push', (...keys: string[]) => {
    reading = true
    return Array.prototype.push.apply(b.reads, keys)
  })
  swap(b.kept, 'get', (key: string) => {
    const read = reading
    reading = false
    if (read && key === failing) throw new Error(`no ${key} today`)
    return Map.prototype.get.call(b.kept, key)
  })
  const lines = (tree: Node) => nodes(tree, 'Text').map(text => (text.children ?? []).join(''))
  for (const surface of ['terminal', 'desktop'] as const) {
    // The stage can't be read: the board itself still shows, as plain lines.
    failing = 'stage'
    const board = await b.render(surface)
    expect(nodes(board, 'Client')).toHaveLength(0)
    expect(nodes(board, 'Svg')).toHaveLength(0)
    expect(lines(board)).toContain('To do 2: acme-12, acme-13')
    expect(lines(board).some(line => line.startsWith('Basil'))).toBe(true)
    // The board itself can't be read: an empty board, as plain lines.
    failing = 'fleet'
    const empty = await b.render(surface)
    expect(nodes(empty, 'Svg')).toHaveLength(0)
    expect(lines(empty)).toContain('To do 0')
    expect(lines(empty)).toContain('Done 0')
    expect(lines(empty).some(line => line.includes('acme') || line.includes('Basil'))).toBe(false)
  }
})

test('a close that lands while the open is writing the stage leaves no clock', async () => {
  const b = bench()
  // Swapped with defineProperty, as above. Every stage read made after the open's write is held
  // and answered with the stage as it stands when it is let go.
  const swap = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true })
  const held: (() => void)[] = []
  let holding = false
  let reading = false
  let closing: Promise<unknown> | null = null
  swap(b.reads, 'push', (...keys: string[]) => {
    reading = true
    return Array.prototype.push.apply(b.reads, keys)
  })
  swap(b.kept, 'get', (key: string) => {
    const read = reading
    reading = false
    if (!read || !holding || key !== 'stage') return Map.prototype.get.call(b.kept, key)
    return new Promise(resolve => held.push(() => resolve(Map.prototype.get.call(b.kept, key))))
  })
  swap(b.kept, 'set', (key: string, value: { value?: { open?: unknown } }) => {
    Map.prototype.set.call(b.kept, key, value)
    if (key === 'stage' && value.value?.open === true && closing === null) {
      // The pane closes the moment the open's write lands, before the open goes on.
      holding = true
      closing = b.close()
    }
    return b.kept
  })
  // Drawn once as a picture, so a step that does run reads the stage and walks.
  await b.render('desktop')
  let opened = false
  const opening = b.open().then(() => {
    opened = true
  })
  // The close came in first, so the first held read is the close's; a second one is the open
  // looking at the stage again after its write.
  for (let i = 0; i < 50 && !opened && held.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 1))
  holding = false
  held.shift()?.()
  await closing
  for (const go of held.splice(0)) go()
  await opening
  expect(b.kept.get('stage')?.value).toMatchObject({ open: false })
  expect(b.live()).toHaveLength(0)
  b.reads.length = 0
  await b.advance(5000)
  // No step ran: nothing read the stage, and arrange was never called.
  expect(b.reads).toEqual([])
})

test('a close that reads the stage before the open writes it still leaves no clock', async () => {
  const b = bench()
  // Swapped with defineProperty, as above. The open's first look at the stage, the one its write
  // starts from, is held, so the whole close runs before the open writes anything.
  const swap = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true })
  const held: (() => void)[] = []
  let holding = false
  let reading = false
  swap(b.reads, 'push', (...keys: string[]) => {
    reading = true
    return Array.prototype.push.apply(b.reads, keys)
  })
  swap(b.kept, 'get', (key: string) => {
    const read = reading
    reading = false
    if (!read || !holding || key !== 'stage') return Map.prototype.get.call(b.kept, key)
    holding = false
    // Answered as the bench answers a key it doesn't hold yet.
    return new Promise(resolve => held.push(() => resolve(Map.prototype.get.call(b.kept, key) ?? { value: undefined, version: 0 })))
  })
  // Drawn once as a picture, so a step that does run reads the stage and walks.
  await b.render('desktop')
  holding = true
  let opened = false
  const opening = b.open().then(() => {
    opened = true
  })
  for (let i = 0; i < 50 && !opened && held.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 1))
  expect(held).toHaveLength(1)
  // The pane closes while the open is about to write. The close finds the stage not open yet, so
  // it has nothing to cancel and nothing to write.
  await b.close()
  expect(b.kept.has('stage')).toBe(false)
  held.shift()?.()
  await opening
  expect(b.kept.get('stage')?.value).toMatchObject({ open: false })
  expect(b.live()).toHaveLength(0)
  b.reads.length = 0
  await b.advance(5000)
  // No step ran: nothing read the stage, and arrange was never called.
  expect(b.reads).toEqual([])
})
