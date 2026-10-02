import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 124, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const DISH = '/repo/.brigade/dishes/acme-limits'

type T = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Ui = Awaited<ReturnType<T['ui']['mount']>>
type Surface = 'terminal' | 'desktop'

const PLAN = [
  '---',
  'doc: plan',
  'dish: acme-limits',
  'ticket: acme-12',
  'items:',
  '  - { slug: token-bucket, status: todo, files: [src/bucket.ts], depends_on: [clock-source] }',
  '  - { slug: clock-source, status: done }',
  '---',
  '',
  '## Packet: token-bucket',
  '',
  '### Goal',
  '',
  'Refill the bucket from a steady clock.',
  '',
].join('\n')

const VERDICT = [
  '---',
  'doc: verdict',
  'dish: acme-limits',
  'item: token-bucket',
  'role: inspector',
  'verdict: FAIL',
  'attempt: 1',
  'findings:',
  '  - { id: F1, severity: blocking, summary: Refill uses wall-clock time }',
  '---',
  '',
  '## Findings',
  '',
  'Swap the wall clock for the steady one.',
].join('\n')

// Stands in for the engine beneath the plugin and for a project on disk with one dish in it:
// token-bucket sent back by its inspector, clock-source done. Folders are implied by the paths.
function world(on: On, at: number) {
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at },
    [`${DISH}/reports/token-bucket-verdict.md`]: { text: VERDICT, mtimeMs: at + 1 },
  }
  const dirs = new Set<string>()
  for (const path of Object.keys(files)) {
    const parts = path.split('/')
    for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.exists', async ($$, e) => ({ value: e.path in files || dirs.has(e.path) }))
  on('fs.read', async ($$, e) => {
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[e.path].text }
  })
  on('fs.list', async ($$, e) => {
    const names = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const path of [...Object.keys(files), ...dirs]) {
      if (!path.startsWith(`${e.path}/`)) continue
      const rest = path.slice(e.path.length + 1)
      if (rest.includes('/')) continue
      const file = files[path]
      names.set(rest, { name: rest, kind: file ? 'file' : 'dir', size: file ? file.text.length : 0, mtimeMs: file ? file.mtimeMs : 0, isLink: false })
    }
    return { value: [...names.values()] }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
}

// A cook, Basil, who has read token-bucket's packet and is editing in its worktree.
async function cook($: T) {
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'c1' })) void chunk
  await $.tool.call({ agentId: 'c1', tool: 'Read', file_path: `${DISH}/packets/token-bucket.md` } as never)
  await $.tool.call({ agentId: 'c1', tool: 'Edit', file_path: '/repo/.brigade/worktrees/limits--token-bucket/src/bucket.ts' } as never)
}

const mount = ($: T, surface: Surface) =>
  $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } })

// The picture's SVG source, or '' when the pane holds no picture.
async function sourceOf(ui: Ui) {
  const svg = await ui.find({ type: 'Svg' })
  return svg === undefined ? '' : String((svg.props as { source?: unknown }).source ?? '')
}

// The buttons under the picture, as key and label, in the order they are drawn.
async function buttons(ui: Ui) {
  return (await ui.findAll({ type: 'Button' })).map(b => ({ key: String((b.props as { key?: unknown }).key), label: b.text }))
}

// A box line as the picture holds it: every character is escaped the way the picture writes it.
const inPicture = (source: string, text: string) => source.includes(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))

test('on desktop the pane is a picture of the board with buttons under it, and no region', async ($, on) => {
  const clock = mock.clock(on)
  world(on, await clock.now())
  await cook($)
  await $.command.run(OPEN)
  const ui = await mount($, 'desktop')
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  const props = (svg?.props ?? {}) as Record<string, unknown>
  const source = String(props.source)
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.length).toBeLessThanOrEqual(131072)
  expect(props.alt).toBe('Brigade board')
  // A plain image with no size of its own: the app scales it to the pane and swaps it in place
  // when it changes. A sized, interactive one sits in a frame that reloads, and flashes, each time.
  expect('width' in props).toBe(false)
  expect('height' in props).toBe(false)
  expect('isInteractive' in props).toBe(false)
  // Drawn at the pane's width: the kit's 124 columns give the board 174, 9 pixels each.
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(source)
  expect(box?.[1]).toBe(String(174 * 9))
  expect(Number(box?.[2]) % 18).toBe(0)
  // The board itself is in the picture: the lanes and the cards.
  expect(source).toContain('Rework')
  expect(source).toContain('token-bucket')
  // No tooltips, and nothing in the picture moves on its own.
  expect(source).not.toContain('<title')
  expect(source).not.toContain('<animate')
  // Basil is drawn in real pixels: one path, in the haiku family's colour.
  const paths = source.match(/<path [^>]*>/g) ?? []
  expect(paths).toHaveLength(1)
  expect(paths[0]).toMatch(/^<path fill="#4cc9f0" d="M[^"]+"\/>$/)
  expect(await ui.find({ type: 'Text', text: /^Details:$/ })).toBeDefined()
  const row = await buttons(ui)
  expect(row.filter(b => /^card-\d+$/.test(b.key)).map(b => b.label).sort()).toEqual(['clock-source', 'token-bucket'])
  expect(row).toContainEqual({ key: 'agent-0', label: 'Basil' })
  // The verdict is addressed to the cook working the item, by name.
  expect(row).toContainEqual({ key: 'message-0', label: 'inspector → Basil' })
  expect(row.some(b => b.key === 'close-details')).toBe(false)
  await ui.unmount()
  // Nothing has moved, so the next mount draws the very same picture.
  const again = await mount($, 'desktop')
  expect(await sourceOf(again)).toBe(source)
  await again.unmount()
})

test("the picture is drawn at the pane's width, from 96 to 200 columns", async ($, on) => {
  mock.clock(on)
  // 108 columns of the app's give 151 of the board's, 1359 pixels; the narrowest board is 96
  // columns, and the widest 200.
  for (const [columns, px] of [[108, 1359], [50, 864], [400, 1800]]) {
    const ui = await $.ui.mount({ plugin: 'brigade', surface: 'desktop', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns, rows: 40 } })
    expect(await sourceOf(ui)).toContain(`viewBox="0 0 ${px} `)
    await ui.unmount()
  }
})

test("pressing a card's button opens its box in the picture, and Close details closes it", async ($, on) => {
  const clock = mock.clock(on)
  world(on, await clock.now())
  await $.command.run(OPEN)
  let ui = await mount($, 'desktop')
  const card = (await buttons(ui)).find(b => b.label === 'token-bucket')
  expect(card?.key).toMatch(/^card-\d+$/)
  await ui.press({ key: card?.key ?? '' })
  await ui.unmount()
  ui = await mount($, 'desktop')
  let source = await sourceOf(ui)
  expect(inPicture(source, 'token-bucket · Rework')).toBe(true)
  expect(inPicture(source, 'Refill the bucket from a steady clock.')).toBe(true)
  // The close button comes first in the row and dismisses.
  const row = await ui.findAll({ type: 'Button' })
  expect(row[0]?.props).toMatchObject({ key: 'close-details', label: 'Close details', role: 'dismiss' })
  await ui.press({ key: 'close-details' })
  await ui.unmount()
  ui = await mount($, 'desktop')
  source = await sourceOf(ui)
  expect(inPicture(source, 'token-bucket · Rework')).toBe(false)
  expect((await buttons(ui)).some(b => b.key === 'close-details')).toBe(false)
  await ui.unmount()
})

test("pressing an agent's or a message's button opens its box", async ($, on) => {
  const clock = mock.clock(on)
  world(on, await clock.now())
  await cook($)
  await $.command.run(OPEN)
  let ui = await mount($, 'desktop')
  await ui.press({ key: 'agent-0' })
  await ui.unmount()
  ui = await mount($, 'desktop')
  expect(inPicture(await sourceOf(ui), 'Model: claude-haiku-4-5')).toBe(true)
  await ui.press({ key: 'close-details' })
  await ui.press({ key: 'message-0' })
  await ui.unmount()
  ui = await mount($, 'desktop')
  const source = await sourceOf(ui)
  expect(inPicture(source, 'Model: claude-haiku-4-5')).toBe(false)
  expect(inPicture(source, 'From file: reports/token-bucket-verdict.md')).toBe(true)
  await ui.unmount()
})

// A state store the test fills in directly, so the board can hold things no file would give it.
function store(on: On, values: Record<string, unknown>) {
  const kept = new Map<string, { value: unknown; version: number }>(Object.entries(values).map(([key, value]) => [key, { value, version: 1 }]))
  on('state.get', async ($$, e) => ({ value: kept.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', async ($$, e) => {
    const now = kept.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } }
    kept.set(e.key, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } }
  })
  return kept
}

const lane = (key: string, title: string, ids: string[]) => ({ key, title, total: ids.length, cards: ids.map(id => ({ id, title: id, phase: key, tag: null, alert: false })) })
const agent = (id: string, name: string) => ({ id, name, role: 'cook', model: 'claude-haiku', dish: null, item: null, state: 'working', tokens: 0, startedAt: 0, endedAt: null, activity: null })
const message = (id: string, from: string) => ({ id, at: 0, from, to: 'cook', item: 'x', text: 'hello', file: null })

test('the row holds at most 12 cards, 12 agents and 4 messages, in the board order', async ($, on) => {
  mock.clock(on)
  const ids = Array.from({ length: 20 }, (_, i) => `card-${String(i).padStart(2, '0')}`)
  const agents = Array.from({ length: 15 }, (_, i) => agent(`a${i}`, `Agent${i}`))
  store(on, {
    work: [lane('todo', 'To do', ids.slice(0, 5)), lane('cooking', 'Cooking', ids.slice(5, 10)), lane('review', 'In review', ids.slice(10, 15)), lane('rework', 'Rework', ids.slice(15)), lane('done', 'Done', [])],
    fleet: { agents: Object.fromEntries(agents.map(a => [a.id, a])), order: agents.map(a => a.id) },
    messages: Array.from({ length: 6 }, (_, i) => message(`m${i}`, `inspector${i}`)),
  })
  const ui = await mount($, 'desktop')
  const row = await buttons(ui)
  expect(row.filter(b => b.key.startsWith('card-')).map(b => b.label)).toEqual(ids.slice(0, 12))
  expect(row.filter(b => b.key.startsWith('agent-')).map(b => b.label)).toEqual(agents.slice(0, 12).map(a => a.name))
  expect(row.filter(b => b.key.startsWith('message-')).map(b => b.label)).toEqual([0, 1, 2, 3].map(i => `inspector${i} → cook`))
  expect(row.map(b => b.key).slice(0, 3)).toEqual(['card-0', 'card-1', 'card-2'])
  await ui.unmount()
})

test('a hostile card id and agent name give clean, cut labels and leave no markup in the picture', async ($, on) => {
  mock.clock(on)
  const nasty = `<script>alert(1)</script>\u0007\u001b[31m\n\ud800${'x'.repeat(5000)}`
  const kept = store(on, {
    work: [lane('todo', 'To do', [nasty]), lane('cooking', 'Cooking', []), lane('review', 'In review', []), lane('rework', 'Rework', []), lane('done', 'Done', [])],
    // A short name keeps its half surrogate pair and its control character inside the cut.
    fleet: { agents: { evil: agent('evil', nasty), odd: agent('odd', 'Mo\ud800\u0000ss') }, order: ['evil', 'odd'] },
    messages: [message('m1', nasty)],
  })
  const ui = await mount($, 'desktop')
  const row = await buttons(ui)
  expect(row.map(b => b.key)).toEqual(['card-0', 'agent-0', 'agent-1', 'message-0'])
  expect(row.find(b => b.key === 'agent-1')?.label).toBe('Mo ss')
  for (const b of row.filter(b => b.key !== 'agent-1')) {
    expect(Array.from(b.label).length).toBeLessThanOrEqual(24)
    expect(b.label).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(b.label).not.toMatch(/[\ud800-\udfff]/)
    expect(b.label.startsWith('<script>alert(1)</script')).toBe(true)
  }
  const source = await sourceOf(ui)
  expect(source.length).toBeLessThanOrEqual(131072)
  expect(source).not.toContain('<script')
  expect(source).not.toContain('<title')
  // Pressing the hostile card's button changes nothing: no such card can be opened.
  await ui.press({ key: 'card-0' })
  expect(kept.get('detail')).toBeUndefined()
  await ui.unmount()
})

test('a board the picture cannot draw falls back to the plain lines', async ($, on) => {
  mock.clock(on)
  // Far too many cards for any picture the app accepts: it is thousands of pixels tall.
  const ids = Array.from({ length: 400 }, (_, i) => `t-${i}`)
  store(on, { work: [lane('todo', 'To do', ids), lane('cooking', 'Cooking', []), lane('review', 'In review', []), lane('rework', 'Rework', []), lane('done', 'Done', [])] })
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Ticket board$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^To do 400: t-0, t-1/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal still draws the region and no picture', async ($, on) => {
  mock.clock(on)
  const ui = await mount($, 'terminal')
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(1)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})
