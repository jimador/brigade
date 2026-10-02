import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 'Brigade board', isFocused: false, bodyColumns: 124, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const OPEN = { command: 'brigade-board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 124 } } as const
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
const CONFIG = '/repo/.brigade/config.md'
const TITLES = ['To do', 'Cooking', 'In review', 'Rework', 'Done']

type On = Parameters<Parameters<typeof test>[1]>[1]
type Ui = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>
type Listing = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }

// Stands in for the engine beneath the plugin and for a project on disk. `files` maps a path to
// its text and mtime; folders are implied by the paths. Tests change `files` as they go, and each
// test uses its own mtimes so the board's file caches, which live for the whole module, never
// hand one test another's files. Every path the board lists or reads is written down in `touched`.
function world(on: On, files: Record<string, { text: string; mtimeMs: number }>) {
  const touched: string[] = []
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
    touched.push(e.path)
    if (!(e.path in files)) throw new Error(`no such file: ${e.path}`)
    return { value: files[e.path].text }
  })
  on('fs.list', async ($$, e) => {
    touched.push(e.path)
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
  on('session.usage', async () => ({ value: { startedAt: 0, context: { tokens: 58000, window: 100000, percent: 58 }, rateLimits: [] } }))
  on('command.register', async () => ({ value: {} }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  return { touched }
}

const ticket = (id: string, status: string) => `---\nid: ${id}\ntitle: Ticket ${id}\nstatus: ${status}\n---\n`

async function open($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ plugin: 'brigade', surface: 'terminal', component: 'Pane', requestId: 'brigade-board', props: PANE, viewport: { columns: 124, rows: 40 } })
  await ui.resize({ columns: 124, rows: 40, in: 'stage' })
  return ui
}

// The rows the stage draws, as plain text.
async function rowsOf(ui: Ui) {
  return (await ui.findAll({ type: 'Text', in: 'stage' })).filter(t => t.children.some(c => typeof c === 'object')).map(t => t.text)
}

// Which lane the card with this id sits in, read off the drawing: the lane whose title starts at
// or before the card's left border on the lane header row. Null when no card shows the id.
async function laneOfCard(ui: Ui, id: string) {
  const rows = await rowsOf(ui)
  const head = rows.find(row => TITLES.every(title => row.includes(title)))
  const row = rows.find(row => row.includes(`│${id} `))
  if (head === undefined || row === undefined) return null
  const x = row.indexOf(`│${id} `)
  let lane: string | null = null
  for (const title of TITLES) if (head.indexOf(title) <= x) lane = title
  return lane
}

test('with no dish being worked the lanes hold the board tickets, and the meter reads the context', async ($, on) => {
  mock.clock(on)
  world(on, {
    [CONFIG]: { text: '- source: local\n- database_id: ./board\n', mtimeMs: 100 },
    '/repo/board/ta.md': { text: ticket('ta', 'todo'), mtimeMs: 101 },
    '/repo/board/tb.md': { text: ticket('tb', 'in_progress'), mtimeMs: 102 },
    '/repo/board/_board.md': { text: ticket('ignored', 'todo'), mtimeMs: 103 },
  })
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: /^Ticket board/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /To do 1 +Cooking 1 +In review 0/, in: 'stage' })).toBeDefined()
  expect(await laneOfCard(ui, 'ta')).toBe('To do')
  expect(await laneOfCard(ui, 'tb')).toBe('Cooking')
  expect(await laneOfCard(ui, 'ignored')).toBeNull()
  expect(await ui.find({ type: 'Text', text: /Context 58%/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SHOWERS/, in: 'stage' })).toBeUndefined()
  await ui.unmount()
})

test('a status edit on disk shows after the next tick without reopening the pane', async ($, on) => {
  const clock = mock.clock(on)
  const files = {
    [CONFIG]: { text: '- source: local\n- database_id: board\n', mtimeMs: 200 },
    '/repo/board/sa.md': { text: ticket('sa', 'todo'), mtimeMs: 201 },
    '/repo/board/sb.md': { text: ticket('sb', 'in_progress'), mtimeMs: 202 },
  } as Record<string, { text: string; mtimeMs: number }>
  world(on, files)
  // The timer starts in session.start. The test kit has nothing beneath the plugin to answer
  // that event, so the raise ends there, after the board's own hook has run.
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  const ui = await open($)
  expect(await laneOfCard(ui, 'sa')).toBe('To do')
  files['/repo/board/sa.md'] = { text: ticket('sa', 'done'), mtimeMs: 211 }
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'sa')).toBe('Done')
  expect(await ui.find({ type: 'Text', text: /To do 0/, in: 'stage' })).toBeDefined()
  // A ticket file that vanishes drops out of its lane on the next tick too.
  delete files['/repo/board/sb.md']
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'sb')).toBeNull()
  expect(await ui.find({ type: 'Text', text: /Cooking 0/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('a repo without .brigade/config.md still draws the board and throws nothing', async ($, on) => {
  const clock = mock.clock(on)
  world(on, {})
  const ui = await open($)
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /To do 0/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

const DISH = '/repo/.brigade/dishes/acme-limits'
const PLAN = [
  '---',
  'doc: plan',
  'dish: acme-limits',
  'ticket: acme-12',
  'delivery_branch: feat/limits',
  'tier: two-star',
  'kind: feature',
  'items:',
  '  - { slug: token-bucket, status: todo, files: [src/bucket.ts] }',
  '  - { slug: usage-docs, status: todo }',
  '---',
  '## Packet: token-bucket',
  '### Goal',
  'Add a token bucket per key.',
  '## Packet: usage-docs',
  '### Goal',
  'Document the limits.',
  '',
].join('\n')
const REPORT = '---\ndoc: report\ndish: acme-limits\nitem: token-bucket\nrole: cook\nstatus: done\nattempt: 1\n---\n## Summary\n'
const VERDICT = '---\ndoc: verdict\ndish: acme-limits\nitem: token-bucket\nrole: inspector\nverdict: FAIL\nfindings:\n  - { id: F1, severity: high, summary: Refill uses wall-clock time }\n---\n'

test('a work item moves To do, Cooking, In review, Rework as events and files arrive, a tick each', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const files: Record<string, { text: string; mtimeMs: number }> = { [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: at } }
  world(on, files)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: /^repo · feat\/limits/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^acme-12 · feature · 0 of 2 done · two-star/, in: 'stage' })).toBeDefined()
  expect(await laneOfCard(ui, 'token-bucket')).toBe('To do')
  expect(await laneOfCard(ui, 'usage-docs')).toBe('To do')

  // A cook reads its packet, then edits a file in the item's worktree.
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'c1' })) void chunk
  await $.tool.call({ agentId: 'c1', tool: 'Read', file_path: `${DISH}/packets/token-bucket.md` } as never)
  await $.tool.call({ agentId: 'c1', tool: 'Edit', file_path: '/repo/.brigade/worktrees/limits--token-bucket/src/bucket.ts' } as never)
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'token-bucket')).toBe('Cooking')
  expect(await laneOfCard(ui, 'usage-docs')).toBe('To do')
  expect(await ui.find({ type: 'Text', text: /│♨ Basil · cook +│/, in: 'stage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /│editing bucket\.ts +│/, in: 'stage' })).toBeDefined()

  // The cook finishes and its report lands: the item waits for review.
  await $.turn.complete({ agentId: 'c1', answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  files[`${DISH}/reports/token-bucket-cook.md`] = { text: REPORT, mtimeMs: at + 10 }
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'token-bucket')).toBe('In review')

  // The inspector fails it: the item goes to Rework with the reason on its pill.
  files[`${DISH}/reports/token-bucket-verdict.md`] = { text: VERDICT, mtimeMs: at + 20 }
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'token-bucket')).toBe('Rework')
  expect(await ui.find({ type: 'Text', text: /sent back · 1 finding/, in: 'stage' })).toBeDefined()
  await ui.unmount()
})

test('a dish with a plan days old still reads its notes while an agent works it, and only then', async ($, on) => {
  const clock = mock.clock(on)
  const at = await clock.now()
  const old = at - 3 * 24 * 60 * 60 * 1000
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${DISH}/PLAN.md`]: { text: PLAN, mtimeMs: old },
    [`${DISH}/briefs/limits.md`]: { text: '---\ndoc: brief\ndish: acme-limits\nquestion: Which clock is steady?\n---\n', mtimeMs: old + 1 },
  }
  const { touched } = world(on, files)
  await $.session.start({ cwd: '/repo' }).catch(err => expect(String(err)).toMatch(/no implementation for session\.start/))
  const ui = await open($)
  // Nobody is working the dish, so its notes stay unread, tick after tick.
  await clock.advance(2000)
  expect(touched.filter(path => path.startsWith(`${DISH}/briefs`))).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Ticket board/, in: 'stage' })).toBeDefined()

  // Two cooks pick up the dish's items.
  for (const [id, item, file] of [['q1', 'token-bucket', 'src/bucket.ts'], ['q2', 'usage-docs', 'docs/limits.md']]) {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: id })) void chunk
    await $.tool.call({ agentId: id, tool: 'Read', file_path: `${DISH}/packets/${item}.md` } as never)
    await $.tool.call({ agentId: id, tool: 'Edit', file_path: `/repo/.brigade/worktrees/limits--${item}/${file}` } as never)
  }
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'token-bucket')).toBe('Cooking')

  // One finishes and its report lands while the other is still at work.
  await $.turn.complete({ agentId: 'q1', answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  files[`${DISH}/reports/token-bucket-cook.md`] = { text: REPORT, mtimeMs: at + 50 }
  await clock.advance(2000)
  expect(await laneOfCard(ui, 'token-bucket')).toBe('In review')
  await ui.unmount()
})
