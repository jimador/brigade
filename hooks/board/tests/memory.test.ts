import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const DISH = '/repo/.brigade/dishes/obsidian-example'
const SPAWN = { tool_use_id: 't1', prompt: 'Cook the packet in /repo/.brigade/dishes/obsidian-example/ now.', description: 'cook:board-parse:0', subagentType: 'brigade:brigade-cook', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false }

type On = Parameters<Parameters<typeof test>[1]>[1]
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

const PLAN = '---\ndoc: plan\ndish: obsidian-example\nticket: example\nitems:\n  - { slug: board-parse, status: cooking }\n---\n'
const LEDGER = '---\ndoc: ledger\ndish: obsidian-example\nitem: board-parse\nrole: cook\n---\n## Canon\nC1. stay in the file list\n## World state\nW1. parser reads the frontmatter\nW2. tests green on terminal\n'

// Stands in for the engine beneath the plugin and for a project on disk, every file written at
// `at`. Folders are implied by file paths.
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

test('a click shows the agent memory at once, and clearing the selection removes it', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, { [`${DISH}/PLAN.md`]: PLAN, [`${DISH}/state/board-parse.md`]: LEDGER }, at)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.agent.spawn(SPAWN as never)
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /MEMORY ·/ })).toBeUndefined()
  // No clock advance and no manual redraw: storing the memory has to redraw the pane by itself.
  await ui.post({ select: 'a1' }, { in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /MEMORY · Basil/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /W1\. parser reads the frontmatter/ })).toBeDefined()
  await ui.post({ select: null }, { in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /MEMORY ·/ })).toBeUndefined()
  await ui.unmount()
})

test('an agent stands in its ticket lane', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(
    on,
    {
      '/repo/.brigade/config.md': '- source: local\n- database_id: ./board\n',
      '/repo/board/example.md': '---\nid: example\ntitle: Example\nstatus: in_progress\n---\n',
      [`${DISH}/PLAN.md`]: PLAN,
    },
    at,
  )
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.agent.spawn(SPAWN as never)
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await clock.advance(5000)
  await ui.redraw()
  const texts = (await ui.findAll({ type: 'Text', in: 'stage' })).map(t => t.text)
  const cooking = texts.findIndex(text => /COOKING/.test(text))
  const review = texts.findIndex(text => /IN REVIEW/.test(text))
  const basil = texts.findIndex(text => /Basil/.test(text))
  expect(cooking).toBeGreaterThan(-1)
  expect(basil).toBeGreaterThan(cooking)
  expect(basil).toBeLessThan(review)
  await ui.unmount()
})

test('a hostile role and status show as literal text, never as a link', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const hostile = '---\ndoc: report\ndish: obsidian-example\nitem: board-parse\nrole: [x](http://example.invalid)\nstatus: <b>done</b>\n---\n## Summary\n'
  world(on, { [`${DISH}/PLAN.md`]: PLAN, [`${DISH}/reports/board-parse-cook.md`]: hostile }, at)
  await $.command.run(OPEN)
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /\[x\]\(http:\/\/example\.invalid\) board-parse · report <b>done<\/b>/ })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
})
