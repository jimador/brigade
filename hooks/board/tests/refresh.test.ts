import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const CONFIG = '/repo/.brigade/config.md'

type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

// Stands in for the project on disk: a config that points at a relative board folder, and
// whatever ticket files the test puts in `files`. Each test gets its own mtimes so the
// board's ticket cache, which lives for the whole module, never hands one test another's tickets.
function world(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, mtimes: Record<string, number>, hasConfig = true) {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.exists', async ($$, e) => ({ value: hasConfig && e.path === CONFIG }))
  on('fs.read', async ($$, e) => {
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[e.path] }
  })
  on('fs.list', async () => ({
    value: Object.keys(files)
      .filter(path => path.startsWith('/repo/board/'))
      .map((path): Listing => {
        const name = path.slice('/repo/board/'.length)
        return { name, kind: 'file', size: files[path].length, mtimeMs: mtimes[name] ?? 1, isLink: false }
      }),
  }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 58000, window: 100000, percent: 58 }, rateLimits: [] } }))
}

const ticket = (id: string, status: string) => `---\nid: ${id}\ntitle: Ticket ${id}\nstatus: ${status}\n---\n`

test('lanes and weather come from the board folder and the context figures', async ($, on) => {
  mock.clock(on)
  const files = {
    [CONFIG]: '- source: local\n- database_id: ./board\n',
    '/repo/board/a.md': ticket('a', 'todo'),
    '/repo/board/b.md': ticket('b', 'in_progress'),
    '/repo/board/_board.md': ticket('ignored', 'todo'),
  }
  world(on, files, { 'a.md': 101, 'b.md': 102, '_board.md': 103 })
  expect(await $.command.run(OPEN)).toEqual({ text: 'Board opened.' })
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /TODO 1/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /COOKING 1/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SHOWERS 58%/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('a status edit on disk shows after the next tick without reopening the pane', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [CONFIG]: '- source: local\n- database_id: board\n',
    '/repo/board/a.md': ticket('a', 'todo'),
    '/repo/board/b.md': ticket('b', 'in_progress'),
  }
  const mtimes: Record<string, number> = { 'a.md': 201, 'b.md': 202 }
  world(on, files, mtimes)
  on('command.register', async () => ({ value: {} }))
  // The five-second timer starts in session.start. The test kit has nothing beneath the plugin
  // to answer that event, so the raise ends there, after the board's own hook has run.
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  expect(await ui.find({ type: 'Text', text: /TODO 1/, in: 'stage' })).toBeDefined()
  files['/repo/board/a.md'] = ticket('a', 'done')
  mtimes['a.md'] = 211
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /DONE 1/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /TODO 0/, in: 'stage' })).toBeDefined()
  // A ticket file that vanishes drops out of its lane on the next tick too.
  delete files['/repo/board/b.md']
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /COOKING 0/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('a repo without .brigade/config.md still draws the board and throws nothing', async ($, on) => {
  const clock = mock.clock(on)
  world(on, {}, {}, false)
  expect(await $.command.run(OPEN)).toEqual({ text: 'Board opened.' })
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 80, rows: 30 } })
  await ui.resize({ columns: 80, rows: 30, in: 'stage' })
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /BRIGADE/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})
