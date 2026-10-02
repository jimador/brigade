import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 124, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const DISH = '/repo/.brigade/dishes/acme-limits'

type T = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type Ui = Awaited<ReturnType<T['ui']['mount']>>
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

const PLAN = [
  '---',
  'doc: plan',
  'dish: acme-limits',
  'ticket: acme-12',
  'items:',
  '  - { slug: token-bucket, status: todo, files: [src/bucket.ts, src/bucket.test.ts], depends_on: [clock-source] }',
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

const LEDGER = [
  '---',
  'doc: ledger',
  'dish: acme-limits',
  'item: token-bucket',
  '---',
  '## Canon',
  'C1. Touch only the bucket.',
  '## World state',
  'W1. [RELIABLE] bucket tests red before the change.',
  'W2. [RELIABLE] bucket tests green after the change.',
].join('\n')

// Stands in for the engine beneath the plugin and for a project on disk with one dish in it.
// `files` maps a path to its text and mtime; folders are implied by the paths. Every read, and
// every check for a file, is written down, so a test can tell whether a click made the board go
// looking for a file at all, whether or not it was there. `extra` adds entries to a folder's
// listing that no file stands behind. `hold(path)` makes the next read of that file wait until
// the test releases it, and says when the board has got that far. `when(path)` says when the
// board next checks whether that file is there.
function world(on: On, files: Record<string, { text: string; mtimeMs: number }>, extra: Record<string, Listing[]> = {}) {
  const reads: string[] = []
  const looks: string[] = []
  const holds = new Map<string, { reached: () => void; wait: Promise<void> }>()
  const hold = (path: string) => {
    let reached = () => {}
    let release = () => {}
    const seen = new Promise<void>(resolve => {
      reached = resolve
    })
    const wait = new Promise<void>(resolve => {
      release = resolve
    })
    holds.set(path, { reached, wait })
    return { seen, release }
  }
  const waits = new Map<string, () => void>()
  const when = (path: string) => new Promise<void>(resolve => waits.set(path, resolve))
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
  on('fs.exists', async ($$, e) => {
    looks.push(e.path)
    const waiting = waits.get(e.path)
    if (waiting) {
      waits.delete(e.path)
      waiting()
    }
    return { value: e.path in files || dirsOf().has(e.path) }
  })
  on('fs.read', async ($$, e) => {
    reads.push(e.path)
    const held = holds.get(e.path)
    if (held) {
      holds.delete(e.path)
      held.reached()
      await held.wait
    }
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[e.path].text }
  })
  on('fs.stat', async ($$, e) => {
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: { kind: 'file', size: files[e.path].text.length, mtimeMs: files[e.path].mtimeMs, isLink: false } }
  })
  on('fs.list', async ($$, e) => {
    const names = new Map<string, Listing>()
    for (const path of [...Object.keys(files), ...dirsOf()]) {
      if (!path.startsWith(`${e.path}/`)) continue
      const rest = path.slice(e.path.length + 1)
      if (rest.includes('/')) continue
      const file = files[path]
      names.set(rest, { name: rest, kind: file ? 'file' : 'dir', size: file ? file.text.length : 0, mtimeMs: file ? file.mtimeMs : 0, isLink: false })
    }
    for (const entry of extra[e.path] ?? []) names.set(entry.name, entry)
    return { value: [...names.values()] }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 0, window: 100000, percent: 0 }, rateLimits: [] } }))
  on('command.register', async () => ({ value: {} }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  return { reads, looks, hold, when }
}

// The dish on disk at `at`: its plan, a failed review of token-bucket, and the cook's working memory.
const dishFiles = (at: number) => ({
  [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at },
  [`${DISH}/reports/token-bucket-verdict.md`]: { text: VERDICT, mtimeMs: at + 1 },
  [`${DISH}/state/token-bucket.md`]: { text: LEDGER, mtimeMs: at + 2 },
})

// A cook, Basil, who has read token-bucket's packet and is editing in its worktree.
async function cook($: T, id = 'c1') {
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: id })) void chunk
  await $.tool.call({ agentId: id, tool: 'Read', file_path: `${DISH}/packets/token-bucket.md` } as never)
  await $.tool.call({ agentId: id, tool: 'Edit', file_path: '/repo/.brigade/worktrees/limits--token-bucket/src/bucket.ts' } as never)
}

async function board($: T) {
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } })
  await ui.resize({ columns: 124, rows: 40, in: 'stage' })
  return ui
}

// The board's rows, top to bottom, as plain text.
async function rows(ui: Ui) {
  return (await ui.findAll({ type: 'Text', in: 'stage' })).filter(t => t.children.some(c => typeof c === 'object')).map(row => row.text)
}

// Clicks the first cell of the first match of `pattern` on the board, `dy` rows below it.
async function click(ui: Ui, pattern: RegExp, dy = 0) {
  const all = await rows(ui)
  const y = all.findIndex(row => pattern.test(row))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = Array.from(all[y].slice(0, all[y].search(pattern))).length
  await ui.pointer({ type: 'down', x, y: y + dy, button: 'left', in: 'stage' })
}

// Clicks the sprite whose name tag matches, once the sprites have walked home. On a card the tag
// sits on the row under the sprite, from its left edge.
async function clickSprite(ui: Ui, tag: RegExp) {
  await ui.advance(250 * 60)
  await click(ui, tag, -1)
}

// Whether the detail box is up: its close button shows on its top edge.
const boxUp = async (ui: Ui) => (await ui.find({ type: 'Text', text: /\[x\]/, in: 'stage' })) !== undefined
// A line inside the box: the box's left border, a space, then the text.
const inBox = (ui: Ui, text: string) => ui.find({ type: 'Text', text: new RegExp(`║ ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), in: 'stage' })

test('clicking a card shows its goal, files and the finding that sent it back', async ($, on) => {
  const clock = mock.clock(on)
  world(on, dishFiles(await clock.now()))
  const ui = await board($)
  expect(await boxUp(ui)).toBe(false)
  await click(ui, /(?<=│)token-bucket/)
  expect(await boxUp(ui)).toBe(true)
  expect(await inBox(ui, 'token-bucket · Rework')).toBeDefined()
  expect(await inBox(ui, 'Refill the bucket from a steady clock.')).toBeDefined()
  expect(await inBox(ui, 'Files: src/bucket.ts, src/bucket.test.ts')).toBeDefined()
  expect(await inBox(ui, 'Depends on: clock-source')).toBeDefined()
  expect(await inBox(ui, 'Review: FAIL, attempt 1')).toBeDefined()
  expect(await inBox(ui, 'F1 (blocking) Refill uses wall-clock time')).toBeDefined()
  // A click on the box keeps it open; one on [x] closes it.
  await click(ui, /║ Files:/)
  expect(await boxUp(ui)).toBe(true)
  await click(ui, /\[x\]/)
  expect(await boxUp(ui)).toBe(false)
  await ui.unmount()
})

test('clicking an agent shows its model and working memory at once, and a click outside closes it', async ($, on) => {
  const clock = mock.clock(on)
  world(on, dishFiles(await clock.now()))
  await cook($)
  const ui = await board($)
  await clickSprite(ui, /♨ Basil/)
  // No tick has run since the click: the box and its memory are there straight away.
  expect(await inBox(ui, 'Basil · cook')).toBeDefined()
  expect(await inBox(ui, 'Model: claude-haiku-4-5')).toBeDefined()
  expect(await inBox(ui, 'Working: token-bucket')).toBeDefined()
  expect(await inBox(ui, 'Working memory')).toBeDefined()
  expect(await inBox(ui, 'W2. [RELIABLE] bucket tests green after the change.')).toBeDefined()
  // The header is well off the box.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'stage' })
  expect(await boxUp(ui)).toBe(false)
  await ui.unmount()
})

test('clicking a message shows its text, its source file and what that file says', async ($, on) => {
  const clock = mock.clock(on)
  world(on, dishFiles(await clock.now()))
  const ui = await board($)
  await click(ui, /inspector → cook/)
  expect(await inBox(ui, 'inspector → cook')).toBeDefined()
  expect(await inBox(ui, 'token-bucket sent back: Refill uses wall-clock time')).toBeDefined()
  expect(await inBox(ui, 'About: token-bucket')).toBeDefined()
  expect(await inBox(ui, 'From file: reports/token-bucket-verdict.md')).toBeDefined()
  expect(await inBox(ui, 'F1 (blocking) Refill uses wall-clock time')).toBeDefined()
  expect(await inBox(ui, 'Swap the wall clock for the steady one.')).toBeDefined()
  await ui.unmount()
})

test("an agent's box closes on the first tick after it leaves the board", async ($, on) => {
  const clock = mock.clock(on)
  world(on, dishFiles(await clock.now()))
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  await cook($)
  const ui = await board($)
  await clickSprite(ui, /♨ Basil/)
  expect(await inBox(ui, 'Basil · cook')).toBeDefined()
  await $.turn.complete({ agentId: 'c1', answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'error' } as never)
  // A finished agent stays on the board for two minutes, and its box stays with it.
  await clock.advance(60000)
  expect(await inBox(ui, 'Basil · cook')).toBeDefined()
  await clock.advance(62000)
  expect(await ui.find({ type: 'Text', text: /Basil/, in: 'stage' })).toBeUndefined()
  expect(await boxUp(ui)).toBe(false)
  await ui.unmount()
})

test('clicking a ticket on the ticket board shows its title, kind and goal', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, {
    '/repo/.brigade/config.md': { text: '- source: local\n- database_id: ./board\n', mtimeMs: at },
    '/repo/board/acme-7.md': { text: '---\nid: acme-7\ntitle: Rate limit the API\nstatus: todo\nkind: feature\n---\n## Goal\n\nKeep one noisy client from starving the rest.\n\n## Notes\n\nNot this.\n', mtimeMs: at },
  })
  const ui = await board($)
  await click(ui, /(?<=│)acme-7/)
  expect(await inBox(ui, 'acme-7 · todo')).toBeDefined()
  expect(await inBox(ui, 'Rate limit the API')).toBeDefined()
  expect(await inBox(ui, 'Kind: feature')).toBeDefined()
  expect(await inBox(ui, 'Keep one noisy client from starving the rest.')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Not this/, in: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('a hostile open reads no file and shows no box', async ($, on) => {
  const clock = mock.clock(on)
  const { reads, looks } = world(on, dishFiles(await clock.now()))
  await cook($)
  const ui = await board($)
  const before = reads.length
  const looked = looks.length
  const hostile: unknown[] = []
  for (const kind of ['card', 'agent', 'message']) {
    hostile.push({ open: { kind, id: '../../../../etc/passwd' } })
    hostile.push({ open: { kind, id: 'reports/token-bucket-verdict.md' } })
    hostile.push({ open: { kind, id: 'x'.repeat(5000) } })
    hostile.push({ open: { kind, id: 't'.repeat(5000) + ':reports/token-bucket-verdict.md' } })
  }
  hostile.push(
    { open: { kind: 'plan', id: 'token-bucket' } },
    { open: { kind: 'card', id: 'token-bucket', file: '../../../../etc/passwd' } },
    { open: null },
    'token-bucket',
    [{ open: { kind: 'card', id: 'token-bucket' } }],
  )
  for (const data of hostile) {
    await ui.post(data, { in: 'stage' })
    expect(looks.slice(looked)).toEqual([])
    expect(reads.slice(before)).toEqual([])
    expect(await boxUp(ui)).toBe(false)
  }
  // The same board does open a box, and read its verdict, for a well-formed click.
  await ui.post({ open: { kind: 'card', id: 'token-bucket' } }, { in: 'stage' })
  expect(await boxUp(ui)).toBe(true)
  expect(reads.slice(before)).toEqual([`${DISH}/reports/token-bucket-verdict.md`])
  await ui.unmount()
})

test('a ticket file with a space in its name shows its goal', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  world(on, {
    '/repo/.brigade/config.md': { text: '- source: local\n- database_id: ./board\n', mtimeMs: at },
    '/repo/board/my ticket.md': { text: '---\nid: acme-8\ntitle: Cache the price list\nstatus: todo\nkind: feature\n---\n## Goal\n\nServe prices without a database trip.\n', mtimeMs: at + 1 },
  })
  const ui = await board($)
  await ui.post({ open: { kind: 'card', id: 'acme-8' } }, { in: 'stage' })
  expect(await inBox(ui, 'Cache the price list')).toBeDefined()
  expect(await inBox(ui, 'Serve prices without a database trip.')).toBeDefined()
  await ui.unmount()
})

test('a ticket whose file name could leave the folder opens without reading anything', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const ticket = (id: string) => ({ text: `---\nid: ${id}\ntitle: Ticket ${id}\nstatus: todo\n---\n## Goal\n\nSecret goal.\n`, mtimeMs: at + 2 })
  const { reads, looks } = world(
    on,
    {
      '/repo/.brigade/config.md': { text: '- source: local\n- database_id: ./board\n', mtimeMs: at },
      '/repo/board/sub/slash.md': ticket('acme-slash'),
      '/repo/board/sub\\back.md': ticket('acme-back'),
      '/repo/board/.dot.md': ticket('acme-dot'),
      '/repo/board/..dots.md': ticket('acme-dots'),
    },
    // The listing names a file one folder down, as a broken or hostile listing might.
    { '/repo/board': [{ name: 'sub/slash.md', kind: 'file', size: 0, mtimeMs: at + 2, isLink: false }] },
  )
  const ui = await board($)
  for (const id of ['acme-slash', 'acme-back', 'acme-dot', 'acme-dots']) {
    const before = reads.length
    const looked = looks.length
    await ui.post({ open: { kind: 'card', id } }, { in: 'stage' })
    expect(await inBox(ui, `Ticket ${id}`)).toBeDefined()
    expect(reads.slice(before)).toEqual([])
    expect(looks.slice(looked)).toEqual([])
    expect(await ui.find({ type: 'Text', text: /Secret goal/, in: 'stage' })).toBeUndefined()
  }
  await ui.unmount()
})

const LEARNINGS = '/repo/.brigade/LEARNINGS.md'

// Fails the test, rather than hanging it, when the board never gets as far as a held read.
const within = <V>(promise: Promise<V>, what: string) =>
  Promise.race([promise, new Promise<never>((resolve, reject) => setTimeout(() => reject(new Error(`never got to ${what}`)), 2000))])

// Waits until `check` holds, looking every few milliseconds, and fails after two seconds.
async function until(check: () => Promise<boolean>, what: string) {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`never saw ${what}`)
}

// Gives a write from a tick nobody awaits the time to land and redraw before the board is read.
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

test('a tick that started before a click never writes the older card over the newer box', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const queue = '/repo/.brigade/dishes/acme-queue'
  const verdict = (item: string) => `---\ndoc: verdict\ndish: acme-queue\nitem: ${item}\nrole: inspector\nverdict: FAIL\nattempt: 1\nfindings:\n  - { id: F1, severity: high, summary: ${item} drops a job }\n---\n`
  const { hold, when } = world(on, {
    [`${queue}/PLAN.md`]: { text: '---\ndoc: plan\ndish: acme-queue\nticket: acme-30\nitems:\n  - { slug: enqueue, status: todo }\n  - { slug: dequeue, status: todo }\n---\n', mtimeMs: at + 100 },
    [`${queue}/reports/enqueue-verdict.md`]: { text: verdict('enqueue'), mtimeMs: at + 101 },
    [`${queue}/reports/dequeue-verdict.md`]: { text: verdict('dequeue'), mtimeMs: at + 102 },
  })
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  const ui = await board($)
  await ui.post({ open: { kind: 'card', id: 'enqueue' } }, { in: 'stage' })
  expect(await inBox(ui, 'enqueue · Rework')).toBeDefined()

  // The click on dequeue is still reading its verdict when the tick starts rebuilding enqueue's
  // box, and the tick's read comes back last.
  const second = hold(`${queue}/reports/dequeue-verdict.md`)
  const clicking = ui.post({ open: { kind: 'card', id: 'dequeue' } }, { in: 'stage' })
  await within(second.seen, 'the click on dequeue')
  const first = hold(`${queue}/reports/enqueue-verdict.md`)
  const ticking = clock.advance(2000)
  await within(first.seen, "the tick's rebuild of enqueue")
  second.release()
  await clicking
  await until(async () => (await inBox(ui, 'dequeue · Rework')) !== undefined, "dequeue's box")
  // The tick goes on to the learnings once it is done with the box; a fresh refresh here would
  // rebuild the box from the newer click and hide what the tick wrote.
  const tickDone = when(LEARNINGS)
  first.release()
  await ticking
  await within(tickDone, 'the end of the tick')
  await settle()
  expect(await inBox(ui, 'dequeue · Rework')).toBeDefined()
  expect(await inBox(ui, 'enqueue · Rework')).toBeUndefined()

  // A close while a tick is rebuilding the box leaves it closed.
  const third = hold(`${queue}/reports/dequeue-verdict.md`)
  const again = clock.advance(2000)
  await within(third.seen, "the tick's rebuild of dequeue")
  await ui.post({ close: true }, { in: 'stage' })
  const againDone = when(LEARNINGS)
  third.release()
  await again
  await within(againDone, 'the end of the second tick')
  await settle()
  expect(await boxUp(ui)).toBe(false)
  await ui.unmount()
})
