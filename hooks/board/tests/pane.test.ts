import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const

test('the board draws and animates on the terminal, and shows as a picture on desktop', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
  await ui.resize({ columns: 60, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /To do 0/, in: 'stage' })).toBeDefined()
  await ui.resize({ columns: 124, rows: 30, in: 'stage' })
  // The lanes sit side by side at full width, and every row fills the pane.
  expect(await ui.find({ type: 'Text', text: /To do 0 +Cooking 0 +In review 0 +Rework 0 +Done 0/, in: 'stage' })).toBeDefined()
  const legend = await ui.find({ type: 'Text', text: /Color: haiku · sonnet · opus · fable$/, in: 'stage' })
  expect(legend?.text.length).toBe(124)
  await ui.advance(250)
  await ui.pointer({ type: 'move', x: 0, y: 0, in: 'stage' })
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'stage' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stage' })
  await ui.post({ select: 'nobody' }, { in: 'stage' })
  await ui.post({ nonsense: true }, { in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /To do 0/, in: 'stage' })).toBeDefined()
  await ui.unmount()
  // Desktop has no region: the same board is a picture, as wide as the five lanes, with the legend.
  const desk = await $.ui.mount({ plugin: 'brigade', surface: 'desktop', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
  const svg = await desk.find({ type: 'Svg' })
  const source = String((svg?.props as { source?: unknown }).source)
  for (const lane of ['To do', 'Cooking', 'In review', 'Rework', 'Done', 'Color:']) expect(source).toContain(lane)
  expect((svg?.props as { width?: unknown }).width).toBe(124 * 9)
  await desk.advance(250)
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.unmount()
})

test('the pane holds the board and nothing under it', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /NOTES|MEMORY/ })).toBeUndefined()
  await ui.unmount()
  // On desktop the board is one picture instead of a region.
  const desk = await $.ui.mount({ plugin: 'brigade', surface: 'desktop', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
  expect(await desk.findAll({ type: 'Svg' })).toHaveLength(1)
  expect(await desk.findAll({ type: 'Client' })).toHaveLength(0)
  expect(await desk.find({ type: 'Text', text: /NOTES|MEMORY/ })).toBeUndefined()
  await desk.unmount()
})

test('opening the board asks for a dock wide enough for five lanes', async ($, on) => {
  mock.clock(on)
  const asked: unknown[] = []
  on('ui.open', async ($$, e) => {
    asked.push(e)
    return { value: { isPlaced: true } }
  })
  on('session.root', async () => ({ value: '/path/to/repo' }))
  on('fs.exists', async () => ({ value: false }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  expect(await $.command.run(OPEN)).toEqual({ text: 'Board opened.' })
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatchObject({ id: 'brigade-board', columns: 124 })
})

test('surfaces without a region draw the text board', async ($, on) => {
  mock.clock(on)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
    expect(await ui.find({ type: 'Text', text: /^Ticket board$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Context --$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^To do 0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Done 0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }
})

const AGENT = { id: 'a1', name: 'Basil', role: 'cook', model: 'claude-haiku', dish: null, item: null, ticket: null, state: 'working', tokens: 0, startedAt: 0, endedAt: null, activity: null } as const

test('only a well-formed open or close changes the detail', async ($, on) => {
  mock.clock(on)
  // The test's hooks stand in for the engine's state store: one agent on the roster, and
  // every write to the detail box kept so the test can read it back.
  const store = new Map<string, { value: unknown; version: number }>([
    ['fleet', { value: { agents: { a1: AGENT }, order: ['a1'] }, version: 1 }],
  ])
  on('state.get', async ($, e) => ({ value: store.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', async ($, e) => {
    const now = store.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } }
    store.set(e.key, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } }
  })
  const shown = () => store.get('detail')?.value as { kind: string; id: string; title: string } | null | undefined
  const writes = () => store.get('detail')?.version ?? 0
  // A pane draws what the store held when it mounted; this store doesn't tell it about writes,
  // so each step that clicks the board starts from a freshly mounted pane.
  const mount = async () => {
    const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 30 } })
    await ui.resize({ columns: 124, rows: 30, in: 'stage' })
    return ui
  }
  let ui = await mount()
  await ui.post({ open: { kind: 'agent', id: 'a1' } }, { in: 'stage' })
  expect(shown()).toMatchObject({ kind: 'agent', id: 'a1', title: 'Basil · cook' })
  const before = writes()
  await ui.post({ open: { kind: 'agent', id: 'nobody' } }, { in: 'stage' })
  await ui.post({ open: { kind: 'agent', id: 'toString' } }, { in: 'stage' })
  await ui.post({ open: { kind: 'agent', id: 'a1' }, extra: 1 }, { in: 'stage' })
  await ui.post({ open: { kind: 'agent', id: 'a1', extra: 1 } }, { in: 'stage' })
  await ui.post({ open: { kind: 'agent', id: 7 } }, { in: 'stage' })
  await ui.post({ close: 'yes' }, { in: 'stage' })
  await ui.post({ select: 'a1' }, { in: 'stage' })
  await ui.post({ select: null }, { in: 'stage' })
  await ui.post({ nonsense: true }, { in: 'stage' })
  await ui.post('a1', { in: 'stage' })
  expect(writes()).toBe(before)
  expect(shown()).toMatchObject({ kind: 'agent', id: 'a1' })
  await ui.unmount()
  // With the box up, a click on an empty cell off the box closes it.
  ui = await mount()
  expect(await ui.find({ type: 'Text', text: /\[x\]/, in: 'stage' })).toBeDefined()
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stage' })
  expect(shown()).toBeNull()
  await ui.unmount()
  // A click on the agent's sprite opens its box. It stands with the crew, at the left edge, on the
  // row right under the label: one row tall, three cells wide, so x 1 is its middle.
  ui = await mount()
  await ui.advance(250 * 60)
  const rows = (await ui.findAll({ type: 'Text', in: 'stage' })).filter(t => t.children.some(c => typeof c === 'object'))
  const crew = rows.findIndex(row => /^Crew/.test(row.text))
  expect(crew).toBeGreaterThan(0)
  await ui.pointer({ type: 'down', x: 1, y: crew + 1, button: 'left', in: 'stage' })
  expect(shown()).toMatchObject({ kind: 'agent', id: 'a1' })
  await ui.post({ close: true }, { in: 'stage' })
  expect(shown()).toBeNull()
  await ui.unmount()
  // Desktop has no region to post from or click on: the buttons under the picture open the box,
  // and the close button that shows while it is up closes it.
  const desktop = () => $.ui.mount({ plugin: 'brigade', surface: 'desktop', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 30 } })
  let desk = await desktop()
  expect(await desk.find({ type: 'Button', text: /^Close details$/ })).toBeUndefined()
  await desk.press({ key: 'agent-0' })
  expect(shown()).toMatchObject({ kind: 'agent', id: 'a1', title: 'Basil · cook' })
  await desk.unmount()
  desk = await desktop()
  await desk.press({ key: 'close-details' })
  expect(shown()).toBeNull()
  await desk.unmount()
})
