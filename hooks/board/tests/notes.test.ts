import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const DISH = '/repo/.brigade/dishes/obsidian-example'

type On = Parameters<Parameters<typeof test>[1]>[1]
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

const PLAN = '---\ndoc: plan\ndish: obsidian-example\nticket: example\nitems:\n  - { slug: board-parse, status: cooking }\n---\n'
const report = (item: string) => `---\ndoc: report\ndish: obsidian-example\nitem: ${item}\nrole: cook\nstatus: done\n---\n## Summary\n`
const LEDGER = '---\ndoc: ledger\ndish: obsidian-example\nitem: board-parse\nrole: cook\n---\n## Canon\nC1. stay in the file list\n## World state\nW1. parser reads the frontmatter\nW2. tests green on terminal\n'

// Stands in for the engine beneath the plugin and for a project on disk: one dish with a plan,
// a cook report and the cook's ledger, all written at `at`. Folders are implied by file paths.
function world(on: On, files: Record<string, string>, at: number) {
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
    return { value: files[e.path] }
  })
  on('fs.list', async ($$, e) => {
    const names = new Map<string, Listing>()
    for (const path of [...Object.keys(files), ...dirs]) {
      if (!path.startsWith(`${e.path}/`)) continue
      const rest = path.slice(e.path.length + 1)
      if (rest.includes('/')) continue
      const kind = path in files ? 'file' : 'dir'
      names.set(rest, { name: rest, kind, size: kind === 'file' ? files[path].length : 0, mtimeMs: at, isLink: false })
    }
    return { value: [...names.values()] }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('command.register', async () => ({ value: {} }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
}

const mount = ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'mobile') =>
  $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })

test('notes show under the board, and a clicked agent shows its working memory', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(
    on,
    {
      [`${DISH}/PLAN.md`]: PLAN,
      [`${DISH}/reports/board-parse-cook.md`]: report('board-parse'),
      [`${DISH}/state/board-parse.md`]: LEDGER,
    },
    at,
  )
  // The five-second timer starts in session.start; nothing beneath the plugin answers it.
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.command.run(OPEN)
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /NOTES/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cook board-parse · report done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MEMORY/ })).toBeUndefined()
    await ui.unmount()
  }
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'Cook the packet in /repo/.brigade/dishes/obsidian-example/ now.', description: 'cook:board-parse:0', subagentType: 'brigade:brigade-cook', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false } as never)
  const ui = await mount($, 'terminal')
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await ui.post({ select: 'a1' }, { in: 'stage' })
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /MEMORY · Basil/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /W1\. parser reads the frontmatter/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /C1\./ })).toBeUndefined()
  await ui.unmount()
})

test('a clicked agent without a memory file says so', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, { [`${DISH}/PLAN.md`]: PLAN }, at)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'Cook the packet in /repo/.brigade/dishes/obsidian-example/ now.', description: 'cook:board-parse:0', subagentType: 'brigade:brigade-cook', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false } as never)
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await ui.post({ select: 'a1' }, { in: 'stage' })
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /MEMORY · Basil/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no memory file yet/ })).toBeDefined()
  await ui.unmount()
})

test('a hostile item name is shown as literal text, never as a link', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, { [`${DISH}/PLAN.md`]: PLAN, [`${DISH}/reports/x-cook.md`]: report('[x](http://example.invalid)') }, at)
  await $.command.run(OPEN)
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /cook \[x\]\(http:\/\/example\.invalid\) · report done/ })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
})
