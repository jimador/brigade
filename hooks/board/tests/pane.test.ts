import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

test('the board draws and animates on terminal and desktop', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
    await ui.resize({ columns: 60, rows: 30, in: 'stage' })
    expect(await ui.find({ type: 'Text', text: /BRIGADE/, in: 'stage' })).toBeDefined()
    await ui.resize({ columns: 100, rows: 30, in: 'stage' })
    expect((await ui.find({ type: 'Text', text: /BRIGADE/, in: 'stage' }))?.text.length).toBe(100)
    await ui.advance(250)
    await ui.pointer({ type: 'move', x: 0, y: 0, in: 'stage' })
    await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'stage' })
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stage' })
    await ui.post({ select: 'nobody' }, { in: 'stage' })
    await ui.post({ nonsense: true }, { in: 'stage' })
    expect(await ui.find({ type: 'Text', text: /BRIGADE/, in: 'stage' })).toBeDefined()
    await ui.unmount()
  }
})

test('surfaces without a region draw the text board', async ($, on) => {
  mock.clock(on)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
    expect(await ui.find({ type: 'Text', text: /BACKLOG|BRIGADE/ })).toBeDefined()
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }
})

const AGENT = { id: 'a1', name: 'Basil', role: 'cook', model: 'claude-haiku', dish: null, item: null, ticket: null, lane: null, state: 'working', tokens: 0, startedAt: 0, endedAt: null } as const

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
    const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 60, rows: 30 } })
    await ui.post({ select: 'a1' }, { in: 'stage' })
    expect(chosen()).toBe('a1')
    await ui.post({ select: 'nobody' }, { in: 'stage' })
    await ui.post({ select: 'toString' }, { in: 'stage' })
    await ui.post({ select: 'a1', extra: 1 }, { in: 'stage' })
    await ui.post({ select: 7 }, { in: 'stage' })
    await ui.post({ nonsense: true }, { in: 'stage' })
    await ui.post('a1', { in: 'stage' })
    expect(chosen()).toBe('a1')
    await ui.post({ select: null }, { in: 'stage' })
    expect(chosen()).toBeNull()
    await ui.unmount()
  }
})
