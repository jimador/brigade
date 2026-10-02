import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }

type On = Parameters<Parameters<typeof test>[1]>[1]
type Ui = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>

// Answers every event the board's hooks pass on, standing in for the engine beneath the plugin,
// and a project with an empty ticket folder, so opening the board lays out its five empty lanes
// and every agent stands with the crew.
function engine(on: On) {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.exists', async ($$, e) => ({ value: e.path === '/repo/.brigade/config.md' }))
  on('fs.read', async () => ({ value: '- source: local\n- database_id: ./board\n' }))
  on('fs.list', async () => ({ value: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
}

async function step($: Parameters<Parameters<typeof test>[1]>[0], agentId: string) {
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId })) void chunk
}

// Lets the sprites walk in and stand still, then moves the pointer onto the sprite whose name
// tag matches. The tag sits beside the sprite, one cell to its right, on the sprite's own row,
// unless the name is too long for that and goes on the row under the sprite, from its left edge.
async function hover(ui: Ui, tag: RegExp) {
  await ui.advance(250 * 60)
  const rows = (await ui.findAll({ type: 'Text', in: 'stage' })).filter(t => t.children.some(c => typeof c === 'object'))
  const y = rows.findIndex(row => tag.test(row.text))
  expect(y).toBeGreaterThan(0)
  const at = rows[y].text.search(tag)
  const x = Array.from(rows[y].text.slice(0, at)).length
  const onCard = rows[y].text[at - 1] === '│'
  await ui.pointer(onCard ? { type: 'move', x, y: y - 1, in: 'stage' } : { type: 'move', x: x - 2, y, in: 'stage' })
}

test('a spawned agent shows as a named sprite, adds its tokens, and stays two minutes after it fails', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const ran = await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'scout:board-data', subagentType: 'brigade:brigade-scout', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false } as never)
  expect(ran).toEqual({ model: 'claude-haiku-4-5', agentId: 'a1' })
  await step($, 'a1')
  {
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
    await ui.resize({ columns: 80, rows: 30, in: 'stage' })
    expect(await ui.find({ type: 'Text', text: /⌕ Basil/, in: 'stage' })).toBeDefined()
    await hover(ui, /⌕ Basil/)
    expect(await ui.find({ type: 'Text', text: /15 tokens/, in: 'stage' })).toBeDefined()
    await ui.unmount()
  }
  {
    // On desktop the board is a picture: Basil is in it with a tooltip, and his button opens a
    // box that lists what he spent.
    await $.command.run(OPEN)
    const desktop = () => $.ui.mount({ plugin: 'brigade', surface: 'desktop', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
    const sourceOf = async (ui: Ui) => String(((await ui.find({ type: 'Svg' }))?.props as { source?: unknown } | undefined)?.source)
    let ui = await desktop()
    expect(await sourceOf(ui)).toContain('Basil')
    expect(await sourceOf(ui)).toMatch(/<title>Basil · [^<]+<\/title>/)
    await ui.press({ key: 'agent-0' })
    await ui.unmount()
    ui = await desktop()
    expect(await sourceOf(ui)).toContain('Tokens: 15')
    await ui.press({ key: 'close-details' })
    await ui.unmount()
  }
  await $.turn.complete({ agentId: 'a1', answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'error' } as never)
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /⌕ Basil/, in: 'stage' })).toBeDefined()
  await hover(ui, /⌕ Basil/)
  expect(await ui.find({ type: 'Text', text: /failed · 15 tokens/, in: 'stage' })).toBeDefined()
  // Its box says it failed, and still lists what it spent.
  await ui.post({ open: { kind: 'agent', id: 'a1' } }, { in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /║ Now: failed/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /║ Tokens: 15/, in: 'stage' })).toBeDefined()
  await ui.post({ close: true }, { in: 'stage' })
  await ui.unmount()
  // A minute on it is still there; past two minutes the next refresh takes it off the board.
  await clock.advance(60000)
  await $.command.run(OPEN)
  const later = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await later.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await later.find({ type: 'Text', text: /⌕ Basil/, in: 'stage' })).toBeDefined()
  await later.unmount()
  await clock.advance(61000)
  await $.command.run(OPEN)
  const gone = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await gone.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await gone.find({ type: 'Text', text: /Basil/, in: 'stage' })).toBeUndefined()
  await gone.unmount()
})

test('a tool call from the main loop adds no agent and passes its result through', async ($, on) => {
  mock.clock(on)
  engine(on)
  expect(await $.tool.call({ tool: 'Read', file_path: '/x' } as never)).toEqual({ result: 'ok' })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /To do 0/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Basil/, in: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('an agent never spawned is named by the files it writes', async ($, on) => {
  mock.clock(on)
  engine(on)
  await step($, 'a2')
  await $.tool.call({ agentId: 'a2', tool: 'Read', file_path: '/repo/.brigade/dishes/obsidian-example/packets/dish-notes.md' } as never)
  await $.tool.call({ agentId: 'a2', tool: 'Write', file_path: '/repo/.brigade/dishes/obsidian-example/reports/dish-notes-cook.md' } as never)
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await hover(ui, /♨ Basil/)
  expect(await ui.find({ type: 'Text', text: /Basil · cook/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /item dish-notes/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

// Opens the board on the terminal, ready to hover.
async function board($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  return ui
}

test('reading cook files makes nobody a cook; writing a verdict makes an inspector, however late', async ($, on) => {
  mock.clock(on)
  engine(on)
  await step($, 'a2')
  await $.tool.call({ agentId: 'a2', tool: 'Read', file_path: '/repo/.brigade/dishes/obsidian-example/packets/dish-notes.md' } as never)
  await $.tool.call({ agentId: 'a2', tool: 'Bash', command: 'cat /repo/.brigade/dishes/obsidian-example/state/dish-notes.md' } as never)
  for (let i = 0; i < 15; i++) await $.tool.call({ agentId: 'a2', tool: 'Bash', command: 'ls' } as never)
  let ui = await board($)
  await hover(ui, /• Basil/)
  expect(await ui.find({ type: 'Text', text: /Basil · agent/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /item dish-notes/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· cook/, in: 'stage' })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ agentId: 'a2', tool: 'Write', file_path: '/repo/.brigade/dishes/obsidian-example/reports/dish-notes-verdict.md' } as never)
  await step($, 'a3')
  await $.tool.call({ agentId: 'a3', tool: 'Edit', file_path: '/repo/.brigade/worktrees/board-pane--dish-notes/hooks/a.mjs' } as never)
  ui = await board($)
  await hover(ui, /✓ Basil/)
  expect(await ui.find({ type: 'Text', text: /Basil · inspector/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /reviewing/, in: 'stage' })).toBeDefined()
  await hover(ui, /♨ Sage/)
  expect(await ui.find({ type: 'Text', text: /Sage · cook/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('the main loop shows as the Planner', async ($, on) => {
  mock.clock(on)
  engine(on)
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-4-5', messageCount: 1 })) void chunk
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await hover(ui, /✦ Basil/)
  expect(await ui.find({ type: 'Text', text: /Basil · planner/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working · 15 tokens/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('a tool call that teaches nothing writes no state', async ($, on) => {
  mock.clock(on)
  engine(on)
  // The test's hooks stand in for the engine's state store and count every roster write.
  const store = new Map<string, { value: unknown; version: number }>()
  let writes = 0
  on('state.get', async ($$, e) => ({ value: store.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', async ($$, e) => {
    const now = store.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } }
    if (e.key === 'fleet') writes++
    store.set(e.key, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } }
  })
  await step($, 'a2')
  await $.tool.call({ agentId: 'a2', tool: 'Read', file_path: '/repo/.brigade/dishes/obsidian-example/packets/dish-notes.md' } as never)
  const before = writes
  for (let i = 0; i < 5; i++) {
    expect(await $.tool.call({ agentId: 'a2', tool: 'Bash', command: 'ls' } as never)).toEqual({ result: 'ok' })
    expect(await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)).toEqual({ result: 'ok' })
  }
  expect(writes).toBe(before)
  // The next pass folds what the calls were doing into the roster in one write, and a pass with
  // nothing new to say writes nothing.
  await $.command.run(OPEN)
  expect(writes).toBe(before + 1)
  await $.command.run(OPEN)
  expect(writes).toBe(before + 1)
})

const DISH = '/repo/.brigade/dishes/acme-limits'
const PLAN = '---\ndoc: plan\ndish: acme-limits\nticket: acme-12\nitems:\n  - { slug: token-bucket, status: todo }\n---\n'

// The engine as above, but over a project with one dish in it, written at `at`.
function dishEngine(on: On, at: number) {
  const files: Record<string, string> = { [`${DISH}/PLAN.md`]: PLAN }
  const dirs = new Set(['/repo/.brigade', '/repo/.brigade/dishes', DISH])
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.exists', async ($$, e) => ({ value: e.path in files || dirs.has(e.path) }))
  on('fs.read', async ($$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.list', async ($$, e) => {
    if (e.path === '/repo/.brigade/dishes') return { value: [{ name: 'acme-limits', kind: 'dir', size: 0, mtimeMs: at, isLink: false }] }
    if (e.path === DISH) return { value: [{ name: 'PLAN.md', kind: 'file', size: PLAN.length, mtimeMs: at, isLink: false }] }
    return { value: [] }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('command.register', async () => ({ value: {} }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
}

test('what an agent is doing shows on its card within a tick, for its whole life', async ($, on) => {
  const clock = mock.clock(on)
  dishEngine(on, await clock.now())
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } })
  await ui.resize({ columns: 124, rows: 40, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /│token-bucket +│/, in: 'stage' })).toBeDefined()
  await step($, 'c1')
  await $.tool.call({ agentId: 'c1', tool: 'Read', file_path: `${DISH}/packets/token-bucket.md` } as never)
  await $.tool.call({ agentId: 'c1', tool: 'Edit', file_path: '/repo/.brigade/worktrees/limits--token-bucket/src/bucket.ts' } as never)
  await clock.advance(2000)
  // The haiku sprite takes the card's first 3 cells and its name shares that row, one cell to the
  // right; the activity goes on the next row, with 22 - 3 - 1 = 18 cells, so 'editing bucket.ts'
  // fits whole with a cell to spare.
  expect(await ui.find({ type: 'Text', text: /│.{3} ♨ Basil · cook +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /│.{3} editing bucket\.ts +│/, in: 'stage' })).toBeDefined()
  // Long past the calls that work out who an agent is, what it is doing still reaches its card.
  for (let i = 0; i < 400; i++) await $.tool.call({ agentId: 'c1', tool: 'Bash', command: 'ls' } as never)
  await $.tool.call({ agentId: 'c1', tool: 'Bash', command: 'node --test test/bucket.test.mjs' } as never)
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /│.{3} running tests +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /editing bucket\.t/, in: 'stage' })).toBeUndefined()
  await ui.unmount()
  // Surfaces without a region say the same in a line per agent.
  const text = await $.ui.mount({ plugin: 'brigade', surface: 'mobile', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  expect(await text.find({ type: 'Text', text: /^Basil · cook · token-bucket · running tests$/ })).toBeDefined()
  expect(await text.find({ type: 'Text', text: /^Cooking 1: token-bucket$/ })).toBeDefined()
  await text.unmount()
})

test("the Planner's own tool calls show as what it is doing", async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('command.register', async () => ({ value: {} }))
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-4-5', messageCount: 1 })) void chunk
  const ui = await board($)
  expect(await ui.find({ type: 'Text', text: /✦ Basil · planner/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /searching/, in: 'stage' })).toBeUndefined()
  expect(await $.tool.call({ tool: 'Grep', pattern: 'bucket' } as never)).toEqual({ result: 'ok' })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /searching/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})
