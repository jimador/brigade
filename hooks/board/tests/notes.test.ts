import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 124, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const DISH = '/repo/.brigade/dishes/acme-notes'

type On = Parameters<Parameters<typeof test>[1]>[1]
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

const PLAN = '---\ndoc: plan\ndish: acme-notes\nticket: acme-7\nitems:\n  - { slug: board-parse, status: todo }\n---\n'
const report = (item: string) => `---\ndoc: report\ndish: acme-notes\nitem: ${item}\nrole: cook\nstatus: done\n---\n## Summary\n`
const VERDICT = '---\ndoc: verdict\ndish: acme-notes\nitem: board-parse\nrole: inspector\nverdict: FAIL\nfindings:\n  - { id: F1, severity: high, summary: Parser drops quoted colons }\n---\n'

// Stands in for the engine beneath the plugin and for a project on disk. `files` maps a path to
// its text and mtime; folders are implied by the paths, and tests change `files` as they go.
function world(on: On, files: Record<string, { text: string; mtimeMs: number }>) {
  const dirsOf = () => {
    const dirs = new Set<string>()
    for (const path of Object.keys(files)) {
      const parts = path.split('/')
      for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    }
    return dirs
  }
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.exists', async ($$, e) => ({ value: e.path in files || dirsOf().has(e.path) }))
  on('fs.read', async ($$, e) => {
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[e.path].text }
  })
  on('fs.stat', async ($$, e) => {
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: { kind: 'file', size: files[e.path].text.length, mtimeMs: files[e.path].mtimeMs, isLink: false } }
  })
  on('fs.list', async ($$, e) => {
    const names = new Map<string, Listing>()
    const dirs = dirsOf()
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
  on('command.register', async () => ({ value: {} }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
}

const mount = async ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'mobile') => {
  const ui = await $.ui.mount({ plugin: 'brigade', surface, component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } })
  if (surface === 'terminal') await ui.resize({ columns: 124, rows: 40, in: 'stage' })
  return ui
}

test('a cook report shows as a message to the inspector', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at },
    [`${DISH}/reports/board-parse-cook.md`]: { text: report('board-parse'), mtimeMs: at + 1 },
  })
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /│ cook → inspector +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /│ board-parse ready for review +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NOTES/ })).toBeUndefined()
  await ui.unmount()
  const text = await mount($, 'mobile')
  expect(await text.find({ type: 'Text', text: /^cook → inspector: board-parse ready for review$/ })).toBeDefined()
  await text.unmount()
})

test('a verdict that lands while the board is open shows as a message to the cook within a tick', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at + 100 },
    [`${DISH}/reports/board-parse-cook.md`]: { text: report('board-parse'), mtimeMs: at + 101 },
  }
  world(on, files)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.agent.spawn({ tool_use_id: 't1', prompt: `Cook the packet in ${DISH}/ now.`, description: 'cook:board-parse:0', subagentType: 'brigade:brigade-cook', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false } as never)
  await $.turn.complete({ agentId: 'a1', answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /│ Basil → inspector +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /inspector → Basil/, in: 'stage' })).toBeUndefined()
  files[`${DISH}/reports/board-parse-verdict.md`] = { text: VERDICT, mtimeMs: at + 102 }
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /│ inspector → Basil +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /│ board-parse sent back: Parser drops quoted colons +│/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test("the repo's learnings show in their panel, and change when the file does", async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at + 200 },
    '/repo/.brigade/LEARNINGS.md': { text: '# Learnings\n\n## Keep fixtures invented\n\n## Run the bundle check first\n', mtimeMs: at + 200 },
  }
  world(on, files)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.command.run(OPEN)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /│ Run the bundle check first +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /│ Keep fixtures invented +│/, in: 'stage' })).toBeDefined()
  files['/repo/.brigade/LEARNINGS.md'] = { text: '## Name the failing input\n', mtimeMs: at + 201 }
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /│ Name the failing input +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Keep fixtures invented/, in: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('a hostile item name is shown as literal text, never as a link', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at + 300 },
    [`${DISH}/reports/x-cook.md`]: { text: report('[x](http://example.invalid)'), mtimeMs: at + 301 },
  })
  await $.command.run(OPEN)
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await mount($, surface)
    const scope = surface === 'terminal' ? { in: 'stage' } : {}
    expect(await ui.find({ type: 'Text', text: /\[x\]\(http:\/\/example\.invalid\) ready for review/, ...scope })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Link', ...scope })).toBeUndefined()
    await ui.unmount()
  }
})
