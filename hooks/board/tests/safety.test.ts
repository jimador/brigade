import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const SPAWN = { tool_use_id: 't1', prompt: 'Cook the packet.', description: 'cook:x:0', subagentType: 'brigade:brigade-cook', provider: 'anthropic', model: 'haiku', parentModel: 'x', fork: false }
const ROOT = '/path/to/repo'
const DISH = `${ROOT}/.brigade/dishes/obsidian-example`

type On = Parameters<Parameters<typeof test>[1]>[1]
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

// The board's hooks ride on every session start, agent spawn, tool call and finished turn.
// These tests break the board's own work underneath them and check the session never notices.

// The engine forgives a hook that throws: it runs what is beneath in its place, or keeps what
// `next` gave it. So a result alone can't show the board misbehaving. This plugin sits above
// the board, reads how the engine settled the board's link, and reports it as a path the test's
// `fs.exists` sees: `/trace/<event>/<outcome>`. A well-behaved board link reads `passed` or
// `returned`; `skipped` or `kept` mean the board threw.
const watch: Plugin = {
  name: 'watch',
  tier: 'prepend',
  register(on) {
    on('session.start', async ($, e, next) => {
      const ran = await next(e)
      const board = next.trace.find(link => link.plugin === 'brigade')
      await $.fs.exists(`/trace/session.start/${board ? board.outcome : 'missing'}`)
      return ran
    })
    on('agent.spawn', async ($, e, next) => {
      const ran = await next(e)
      const board = next.trace.find(link => link.plugin === 'brigade')
      await $.fs.exists(`/trace/agent.spawn/${board ? board.outcome : 'missing'}`)
      return ran
    })
    on('tool.call', async ($, e, next) => {
      const ran = await next(e)
      const board = next.trace.find(link => link.plugin === 'brigade')
      await $.fs.exists(`/trace/tool.call/${board ? board.outcome : 'missing'}`)
      return ran
    })
    on('turn.complete', async ($, e, next) => {
      const ran = await next(e)
      const board = next.trace.find(link => link.plugin === 'brigade')
      await $.fs.exists(`/trace/turn.complete/${board ? board.outcome : 'missing'}`)
      return ran
    })
  },
}

// Stands in for everything beneath the plugin except the disk, which each test supplies.
function engine(on: On) {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: ROOT }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('session.start', async ($$, e) => ({ cwd: e.cwd }))
}

// Wraps a test's `fs.exists` so the watch reports land in `traces` and everything else goes to
// `rest`.
function exists(traces: string[], rest: (path: string) => Promise<boolean>) {
  return async ($$: unknown, e: { path: string }) => {
    if (e.path.startsWith('/trace/')) {
      traces.push(e.path.slice('/trace/'.length))
      return { value: false }
    }
    return { value: await rest(e.path) }
  }
}

const clean = (traces: string[]) => traces.filter(trace => !/\/(passed|returned)$/.test(trace))

test('a session starts and the command registers even when every disk read fails', { plugins: [watch] }, async ($, on) => {
  mock.clock(on)
  const traces: string[] = []
  engine(on)
  const registered: string[] = []
  on('command.register', async ($$, e) => {
    registered.push(e.name)
    return { value: {} }
  })
  on(
    'fs.exists',
    exists(traces, async () => {
      throw new Error('disk gone')
    }),
  )
  on('fs.read', async () => {
    throw new Error('disk gone')
  })
  on('fs.list', async () => {
    throw new Error('disk gone')
  })
  expect(await $.session.start({ cwd: ROOT })).toEqual({ cwd: ROOT })
  expect(registered).toEqual(['brigade-board'])
  expect(traces.length).toBe(1)
  expect(clean(traces)).toEqual([])
})

test('a session starts without waiting for the board scan', { plugins: [watch] }, async ($, on) => {
  mock.clock(on)
  const traces: string[] = []
  engine(on)
  on('command.register', async () => ({ value: {} }))
  // The disk never answers until the test lets it.
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on(
    'fs.exists',
    exists(traces, async () => {
      await gate
      return false
    }),
  )
  const started = $.session.start({ cwd: ROOT }).then(() => 'started')
  const late = new Promise(resolve => setTimeout(resolve, 500, 'waited on the scan'))
  expect(await Promise.race([started, late])).toBe('started')
  release()
})

test('a session starts even when registering the command fails', { plugins: [watch] }, async ($, on) => {
  mock.clock(on)
  const traces: string[] = []
  engine(on)
  on('command.register', async () => {
    throw new Error('no commands today')
  })
  on(
    'fs.exists',
    exists(traces, async () => false),
  )
  expect(await $.session.start({ cwd: ROOT })).toEqual({ cwd: ROOT })
  expect(traces.length).toBe(1)
  expect(clean(traces)).toEqual([])
})

test('starting the session three times still scans the board once per tick', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('command.register', async () => ({ value: {} }))
  on('fs.exists', async ($$, e) => ({ value: e.path === `${ROOT}/.brigade/config.md` }))
  on('fs.read', async () => ({ value: '- source: local\n- database_id: ./board\n' }))
  let lists = 0
  on('fs.list', async () => {
    lists++
    return { value: [] }
  })
  // Half a second apart, so timers that were each started would come due one after another.
  for (let i = 0; i < 3; i++) {
    await $.session.start({ cwd: ROOT })
    await clock.advance(500)
  }
  // Opening the board waits for whatever scan is in flight, so the count below starts clean.
  await $.command.run(OPEN)
  const before = lists
  await clock.advance(2000)
  // One scan of the empty board folder is one listing.
  expect(lists - before).toBe(1)
})

// The test kit refuses an `agent.spawn` answer that is not a result object, so a spawn that
// resolves to nothing can't be raised here; the nearest it allows is a refusal, which carries no
// agent id, alongside a state store that fails under the board's roster write.
test('agent.spawn hands back exactly what the engine answered', { plugins: [watch] }, async ($, on) => {
  mock.clock(on)
  const traces: string[] = []
  engine(on)
  let answer: unknown = { deny: 'not now' }
  let spawns = 0
  on('agent.spawn', async () => {
    spawns++
    return answer as never
  })
  on('state.get', async () => {
    throw new Error('store down')
  })
  on('state.set', async () => {
    throw new Error('store down')
  })
  on(
    'fs.exists',
    exists(traces, async () => false),
  )
  expect(await $.agent.spawn(SPAWN as never)).toEqual({ deny: 'not now' })
  answer = { agentId: 'a9', model: 'claude-haiku-4-5' }
  expect(await $.agent.spawn(SPAWN as never)).toEqual({ agentId: 'a9', model: 'claude-haiku-4-5' })
  expect(spawns).toBe(2)
  expect(traces.length).toBe(2)
  expect(clean(traces)).toEqual([])
})

test('a note time out of range still lets the pane render', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  engine(on)
  const report = (item: string) => `---\ndoc: report\ndish: obsidian-example\nitem: ${item}\nrole: cook\nstatus: done\n---\n`
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${DISH}/PLAN.md`]: { text: '---\ndoc: plan\ndish: obsidian-example\nticket: example\nitems:\n  - { slug: far, status: todo }\n---\n', mtimeMs: at },
    [`${DISH}/reports/far-cook.md`]: { text: report('far'), mtimeMs: 8.64e15 + 1 },
    [`${DISH}/reports/never-cook.md`]: { text: report('never'), mtimeMs: Infinity },
  }
  const dirs = new Set([`${ROOT}/.brigade/dishes`, DISH, `${DISH}/reports`])
  on('fs.exists', async ($$, e) => ({ value: e.path in files || dirs.has(e.path) }))
  on('fs.read', async ($$, e) => ({ value: files[e.path].text }))
  on('fs.list', async ($$, e) => {
    const out: Listing[] = []
    for (const path of [...Object.keys(files), ...dirs]) {
      if (!path.startsWith(`${e.path}/`) || path.slice(e.path.length + 1).includes('/')) continue
      const isFile = path in files
      out.push({ name: path.slice(e.path.length + 1), kind: isFile ? 'file' : 'dir', size: 0, mtimeMs: isFile ? files[path].mtimeMs : at, isLink: false })
    }
    return { value: out }
  })
  await $.command.run(OPEN)
  const text = await $.ui.mount({ plugin: 'brigade', surface: 'mobile', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  expect(await text.find({ type: 'Text', text: /^In review 1: far$/ })).toBeDefined()
  expect(await text.find({ type: 'Text', text: /^cook → inspector: far ready for review$/ })).toBeDefined()
  expect(await text.find({ type: 'Text', text: /^cook → inspector: never ready for review$/ })).toBeDefined()
  await text.unmount()
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /far ready for review/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('tool calls and finished turns pass through when the state store fails', { plugins: [watch] }, async ($, on) => {
  mock.clock(on)
  const traces: string[] = []
  engine(on)
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: 'done' }))
  on('state.get', async () => {
    throw new Error('store down')
  })
  on('state.set', async () => {
    throw new Error('store down')
  })
  on(
    'fs.exists',
    exists(traces, async () => false),
  )
  const write = { agentId: 'a2', tool: 'Write', file_path: `${DISH}/reports/x-cook.md` }
  expect(await $.tool.call(write as never)).toEqual({ result: 'ok' })
  // The main loop's calls, and calls whose fields are not what they should be, pass through too.
  expect(await $.tool.call({ tool: 'Read', file_path: `${DISH}/PLAN.md` } as never)).toEqual({ result: 'ok' })
  expect(await $.tool.call({ agentId: 'a2', tool: 'Bash', command: { not: 'text' }, file_path: 42 } as never)).toEqual({ result: 'ok' })
  expect(await $.tool.call({ agentId: 'a2', tool: 'Edit', file_path: 'x'.repeat(100000) } as never)).toEqual({ result: 'ok' })
  expect(await $.turn.complete({ agentId: 'a2', reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' } as never)).toEqual({ text: 'done' })
  expect(clean(traces)).toEqual([])
  expect(traces.length).toBe(5)
})
