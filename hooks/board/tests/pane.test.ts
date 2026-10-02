import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const

test('the board draws and animates on terminal and desktop', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
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
  }
})

test('the pane holds the board and nothing under it', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
    expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /NOTES|MEMORY/ })).toBeUndefined()
    await ui.unmount()
  }
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

test('only a known agent id or null changes the selection', async ($, on) => {
  mock.clock(on)
  // The test's hooks stand in for the engine's state store: one agent on the roster, and
  // every write to the selection kept so the test can read it back.
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
  const chosen = () => store.get('selected')?.value
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 30 } })
    await ui.resize({ columns: 124, rows: 30, in: 'stage' })
    await ui.post({ select: 'a1' }, { in: 'stage' })
    expect(chosen()).toBe('a1')
    await ui.post({ select: 'nobody' }, { in: 'stage' })
    await ui.post({ select: 'toString' }, { in: 'stage' })
    await ui.post({ select: 'a1', extra: 1 }, { in: 'stage' })
    await ui.post({ select: 7 }, { in: 'stage' })
    await ui.post({ nonsense: true }, { in: 'stage' })
    await ui.post('a1', { in: 'stage' })
    expect(chosen()).toBe('a1')
    // A click on an empty cell clears the selection.
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stage' })
    expect(chosen()).toBeNull()
    // A click on the agent's sprite selects it. It stands with the crew, left edge, under the label.
    await ui.advance(250 * 60)
    const rows = (await ui.findAll({ type: 'Text', in: 'stage' })).filter(t => t.children.some(c => typeof c === 'object'))
    const crew = rows.findIndex(row => /^Crew/.test(row.text))
    expect(crew).toBeGreaterThan(0)
    await ui.pointer({ type: 'down', x: 1, y: crew + 2, button: 'left', in: 'stage' })
    expect(chosen()).toBe('a1')
    await ui.post({ select: null }, { in: 'stage' })
    expect(chosen()).toBeNull()
    await ui.unmount()
  }
})
