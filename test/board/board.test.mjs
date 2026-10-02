import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANES, boardDirFrom, parseTicket, laneOf, toLanes } from '../../hooks/board/lib/board.mjs'

const config = [
  '# Brigade config',
  '',
  '- source: obsidian          # notion | clickup | local | obsidian — matches a file in sources/',
  '- database_id: /path/to/vault/tickets/acme/web   # board_dir',
  '',
].join('\n')

const ticket = [
  '---',
  'id: welcome',
  'title: "Guard: a pathspec from a substitution # evades the check"',
  'status: in_progress',
  'assignee: alex',
  'kind: bug',
  'worker: ""',
  '---',
  '',
  '## Goal',
  '',
].join('\n')

test('boardDirFrom returns the board folder without its comment', () => {
  assert.equal(boardDirFrom(config), '/path/to/vault/tickets/acme/web')
})

test('boardDirFrom accepts the local source too', () => {
  assert.equal(boardDirFrom(config.replace('source: obsidian', 'source: local')), '/path/to/vault/tickets/acme/web')
})

test('boardDirFrom is null for a source that is not obsidian or local', () => {
  assert.equal(boardDirFrom(config.replace('source: obsidian', 'source: notion')), null)
})

test('boardDirFrom is null with no database_id line', () => {
  assert.equal(boardDirFrom('- source: obsidian\n- verify: ./test.sh\n'), null)
})

test('boardDirFrom is null when the database_id value is empty', () => {
  assert.equal(boardDirFrom('- source: obsidian\n- database_id:    # nothing yet\n'), null)
})

test('parseTicket keeps a quoted title whole, colon and hash included', () => {
  assert.deepEqual(parseTicket(ticket, 'welcome.md'), {
    id: 'welcome',
    title: 'Guard: a pathspec from a substitution # evades the check',
    status: 'in_progress',
    kind: 'bug',
    assignee: 'alex',
    worker: '',
  })
})

test('parseTicket drops a trailing comment from an unquoted value only', () => {
  const t = parseTicket('---\nid: acme\nstatus: todo   # moved today\ntitle: \'it\'\'s # fine\'\n---\n', 'acme.md')
  assert.equal(t.status, 'todo')
  assert.equal(t.title, "it's # fine")
})

test('parseTicket ignores indented and body lines', () => {
  const t = parseTicket('---\nid: acme\nmeta:\n  status: done\n---\nstatus: blocked\n', 'acme.md')
  assert.equal(t.status, '')
})

test('parseTicket skips underscore files', () => {
  assert.equal(parseTicket(ticket, '_board.md'), null)
})

test('parseTicket skips files that are not markdown', () => {
  assert.equal(parseTicket(ticket, 'welcome.txt'), null)
})

test('parseTicket is null for text without frontmatter', () => {
  assert.equal(parseTicket('# Just a note\n\nid: welcome\n', 'note.md'), null)
  assert.equal(parseTicket('---\nid: welcome\nno closing line\n', 'note.md'), null)
})

test('parseTicket falls back to the file name for id, and to id for title', () => {
  const t = parseTicket('---\nstatus: todo\n---\n', 'fix-login.md')
  assert.equal(t.id, 'fix-login')
  assert.equal(t.title, 'fix-login')
  assert.equal(t.kind, '')
})

test('laneOf maps statuses to lanes, unknown ones to backlog', () => {
  assert.equal(laneOf('scoping'), 'backlog')
  assert.equal(laneOf('weird'), 'backlog')
  assert.equal(laneOf(''), 'backlog')
  assert.equal(laneOf('in_review'), 'in_review')
})

const nine = [
  { id: 'a-todo', status: 'todo' },
  ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'].reverse().map((id) => ({ id, status: 'done' })),
]

test('toLanes returns all six lanes and caps each lane', () => {
  const lanes = toLanes(nine)
  assert.deepEqual(lanes.map((l) => l.key), LANES.map((l) => l.key))
  const done = lanes.find((l) => l.key === 'done')
  assert.equal(done.total, 8)
  assert.deepEqual(done.tickets.map((t) => t.id), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
  assert.equal(lanes.find((l) => l.key === 'todo').total, 1)
  assert.equal(lanes.find((l) => l.key === 'blocked').total, 0)
  assert.deepEqual(lanes.find((l) => l.key === 'blocked').tickets, [])
})

test('toLanes puts a pinned ticket first even when it sorts last', () => {
  const done = toLanes(nine, 6, ['d8']).find((l) => l.key === 'done')
  assert.equal(done.total, 8)
  assert.equal(done.tickets.length, 6)
  assert.deepEqual(done.tickets.map((t) => t.id), ['d8', 'd1', 'd2', 'd3', 'd4', 'd5'])
})

test('toLanes shows every pinned ticket even past the cap', () => {
  const done = toLanes(nine, 2, ['d7', 'd5', 'd8']).find((l) => l.key === 'done')
  assert.deepEqual(done.tickets.map((t) => t.id), ['d5', 'd7', 'd8'])
})
