// Tests for the three roadmap artifacts the validator knows: `roadmap` (ROADMAP.md),
// `roadmap_node` (nodes/<id>.md) and `roadmap_batch` (batches/<n>.md).
//
//   E1  a roadmap needs dish, mode, focus, max_depth and next_ids; mode is bfs|dfs; focus is
//       required under dfs; next_ids is a list with one next id per level letter; its nine
//       sections come in order; the Systems access column and the Requirements kind and status
//       columns are enum-checked.
//   E2  a node needs only id, level, title and drill, plus parent below an epic and repo on a
//       leaf; ids are E-/F-/S-/T- plus a counter of any length; any other key may be left out,
//       and a key that is written is still checked; its sections depend on whether it is a leaf;
//       budget 60 lines.
//   E3  a batch's state, each operation's op and target, the receipts list and its two sections.
//   E4  a roadmap directory argument, and the default sweep of .brigade/roadmaps/*/, validate
//       ROADMAP.md, nodes/, batches/ and briefs/.
//   I1  the example block for each type in SCHEMAS.md validates with no problem and no warning.
//   I2  every file in the library's valid fixture roadmap validates with no problem and no warning.
//
// Each test writes throwaway files and runs the real validator on them.
// Run with `node --test test/scripts/*.test.mjs`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VALIDATE = path.join(ROOT, 'scripts', 'brigade-validate')
const SCHEMAS_MD = fs.readFileSync(path.join(ROOT, 'skills', 'brigade', 'SCHEMAS.md'), 'utf8')

const scratch = []
after(() => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }) })
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-roadmap-'))
  scratch.push(dir)
  return dir
}

const ENVELOPE = 'schema: 1\ndish: warehouse-migration\nrole: planner\nmodel: opus\ncreated: 2026-07-04T03:10:00Z'

const ROADMAP_FM = `doc: roadmap
${ENVELOPE}
mode: bfs
focus: ""
max_depth: 4
next_ids: [E-2, F-1, S-1, T-1]`

const ROADMAP_BODY = `## Intent
Move the nightly jobs to the new warehouse.

## Original request
Move everything off the old warehouse.

## Systems
| id | kind | locator | command | access |
|---|---|---|---|---|
| SYS-1 | warehouse | old-wh | \`list-tables --schema sales \\| head\` | ok |
| SYS-2 | object storage | exports | \`list-objects exports/\` | missing |

## Inventory
| id | system | thing | evidence | covered by | excluded by |
|---|---|---|---|---|---|
| I-001 | SYS-1 | sales.orders | briefs/1-sales.md | T-001 | |

## Requirements
| id | kind | statement | source | status |
|---|---|---|---|---|
| R-001 | parity | Row counts match | operator | accepted |
| R-002 | risk | Exports keep their names | briefs/1-sales.md | proposed |

## Decisions
- **order**: bfs first.

## Open questions

## Out of scope
- Dashboards.

## Batches
- 1: epics, applied.
`

const LEAF_FM = `doc: roadmap_node
${ENVELOPE}
id: T-001
level: task
parent: S-001
title: Copy the orders table
drill: leaf
satisfies: [R-001]
covers: [I-001]
depends_on: []
repo: /path/to/repo
ticket: ""
status: ""
size_swag: S
sources:
  - briefs/1-sales.md`

const LEAF_BODY = `## Goal
Orders land in the new warehouse every night.

## Context
Roadmap: warehouse-migration/T-001

## Acceptance criteria
- [ ] Row counts match the old table.

## Constraints
None.

## Out of scope
Dashboards.
`

const EPIC_FM = `doc: roadmap_node
${ENVELOPE}
id: E-001
level: epic
parent: ""
title: Sales data
drill: split
satisfies: [R-001]
covers: []
depends_on: []
ticket: ACME-1
status: backlog
size_swag: unknown
sources: []`

const EPIC_BODY = `## Goal
All sales data moves.

## Children
- F-001
`

const BATCH_FM = `doc: roadmap_batch
${ENVELOPE}
state: approved
operations:
  - { op: create_node, target: T-001 }
  - { op: publish, target: T-001 }
receipts: []`

const BATCH_BODY = `## Proposal
Add one task and publish it.

## Dispositions
Operator: yes.
`

const doc = (fm, body) => `---\n${fm}\n---\n${body}`

function run(...args) {
  const r = spawnSync(process.execPath, [VALIDATE, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
  return { status: r.status, out: r.stdout + r.stderr }
}

// Writes one file and validates it; returns the validator's output and exit code.
function check(text, name = 'artifact.md') {
  const file = path.join(tempDir(), name)
  fs.writeFileSync(file, text)
  return run(file)
}

function assertClean(text, label) {
  const { status, out } = check(text)
  assert.equal(status, 0, `${label} failed:\n${out}`)
  assert.doesNotMatch(out, /^(FAIL|warn)/m, `${label} drew a problem or warning:\n${out}`)
}

function assertFails(text, want) {
  const { status, out } = check(text)
  assert.equal(status, 1, `expected a failure naming ${want}:\n${out}`)
  assert.ok(out.includes(want), `expected "${want}" in:\n${out}`)
}

// --- E1 roadmap ---------------------------------------------------------------

test('E1: a valid roadmap passes', () => assertClean(doc(ROADMAP_FM, ROADMAP_BODY), 'roadmap'))

test('E1: each required roadmap key is required', () => {
  for (const key of ['dish', 'mode', 'focus', 'max_depth', 'next_ids']) {
    const fm = ROADMAP_FM.split('\n').filter((l) => !l.startsWith(`${key}:`)).join('\n')
    assertFails(doc(fm, ROADMAP_BODY), `missing roadmap key: ${key}`)
  }
})

test('E1: mode, focus, max_depth and next_ids are checked', () => {
  assertFails(doc(ROADMAP_FM.replace('mode: bfs', 'mode: random'), ROADMAP_BODY), 'invalid roadmap mode: random (allowed: bfs|dfs)')
  assertFails(doc(ROADMAP_FM.replace('mode: bfs', 'mode: dfs'), ROADMAP_BODY), 'roadmap focus is required when mode is dfs')
  assertClean(doc(ROADMAP_FM.replace('mode: bfs', 'mode: dfs').replace('focus: ""', 'focus: E-001'), ROADMAP_BODY), 'dfs roadmap')
  assertFails(doc(ROADMAP_FM.replace('focus: ""', 'focus: sales'), ROADMAP_BODY), 'roadmap focus must be a node id')
  assertFails(doc(ROADMAP_FM.replace('max_depth: 4', 'max_depth: deep'), ROADMAP_BODY), 'roadmap max_depth must be a whole number')
  assertClean(doc(ROADMAP_FM.replace('focus: ""', 'focus: E-12'), ROADMAP_BODY), 'focus with a short id')
})

test('E1: next_ids is a list with one next id per level letter', () => {
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids: [E-3, F-5, S-2, T-4]'), ROADMAP_BODY), 'flow list')
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - E-3\n  - T-12'), ROADMAP_BODY), 'block list')
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids: []'), ROADMAP_BODY), 'empty list')
  for (const bad of ['{ E: 2, F: 1, S: 1, T: 1 }', '[1, 2]', '[E-2, E-3]', '[X-2]', 'E-2', '[E-2, F-1']) {
    assertFails(doc(ROADMAP_FM.replace(/next_ids: .*/, `next_ids: ${bad}`), ROADMAP_BODY), 'roadmap next_ids must be a list')
  }
})

test('E1: a block-list next_ids entry may end in a comment', () => {
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - E-4 # next epic\n  - T-12'), ROADMAP_BODY), 'block list with comment')
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - "E-4" # next epic\n  - \'T-12\''), ROADMAP_BODY), 'quoted block list with comment')
  assertClean(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - "E-4"\n  - T-12'), ROADMAP_BODY), 'quoted block list')
  assertFails(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - E-x # c\n  - T-12'), ROADMAP_BODY), 'roadmap next_ids must be a list')
  assertFails(doc(ROADMAP_FM.replace(/next_ids: .*/, 'next_ids:\n  - "E-4 # c"\n  - T-12'), ROADMAP_BODY), 'roadmap next_ids must be a list')
})

test('E1: roadmap sections must all be there, in order', () => {
  assertFails(doc(ROADMAP_FM, ROADMAP_BODY.replace('## Batches', '## Log')), 'roadmap missing "## Batches" section')
  const swapped = ROADMAP_BODY.replace('## Intent', '## TMP').replace('## Decisions', '## Intent').replace('## TMP', '## Decisions')
  assertFails(doc(ROADMAP_FM, swapped), 'roadmap sections out of order')
})

test('E1: Systems access and Requirements kind and status are enum-checked', () => {
  assertFails(doc(ROADMAP_FM, ROADMAP_BODY.replace('| ok |', '| maybe |')),
    'roadmap Systems row SYS-1: invalid access "maybe" (allowed: ok|missing)')
  assertFails(doc(ROADMAP_FM, ROADMAP_BODY.replace('| parity |', '| vibes |')),
    'roadmap Requirements row R-001: invalid kind "vibes" (allowed: functional|inventory|parity|risk|constraint)')
  assertFails(doc(ROADMAP_FM, ROADMAP_BODY.replace('| accepted |', '| done |')),
    'roadmap Requirements row R-001: invalid status "done" (allowed: proposed|accepted|dropped)')
  assertFails(doc(ROADMAP_FM, ROADMAP_BODY.replace('| id | kind | statement | source | status |', '| id | kind | statement | source | state |')),
    'roadmap Requirements table has no "status" column')
})

test('E1: a pipe escaped inside a Systems command does not shift the access column', () => {
  assert.ok(ROADMAP_BODY.includes('\\|'))
  assertClean(doc(ROADMAP_FM, ROADMAP_BODY), 'roadmap with an escaped pipe')
})

// --- E2 roadmap_node ------------------------------------------------------------

test('E2: a valid leaf and a valid epic pass', () => {
  assertClean(doc(LEAF_FM, LEAF_BODY), 'leaf')
  assertClean(doc(EPIC_FM, EPIC_BODY), 'epic')
})

const without = (fm, keys) => fm.split('\n')
  .filter((l) => !keys.some((k) => l.startsWith(`${k}:`)) && !(keys.includes('sources') && l.startsWith('  - ')))
  .join('\n')

test('E2: id, level, title and drill are required, and parent below an epic', () => {
  for (const key of ['id', 'level', 'parent', 'title', 'drill']) {
    assertFails(doc(without(LEAF_FM, [key]), LEAF_BODY), `missing roadmap_node key: ${key}`)
  }
  assertClean(doc(without(EPIC_FM, ['parent']), EPIC_BODY), 'epic with no parent key')
})

test('E2: every other node key may be left out', () => {
  const optional = ['satisfies', 'covers', 'depends_on', 'ticket', 'status', 'size_swag', 'sources']
  assertClean(doc(without(LEAF_FM, optional), LEAF_BODY), 'bare leaf')
  assertClean(doc(without(EPIC_FM, ['parent', ...optional]), EPIC_BODY), 'bare epic')
})

test('E2: id, level, parent and drill are checked', () => {
  assertClean(doc(LEAF_FM.replace('id: T-001', 'id: T-1').replace('parent: S-001', 'parent: S-1'), LEAF_BODY), 'short ids')
  assertClean(doc(LEAF_FM.replace('id: T-001', 'id: T-12345'), LEAF_BODY), 'long id')
  assertFails(doc(LEAF_FM.replace('id: T-001', 'id: X-001'), LEAF_BODY), 'roadmap_node id must match')
  assertFails(doc(LEAF_FM.replace('id: T-001', 'id: T-'), LEAF_BODY), 'roadmap_node id must match')
  assertFails(doc(LEAF_FM.replace('id: T-001', 'id: T-1a'), LEAF_BODY), 'roadmap_node id must match')
  assertFails(doc(LEAF_FM.replace('level: task', 'level: chore'), LEAF_BODY), 'invalid roadmap_node level: chore')
  assertFails(doc(LEAF_FM.replace('level: task', 'level: story'), LEAF_BODY), 'roadmap_node level story does not match id T-001 (expected task)')
  assertFails(doc(LEAF_FM.replace('parent: S-001', 'parent: ""'), LEAF_BODY), 'roadmap_node task needs a parent')
  assertFails(doc(EPIC_FM.replace('parent: ""', 'parent: E-002'), EPIC_BODY), 'roadmap_node epic must have an empty parent')
  assertFails(doc(LEAF_FM.replace('parent: S-001', 'parent: sales'), LEAF_BODY), 'roadmap_node parent must be a node id')
  assertFails(doc(LEAF_FM.replace('drill: leaf', 'drill: done'), LEAF_BODY), 'invalid roadmap_node drill: done')
})

test('E2: list keys must be lists', () => {
  for (const key of ['satisfies', 'covers', 'depends_on']) {
    assertFails(doc(LEAF_FM.replace(new RegExp(`${key}: .*`), `${key}: R-001`), LEAF_BODY), `roadmap_node ${key} must be a list`)
  }
  assertFails(doc(LEAF_FM.replace('sources:\n  - briefs/1-sales.md', 'sources:'), LEAF_BODY), 'roadmap_node sources must be a list')
})

test('E2: a leaf needs a repo, a branch node does not', () => {
  assertFails(doc(LEAF_FM.replace('repo: /path/to/repo\n', ''), LEAF_BODY), 'roadmap_node leaf needs a repo')
  assertFails(doc(LEAF_FM.replace('repo: /path/to/repo', 'repo: ""'), LEAF_BODY), 'roadmap_node leaf needs a repo')
  assertClean(doc(EPIC_FM, EPIC_BODY), 'epic without a repo')
})

test('E2: status uses the ticket vocabulary or is empty; size_swag is enum-checked', () => {
  assertClean(doc(LEAF_FM.replace('status: ""', 'status: in_review'), LEAF_BODY), 'leaf with status')
  assertFails(doc(LEAF_FM.replace('status: ""', 'status: shipped'), LEAF_BODY), 'invalid roadmap_node status: shipped')
  assertFails(doc(LEAF_FM.replace('size_swag: S', 'size_swag: huge'), LEAF_BODY), 'invalid roadmap_node size_swag: huge')
})

test('E2: body sections follow the drill state', () => {
  assertFails(doc(LEAF_FM, EPIC_BODY), 'roadmap_node leaf missing "## Acceptance criteria" section')
  assertFails(doc(EPIC_FM, LEAF_BODY), 'roadmap_node missing "## Children" section')
  assertFails(doc(EPIC_FM, '## Children\n- F-001\n\n## Goal\nx\n'), 'roadmap_node sections out of order')
  assertClean(doc(EPIC_FM.replace('drill: split', 'drill: open'), EPIC_BODY), 'open epic')
})

test('E2: a node body over 60 non-empty lines fails', () => {
  const long = LEAF_BODY + Array.from({ length: 60 }, (_, i) => `- note ${i}`).join('\n') + '\n'
  assertFails(doc(LEAF_FM, long), 'exceeds roadmap_node budget of 60')
})

// --- E3 roadmap_batch -----------------------------------------------------------

test('E3: a valid batch passes', () => assertClean(doc(BATCH_FM, BATCH_BODY), 'batch'))

test('E3: each required batch key is required', () => {
  for (const key of ['state', 'operations', 'receipts']) {
    const fm = BATCH_FM.split('\n').filter((l) => !l.startsWith(`${key}:`) && !(key === 'operations' && l.startsWith('  - '))).join('\n')
    assertFails(doc(fm, BATCH_BODY), `missing roadmap_batch key: ${key}`)
  }
})

test('E3: state, op and target are checked', () => {
  assertFails(doc(BATCH_FM.replace('state: approved', 'state: done'), BATCH_BODY), 'invalid roadmap_batch state: done (allowed: proposed|approved|applied)')
  assertFails(doc(BATCH_FM.replace('op: publish', 'op: delete'), BATCH_BODY),
    'roadmap_batch operation 2: invalid op "delete" (allowed: create_node|update_node|publish|link|status)')
  assertFails(doc(BATCH_FM.replace('{ op: publish, target: T-001 }', '{ op: publish }'), BATCH_BODY), 'roadmap_batch operation 2: missing target')
  assertFails(doc(BATCH_FM.replace('receipts: []', 'receipts: none'), BATCH_BODY), 'roadmap_batch receipts must be a list')
})

test('E3: batch sections must be there, in order', () => {
  assertFails(doc(BATCH_FM, '## Proposal\nx\n'), 'roadmap_batch missing "## Dispositions" section')
  assertFails(doc(BATCH_FM, '## Dispositions\nx\n\n## Proposal\nx\n'), 'roadmap_batch sections out of order')
})

// --- E4 directory sweep ---------------------------------------------------------

const BRIEF = `---
doc: brief
schema: 1
dish: warehouse-migration
item: sales
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: Which sales tables exist?
confidence: high
sources:
  - "list-tables --schema sales"
---
## Answer
Three tables.
`

// A roadmap folder with one of each file, and a broken node so the sweep has something to find.
function writeRoadmap(dir) {
  for (const sub of ['nodes', 'batches', 'briefs']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ROADMAP.md'), doc(ROADMAP_FM, ROADMAP_BODY))
  fs.writeFileSync(path.join(dir, 'nodes', 'T-001.md'), doc(LEAF_FM, LEAF_BODY))
  fs.writeFileSync(path.join(dir, 'nodes', 'E-001.md'), doc(EPIC_FM.replace('drill: split', 'drill: maybe'), EPIC_BODY))
  fs.writeFileSync(path.join(dir, 'batches', '1.md'), doc(BATCH_FM, BATCH_BODY))
  fs.writeFileSync(path.join(dir, 'briefs', '1-sales.md'), BRIEF)
}

const SWEPT = ['ROADMAP.md (roadmap)', 'T-001.md (roadmap_node)', 'batches/1.md (roadmap_batch)', 'briefs/1-sales.md (brief)']

test('E4: a roadmap directory argument validates every file in it', () => {
  const dir = path.join(tempDir(), 'warehouse-migration')
  writeRoadmap(dir)
  const { status, out } = run(dir)
  assert.equal(status, 1, out)
  for (const want of SWEPT) assert.ok(out.includes(want), `expected ok line for ${want}:\n${out}`)
  assert.match(out, /FAIL .*nodes\/E-001\.md: invalid roadmap_node drill: maybe/)
  assert.match(out, /5 checked, 1 nonconforming/)
})

test('E4: the default sweep covers .brigade/roadmaps/*/', () => {
  const project = tempDir()
  writeRoadmap(path.join(project, '.brigade', 'roadmaps', 'warehouse-migration'))
  const r = spawnSync(process.execPath, [VALIDATE], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project } })
  const out = r.stdout + r.stderr
  assert.equal(r.status, 1, out)
  for (const want of SWEPT) assert.ok(out.includes(want), `expected ok line for ${want}:\n${out}`)
  assert.match(out, /5 checked, 1 nonconforming/)
})

// --- I1 SCHEMAS.md examples -----------------------------------------------------

// The ```yaml block under one `### \`<type>\`` heading of SCHEMAS.md.
function example(type) {
  const start = SCHEMAS_MD.indexOf(`### \`${type}\``)
  assert.ok(start >= 0, `SCHEMAS.md has no ${type} section`)
  const block = SCHEMAS_MD.slice(start).match(/```yaml\n([\s\S]*?)\n```/)
  assert.ok(block, `SCHEMAS.md ${type} section has no yaml example`)
  return block[1]
}

test('I1: the SCHEMAS.md example for each roadmap type validates cleanly', () => {
  assertClean(doc(example('roadmap'), ROADMAP_BODY), 'roadmap example')
  assertClean(doc(example('roadmap_node'), LEAF_BODY), 'roadmap_node example')
  assertClean(doc(example('roadmap_batch'), BATCH_BODY), 'roadmap_batch example')
})

// --- I2 the library's valid fixture ----------------------------------------------

test('I2: the valid fixture roadmap passes the validator cleanly', () => {
  const { status, out } = run(path.join(ROOT, 'test', 'scripts', 'fixtures', 'roadmap', 'valid'))
  assert.equal(status, 0, out)
  assert.doesNotMatch(out, /^(FAIL|warn)/m, out)
  assert.match(out, /12 checked, 0 nonconforming/)
})
