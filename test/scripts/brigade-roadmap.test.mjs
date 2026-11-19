// Tests for scripts/brigade-roadmap, the zero-token roadmap CLI. Each test runs the real script
// against a fixture roadmap under test/scripts/fixtures/roadmap/ or a temporary copy of one that
// a test has broken or repaired on purpose. Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (scripts/brigade-roadmap). Clause ids are local to this file.
//   E1 ensures: `check [--json] [--complete] <dir>` exits 1 with one line per problem (duplicate
//      ids, dangling refs, parent and dependency cycles with their path, unready leaves naming
//      the unmet rules, split nodes with no children; with --complete also open nodes,
//      `parked_node: <id>: parked by <question>` for every `drill: parked` node, uncovered
//      inventory (a parked node and its descendants cover nothing), accepted requirements with
//      no leaf, ready leaves with no ticket, and with --board the E5 link gaps), exits 0 with
//      `roadmap OK: <n> nodes, <m> leaves ready`, and with --json prints
//      { ok, problems: [{ code, id, message }] }.
//   E2 ensures: `next [--json] <dir>` prints the frontier batch for the saved mode and focus,
//      then parked nodes with the questions that park them; `focus complete` when a dfs focus
//      has no open nodes.
//   E3 ensures: `sync <dir> --board <board_dir>` copies each published node's ticket status
//      from the board file whose frontmatter id matches into the node, reporting changes, and
//      never edits the board. Board words go back to brigade statuses through the status
//      mapping in the nearest .brigade/config.md above <dir> (`--config <path>` overrides).
//   E4 ensures: `status <dir>` prints derived status per epic and per requirement.
//   E5 ensures: `links [--json] <dir> [--board <board_dir>]` lists, for every published node,
//      each published `depends_on` prerequisite missing from the ticket's `blocked_by` on the
//      board (or from the node's own `blocked_by` with no board), and exits 1 when any is.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLI = path.join(ROOT, 'scripts', 'brigade-roadmap')
const FIXTURES = path.join(ROOT, 'test', 'scripts', 'fixtures', 'roadmap')

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter(Boolean) }
}

// Every temporary folder a test makes, removed when the file finishes.
const temps = []
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }) })
function tempDir(prefix = 'brigade-roadmap-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temps.push(dir)
  return dir
}

// A throwaway copy of a fixture roadmap, so a test can break or repair it.
function copy(name) {
  const dir = tempDir()
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true })
  return dir
}

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')

// T-2 in the valid fixture is a leaf that fails readiness on purpose; this makes it ready.
const READY_T2 = `---
doc: roadmap_node
id: T-2
level: task
parent: F-1
title: Turn off the export job
drill: leaf
satisfies: [R-1]
depends_on: [T-1]
repo: acme/api
status: in_progress
size_swag: XS
sources: [briefs/export.md]
---

## Goal

Stop the old job once the loader is live.

## Acceptance criteria

- [ ] The old job no longer runs.
`

function repaired() {
  const dir = copy('valid')
  write(dir, 'nodes/T-2.md', READY_T2)
  return dir
}

const setFrontmatter = (dir, rel, key, value) => {
  const text = read(dir, rel)
  write(dir, rel, new RegExp(`^${key}:.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`)
    : text.replace(/\n---\n/, `\n${key}: ${value}\n---\n`))
}

test('E1 check passes a sound roadmap with the node and ready-leaf counts', () => {
  const r = run('check', repaired())
  assert.equal(r.code, 0, r.out + r.err)
  assert.deepEqual(r.lines, ['roadmap OK: 10 nodes, 3 leaves ready'])
  const j = run('check', '--json', repaired())
  assert.equal(j.code, 0)
  assert.deepEqual(JSON.parse(j.out), { ok: true, problems: [] })
})

test('E1 check names every unmet readiness rule of a leaf on one line', () => {
  const r = run('check', path.join(FIXTURES, 'valid'))
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /^leaf_not_ready: T-2: /)
  for (const rule of ['criteria', 'repo', 'trace', 'size', 'brief']) assert.match(r.lines[0], new RegExp(`\\b${rule} \\(`))
  assert.doesNotMatch(r.lines[0], /\bgoal \(/, 'a rule the leaf meets is not named')
})

test('E1 check reports dangling refs and both kinds of cycle with their paths', () => {
  const r = run('check', '--json', path.join(FIXTURES, 'cycle'))
  assert.equal(r.code, 1)
  const { ok, problems } = JSON.parse(r.out)
  assert.equal(ok, false)
  for (const p of problems) assert.deepEqual(Object.keys(p), ['code', 'id', 'message'])
  const of = (code) => problems.filter((p) => p.code === code)
  assert.deepEqual(of('dangling_ref').map((p) => p.message), [
    'parent names unknown node E-9', 'depends_on names unknown node T-9',
    'satisfies names unknown requirement R-9', 'covers names unknown inventory row I-7',
  ])
  assert.deepEqual(of('parent_cycle').map((p) => [p.id, p.message]), [['F-1', 'parent cycle: F-1 -> F-2 -> F-1']])
  assert.deepEqual(of('dependency_cycle').map((p) => p.message), [
    'dependency cycle: T-1 -> T-2 -> T-1', 'dependency cycle: T-1 -> T-2 -> T-3 -> T-1',
  ])
  const text = run('check', path.join(FIXTURES, 'cycle'))
  assert.equal(text.lines.length, problems.length, 'one text line per problem')
  assert.ok(text.lines.includes('parent_cycle: F-1: parent cycle: F-1 -> F-2 -> F-1'))
})

test('E1 check reports a duplicate id and a split node with no children', () => {
  const dir = repaired()
  write(dir, 'nodes/T-9.md', read(dir, 'nodes/T-1.md'))
  setFrontmatter(dir, 'nodes/F-4.md', 'drill', 'split')
  const { problems } = JSON.parse(run('check', '--json', dir).out)
  const dup = problems.find((p) => p.code === 'duplicate_id')
  assert.ok(dup, JSON.stringify(problems))
  assert.equal(dup.id, 'T-1')
  assert.match(dup.message, /nodes\/T-1\.md.*nodes\/T-9\.md|nodes\/T-9\.md.*nodes\/T-1\.md/)
  assert.deepEqual(problems.filter((p) => p.code === 'split_no_children').map((p) => p.id), ['F-4'])
})

test('E1 check --complete also fails open nodes, coverage gaps and unpublished ready leaves', () => {
  const dir = repaired()
  assert.equal(run('check', dir).code, 0)
  const r = run('check', '--complete', dir)
  assert.equal(r.code, 1)
  assert.deepEqual(r.lines.map((l) => l.split(': ').slice(0, 2).join(' ')), [
    'open_node F-2', 'open_node F-4', 'open_node S-1', 'unpublished_leaf T-2', 'unpublished_leaf T-3',
  ])

  const orphan = copy('orphan')
  write(orphan, 'nodes/T-1.md', `---
doc: roadmap_node
id: T-1
level: task
parent: E-1
title: Loader
drill: leaf
satisfies: [R-1]
repo: acme/api
ticket: ACME-2
status: done
size_swag: S
sources: [briefs/export.md]
---

## Goal

Load orders.

## Acceptance criteria

- [x] Orders load.
`)
  assert.equal(run('check', orphan).code, 0)
  const { problems } = JSON.parse(run('check', '--json', '--complete', orphan).out)
  assert.deepEqual(problems.map((p) => [p.code, p.id]), [
    ['uncovered_inventory', 'I-2'], ['unsatisfied_requirement', 'R-2'],
  ])
})

test('E1 check --complete fails a parked branch and the inventory only it covers', () => {
  const dir = repaired()
  setFrontmatter(dir, 'nodes/F-2.md', 'drill', 'parked')
  setFrontmatter(dir, 'nodes/E-2.md', 'drill', 'parked')
  assert.equal(run('check', dir).code, 0, 'parking is fine until the roadmap claims to be complete')
  const r = run('check', '--complete', dir)
  assert.equal(r.code, 1, r.out)
  assert.ok(r.lines.includes('parked_node: F-2: parked by retention-window'), r.out)
  assert.ok(r.lines.some((l) => l.startsWith('parked_node: E-2: ')), r.out)
  // I-2 is covered by T-3 and I-4 by F-4, both under the parked E-2; I-1 is covered by live F-1.
  const { problems } = JSON.parse(run('check', '--json', '--complete', dir).out)
  assert.deepEqual(problems.filter((p) => p.code === 'uncovered_inventory').map((p) => p.id), ['I-2', 'I-4'])
  assert.deepEqual(problems.filter((p) => p.code === 'parked_node').map((p) => p.id), ['E-2', 'F-2'])

  // A single parked epic covering an inventory row no longer passes.
  const orphan = copy('orphan')
  write(orphan, 'nodes/T-1.md', `---
doc: roadmap_node
id: T-1
level: task
parent: E-1
title: Loader
drill: leaf
satisfies: [R-1, R-2]
repo: acme/api
ticket: ACME-2
status: done
size_swag: S
sources: [briefs/export.md]
---

## Goal

Load orders.

## Acceptance criteria

- [x] Orders load.
`)
  write(orphan, 'nodes/E-2.md', '---\ndoc: roadmap_node\nid: E-2\nlevel: epic\ntitle: Orders table\ndrill: parked\ncovers: [I-2]\n---\n\n## Goal\n\nLater.\n')
  const o = JSON.parse(run('check', '--json', '--complete', orphan).out)
  assert.deepEqual(o.problems.map((p) => [p.code, p.id]), [['parked_node', 'E-2'], ['uncovered_inventory', 'I-2']])
  setFrontmatter(orphan, 'nodes/E-2.md', 'drill', 'leaf')
  assert.ok(!JSON.parse(run('check', '--json', '--complete', orphan).out).problems.some((p) => p.code === 'uncovered_inventory'))
})

test('E1 check refuses a folder with no ROADMAP.md and bad arguments with exit 2', () => {
  const empty = tempDir()
  assert.equal(run('check', empty).code, 2)
  assert.equal(run('check').code, 2)
  assert.equal(run('check', '--board', 'x', empty).code, 2)
  assert.equal(run('frobnicate', empty).code, 2)
})

test('E2 next prints the bfs batch, then parked nodes with the questions that park them', () => {
  const r = run('next', path.join(FIXTURES, 'valid'))
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, [
    'batch (bfs): 1 node',
    '  F-4  Audit trail',
    'parked: 1 node',
    '  F-2  Archive raw exports — retention-window',
  ])
  const j = JSON.parse(run('next', '--json', path.join(FIXTURES, 'valid')).out)
  assert.equal(j.mode, 'bfs')
  assert.deepEqual(j.nodes, [{ id: 'F-4', title: 'Audit trail', depth: 1 }])
  assert.deepEqual(j.parked, [{ id: 'F-2', title: 'Archive raw exports', questions: ['retention-window'] }])
  assert.equal(j.focus_complete, false)
})

test('E2 next follows a dfs focus deepest first and says when the focus is complete', () => {
  const dir = copy('valid')
  setFrontmatter(dir, 'ROADMAP.md', 'mode', 'dfs')
  setFrontmatter(dir, 'ROADMAP.md', 'focus', 'E-2')
  setFrontmatter(dir, 'nodes/F-3.md', 'drill', 'parked')
  const r = run('next', dir)
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, [
    'batch (dfs, focus E-2): 2 nodes',
    '  S-1  Alert on a mismatch',
    '  F-4  Audit trail',
    'parked: 1 node',
    '  F-3  Row count checks — drill: parked',
  ])

  setFrontmatter(dir, 'nodes/S-1.md', 'drill', 'split')
  setFrontmatter(dir, 'nodes/F-4.md', 'drill', 'leaf')
  const done = run('next', dir)
  assert.equal(done.lines[0], 'focus complete: E-2')
  assert.equal(JSON.parse(run('next', '--json', dir).out).focus_complete, true)
  assert.equal(run('next', path.join(FIXTURES, 'cycle')).lines[0], 'focus complete: E-1')

  setFrontmatter(dir, 'ROADMAP.md', 'focus', 'E-7')
  const bad = run('next', dir)
  assert.equal(bad.code, 1)
  assert.match(bad.err, /unknown focus E-7/)
})

test('E3 sync copies ticket status into nodes, reports changes and never edits the board', () => {
  const dir = copy('valid')
  setFrontmatter(dir, 'nodes/T-3.md', 'ticket', 'ACME-9')
  const board = tempDir('brigade-roadmap-board-')
  // Matched by frontmatter id, not the file name.
  write(board, 'replace-export.md', '---\nid: ACME-1\ntitle: Replace the export\nstatus: in_progress   # identity\n---\n\nBody.\n')
  write(board, 'ACME-7.md', '---\nid: ACME-7\nstatus: in_review\n---\n')
  write(board, 'ACME-9.md', '---\nid: ACME-9\nstatus: done\n---\n')
  write(board, 'stray.md', '---\nid: OTHER-1\nstatus: todo\n---\n')
  const before = Object.fromEntries(fs.readdirSync(board).map((n) => [n, read(board, n)]))
  const t1 = read(dir, 'nodes/T-1.md')

  const r = run('sync', dir, '--board', board)
  assert.equal(r.code, 0, r.out + r.err)
  assert.deepEqual(r.lines, [
    'T-1: done -> in_review (ticket ACME-7)',
    'T-3: blocked -> done (ticket ACME-9)',
    'sync: 2 changed, 1 unchanged, 0 skipped',
  ])
  assert.equal(read(dir, 'nodes/T-1.md'), t1.replace('status: done', 'status: in_review'), 'only the status line changes')
  assert.match(read(dir, 'nodes/T-3.md'), /^status: done$/m)
  assert.deepEqual(Object.fromEntries(fs.readdirSync(board).map((n) => [n, read(board, n)])), before, 'board untouched')
  assert.equal(run('sync', dir, '--board', board).lines.at(-1), 'sync: 0 changed, 3 unchanged, 0 skipped')
})

test('E3 sync adds a missing status key and skips tickets it cannot match', () => {
  const dir = copy('valid')
  setFrontmatter(dir, 'nodes/F-4.md', 'ticket', 'ACME-4')
  setFrontmatter(dir, 'nodes/E-2.md', 'ticket', 'ACME-5')
  setFrontmatter(dir, 'nodes/T-3.md', 'ticket', 'ACME-6')
  const board = tempDir('brigade-roadmap-board-')
  write(board, 'ACME-4.md', '---\nstatus: todo\n---\n')
  write(board, 'ACME-5.md', '---\nid: ACME-5\nstatus: Shipped\n---\n')
  write(board, 'ACME-1.md', '---\nid: ACME-1\nstatus: in_progress\n---\n')
  write(board, 'ACME-7.md', '---\nid: ACME-7\nstatus: done\n---\n')
  const r = run('sync', dir, '--board', board)
  assert.equal(r.code, 1, 'an unmatched ticket fails the run')
  assert.ok(r.lines.includes('F-4: (none) -> todo (ticket ACME-4)'), r.out)
  assert.match(read(dir, 'nodes/F-4.md'), /^status: todo\n---$/m)
  assert.ok(r.lines.some((l) => /^skipped: E-2: ticket ACME-5 has unknown status "Shipped"/.test(l)), r.out)
  assert.ok(r.lines.includes('skipped: T-3: ticket ACME-6 is not on the board'), r.out)
  assert.doesNotMatch(read(dir, 'nodes/E-2.md'), /^status:/m)
  assert.equal(run('sync', dir).code, 2, '--board is required')
  assert.equal(run('sync', dir, '--board', path.join(board, 'missing')).code, 2)
})

test('E3 sync maps board words back through the status mapping in .brigade/config.md', () => {
  const root = tempDir('brigade-roadmap-repo-')
  const dir = path.join(root, '.brigade', 'roadmaps', 'orders')
  fs.cpSync(path.join(FIXTURES, 'valid'), dir, { recursive: true })
  setFrontmatter(dir, 'nodes/T-3.md', 'ticket', 'ACME-9')
  // The template's shape: the mapping under its own heading, comments, a board with no rework
  // column mapping rework onto the in_progress word, and merging left commented out.
  write(root, '.brigade/config.md', `# Brigade config — acme

## Source

- source: local
- done: not-a-mapping-line   # outside the mapping section, ignored

### Status mapping (abstract → native)

- backlog: backlog
- todo: todo
- rework: building           # this board has no rework column
- in_progress: building
- in_review: review
# - merging: merging
- done: shipped
- blocked: blocked

## Repo

- main_branch: main
`)
  const board = tempDir('brigade-roadmap-board-')
  write(board, 'ACME-1.md', '---\nid: ACME-1\nstatus: building\n---\n')
  write(board, 'ACME-7.md', '---\nid: ACME-7\nstatus: review\n---\n')
  write(board, 'ACME-9.md', '---\nid: ACME-9\nstatus: shipped\n---\n')
  const r = run('sync', dir, '--board', board)
  assert.equal(r.code, 0, r.out + r.err)
  assert.deepEqual(r.lines, [
    'T-1: done -> in_review (ticket ACME-7)',
    'T-3: blocked -> done (ticket ACME-9)',
    'sync: 2 changed, 1 unchanged, 0 skipped',
  ])
  assert.match(read(dir, 'nodes/T-3.md'), /^status: done$/m, 'the node gets the brigade word, not the board word')

  // A brigade word the config renamed is not a board word any more.
  write(board, 'ACME-9.md', '---\nid: ACME-9\nstatus: done\n---\n')
  const stale = run('sync', dir, '--board', board)
  assert.equal(stale.code, 1)
  assert.ok(stale.lines.some((l) => /^skipped: T-3: ticket ACME-9 has unknown status "done"/.test(l)), stale.out)

  // --config wins over the folder's own config; a missing one is an I/O error.
  const other = path.join(tempDir(), 'config.md')
  write(path.dirname(other), 'config.md', '## Source\n\n### Status mapping\n\n- done: done\n')
  write(board, 'ACME-1.md', '---\nid: ACME-1\nstatus: in_progress\n---\n')
  write(board, 'ACME-7.md', '---\nid: ACME-7\nstatus: done\n---\n')
  const o = run('sync', dir, '--board', board, '--config', other)
  assert.equal(o.code, 0, o.out + o.err)
  assert.deepEqual(o.lines, ['T-1: in_review -> done (ticket ACME-7)', 'sync: 1 changed, 2 unchanged, 0 skipped'])
  assert.equal(run('sync', dir, '--board', board, '--config', path.join(root, 'nope.md')).code, 2)
  assert.equal(run('sync', dir, '--board', board, '--config').code, 2)
})

test('E4 status prints derived status per epic and per requirement', () => {
  const r = run('status', path.join(FIXTURES, 'valid'))
  assert.equal(r.code, 0, r.err)
  const rows = r.lines.map((l) => l.trim().split(/\s+/).slice(0, 3))
  assert.deepEqual(rows.slice(0, 3), [['epics:'], ['E-1', 'in_progress', 'Replace'], ['E-2', 'blocked', 'Prove']])
  assert.deepEqual(rows.slice(3), [
    ['requirements:'], ['R-1', 'met', 'accepted'], ['R-2', 'unmet', 'accepted'], ['R-3', 'unmet', 'proposed'], ['R-4', 'unmet', 'dropped'],
  ])

  const dir = copy('valid')
  setFrontmatter(dir, 'nodes/T-2.md', 'status', 'done')
  setFrontmatter(dir, 'nodes/F-2.md', 'status', 'done')
  setFrontmatter(dir, 'nodes/T-3.md', 'status', 'done')
  const after = run('status', dir).lines.map((l) => l.trim().split(/\s+/).slice(0, 2).join(' '))
  assert.ok(after.includes('E-1 done'), after.join('\n'))
  assert.ok(after.includes('R-2 met'), after.join('\n'))
})

// T-2 and T-3 both depend on T-1 (ticket ACME-7); this publishes them as ACME-8 and ACME-9.
function published() {
  const dir = repaired()
  setFrontmatter(dir, 'nodes/T-2.md', 'ticket', 'ACME-8')
  setFrontmatter(dir, 'nodes/T-3.md', 'ticket', 'ACME-9')
  return dir
}

test('E5 links lists published prerequisites missing from blocked_by, from the node records', () => {
  const dir = published()
  const r = run('links', dir)
  assert.equal(r.code, 1, r.out + r.err)
  assert.deepEqual(r.lines, [
    'missing_blocked_by: T-2: ticket ACME-8 is not blocked_by ACME-7 (T-1)',
    'missing_blocked_by: T-3: ticket ACME-9 is not blocked_by ACME-7 (T-1)',
  ])
  setFrontmatter(dir, 'nodes/T-2.md', 'blocked_by', '[ACME-7]')
  const j = run('links', '--json', dir)
  assert.equal(j.code, 1)
  assert.deepEqual(JSON.parse(j.out), {
    ok: false,
    checked: 4,
    missing: [{ node: 'T-3', ticket: 'ACME-9', depends_on: 'T-1', depends_on_ticket: 'ACME-7' }],
    unchecked: [],
  })
  setFrontmatter(dir, 'nodes/T-3.md', 'blocked_by', '[ACME-7]')
  assert.deepEqual(run('links', dir).lines, ['links OK: 4 published nodes checked'])

  // An unpublished prerequisite has no ticket to link yet, so it is not a gap.
  const early = published()
  setFrontmatter(early, 'nodes/T-1.md', 'ticket', '')
  const e = run('links', early)
  assert.equal(e.code, 0, e.out)
  assert.deepEqual(e.lines, ['links OK: 3 published nodes checked'])
})

test('E5 links reads blocked_by from the markdown board, and check --complete --board runs it', () => {
  const dir = published()
  const board = tempDir('brigade-roadmap-board-')
  write(board, 'ACME-1.md', '---\nid: ACME-1\nstatus: in_progress\n---\n')
  write(board, 'ACME-7.md', '---\nid: ACME-7\nstatus: done\n---\n')
  write(board, 'ACME-8.md', '---\nid: ACME-8\nstatus: todo\nblocked_by: [ACME-7]   # loader first\n---\n')
  write(board, 'ACME-9.md', '---\nid: ACME-9\nstatus: todo\nblocked_by: []\n---\n')
  const before = Object.fromEntries(fs.readdirSync(board).map((n) => [n, read(board, n)]))
  // The node record says linked, the board does not: the board wins.
  setFrontmatter(dir, 'nodes/T-3.md', 'blocked_by', '[ACME-7]')
  const r = run('links', dir, '--board', board)
  assert.equal(r.code, 1, r.out + r.err)
  assert.deepEqual(r.lines, ['missing_blocked_by: T-3: ticket ACME-9 is not blocked_by ACME-7 (T-1)'])

  const c = JSON.parse(run('check', '--json', '--complete', '--board', board, dir).out)
  assert.deepEqual(c.problems.filter((p) => p.code === 'missing_blocked_by').map((p) => [p.id, p.message]), [
    ['T-3', 'ticket ACME-9 is not blocked_by ACME-7 (T-1)'],
  ])
  assert.ok(!JSON.parse(run('check', '--json', '--complete', dir).out).problems.some((p) => p.code === 'missing_blocked_by'), 'no --board, no links check')
  assert.equal(run('check', '--board', board, dir).code, 2, '--board belongs with --complete')

  write(board, 'ACME-9.md', '---\nid: ACME-9\nstatus: todo\nblocked_by:\n  - "ACME-7"\n---\n')
  assert.deepEqual(run('links', dir, '--board', board).lines, ['links OK: 4 published nodes checked'])
  assert.ok(!JSON.parse(run('check', '--json', '--complete', '--board', board, dir).out).problems.some((p) => p.code === 'missing_blocked_by'))

  fs.rmSync(path.join(board, 'ACME-8.md'))
  const gone = run('links', dir, '--board', board)
  assert.equal(gone.code, 1)
  assert.deepEqual(gone.lines, ['skipped: T-2: ticket ACME-8 is not on the board'])
  delete before['ACME-8.md']
  before['ACME-9.md'] = read(board, 'ACME-9.md')
  assert.deepEqual(Object.fromEntries(fs.readdirSync(board).map((n) => [n, read(board, n)])), before, 'board untouched')
  assert.equal(run('links', path.join(board, 'missing')).code, 2)
})
