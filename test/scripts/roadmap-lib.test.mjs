// Tests for scripts/lib/roadmap.mjs, the roadmap parser and graph library. Each test reads a
// fixture roadmap under test/scripts/fixtures/roadmap/ (valid, cycle, orphan, malformed) or a
// small roadmap built in memory with parseRoadmapFiles.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (scripts/lib/roadmap.mjs). Clause ids are local to this file.
//   E1 ensures: parseRoadmap(dir) returns { roadmap, systems, inventory, requirements, questions,
//      decisions, nodes, batches, errors }; tables come from their markdown sections; nodes are
//      keyed by id with frontmatter fields and body section names; malformed files add to
//      errors, never throw.
//   E2 ensures: children, ancestors and depth answer from the parent links.
//   E3 ensures: findCycles returns every parent cycle and every depends_on cycle as an ordered id
//      path; danglingRefs lists unknown ids in parent, depends_on, satisfies, covers.
//   E4 ensures: leafReadiness lists the unmet leaf rules from DESIGN.md § Checks.
//   E5 ensures: frontier gives the bfs or dfs batch, at most `limit`, with question-blocked nodes
//      returned separately as parked.
//   E6 ensures: coverage lists inventory, requirement and leaf gaps and derives parent and
//      requirement status.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseRoadmap, parseRoadmapFiles, children, ancestors, depth, descendants, findCycles, danglingRefs,
  leafReadiness, frontier, coverage, compareIds,
} from '../../scripts/lib/roadmap.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'roadmap')
const load = (name) => parseRoadmap(path.join(FIXTURES, name))
const valid = load('valid')

const node = (id, extra = '') => `---\ndoc: roadmap_node\nid: ${id}\n${extra}\n---\n`

test('E1 parses the valid roadmap with no errors', () => {
  assert.deepEqual(valid.errors, [])
  assert.deepEqual(Object.keys(valid).sort(),
    ['batches', 'decisions', 'errors', 'inventory', 'nodes', 'questions', 'requirements', 'roadmap', 'systems'])
  assert.equal(valid.roadmap.mode, 'bfs')
  assert.equal(valid.roadmap.focus, 'E-1')
  assert.equal(valid.roadmap.max_depth, '3')
  assert.deepEqual(valid.roadmap.next_ids, ['E-3', 'F-5', 'S-2', 'T-4'])
  assert.ok(valid.roadmap.sections.includes('Open questions'))
})

test('E1 reads the Systems, Inventory and Requirements tables by header', () => {
  assert.deepEqual(valid.systems.map((r) => r.id), ['SYS-1', 'SYS-2'])
  assert.equal(valid.systems[0].read_only_command, '`git log --oneline | head`', 'an escaped pipe stays in its cell')
  assert.equal(valid.systems[1].access, 'missing')
  assert.deepEqual(valid.inventory.map((r) => r.id), ['I-1', 'I-2', 'I-3', 'I-4'])
  assert.equal(valid.inventory[2].excluded_by, 'legacy-report-dropped')
  assert.equal(valid.inventory[0].covered_by, 'F-1')
  assert.deepEqual(valid.requirements.map((r) => [r.id, r.kind, r.status]), [
    ['R-1', 'functional', 'accepted'], ['R-2', 'parity', 'accepted'], ['R-3', 'risk', 'proposed'], ['R-4', 'constraint', 'dropped'],
  ])
})

test('E1 reads questions with their node scope, decisions and batches', () => {
  assert.equal(valid.questions.length, 1)
  const q = valid.questions[0]
  assert.equal(q.name, 'retention-window')
  assert.equal(q.type, 'grilling')
  assert.equal(q.mode, 'HITL')
  assert.deepEqual(q.nodes, ['F-2'])
  assert.equal(q.blocked_by, '')
  assert.doesNotMatch(q.text, /Blocked by/)
  assert.deepEqual(valid.decisions.map((d) => d.name), ['legacy-report-dropped'])
  assert.deepEqual(valid.batches.map((b) => [b.file, b.n, b.state]), [['batches/1.md', 1, 'applied']])
})

test('E1 keys nodes by id, in id order, with frontmatter fields and section names', () => {
  assert.deepEqual(Object.keys(valid.nodes), ['E-1', 'E-2', 'F-1', 'F-2', 'F-3', 'F-4', 'S-1', 'T-1', 'T-2', 'T-3'])
  const t1 = valid.nodes['T-1']
  assert.equal(t1.file, 'nodes/T-1.md')
  assert.equal(t1.parent, 'F-1')
  assert.equal(t1.drill, 'leaf')
  assert.equal(t1.repo, 'acme/api')
  assert.equal(t1.size_swag, 'S')
  assert.deepEqual(t1.sources, ['briefs/export.md'], 'a block list is read')
  assert.deepEqual(t1.sections, ['Goal', 'Context', 'Acceptance criteria', 'Constraints', 'Out of scope'])
  assert.equal(t1.goal, true)
  assert.equal(t1.criteria, 2)
  const t3 = valid.nodes['T-3']
  assert.deepEqual(t3.satisfies, ['R-2'], 'a quoted flow entry is unquoted')
  assert.deepEqual(t3.covers, ['I-2'], 'a trailing comment is dropped')
  assert.equal(valid.nodes['E-1'].parent, '', 'an empty key is an empty parent')
  assert.equal(valid.nodes['E-1'].frontmatter.ticket, 'ACME-1')
})

test('E1 reports every malformed file and keeps going', () => {
  const m = load('malformed')
  const has = (re) => assert.ok(m.errors.some((e) => re.test(e)), `expected an error matching ${re}\n${m.errors.join('\n')}`)
  has(/ROADMAP\.md: frontmatter line 4: next_ids is not a closed/)
  has(/ROADMAP\.md: mode is "sideways"/)
  has(/Inventory row has 3 cells, the header has 6/)
  has(/Inventory row has no id/)
  has(/Inventory repeats id I-1/)
  has(/open question does not follow the question line format/)
  has(/nodes\/T-1\.md: no frontmatter/)
  has(/nodes\/T-1\.md: no id/)
  has(/nodes\/T-2\.md: frontmatter line 5: covers is a mapping/)
  has(/nodes\/T-2\.md: frontmatter line 6: title has an unclosed quote/)
  has(/nodes\/T-2\.md: drill is "maybe"/)
  has(/nodes\/T-2\.md: id T-9 does not match the file name/)
  has(/nodes\/T-4\.md: duplicate id T-3 \(also in nodes\/T-3\.md\)/)
  has(/nodes\/X-1\.md: id "__proto__" is not usable/)
  has(/batches\/1\.md: state is "done"/)
  assert.deepEqual(Object.keys(m.nodes), ['T-3', 'T-9'])
  assert.equal(m.nodes['T-3'].file, 'nodes/T-3.md', 'the first file with an id wins')
  assert.equal(Object.getPrototypeOf(m.nodes), Object.prototype)
})

test('E1 never throws on a missing directory or junk input', () => {
  const missing = parseRoadmap(path.join(FIXTURES, 'no-such-roadmap'))
  assert.deepEqual(missing.errors, ['ROADMAP.md is missing'])
  assert.deepEqual(missing.nodes, {})
  assert.match(parseRoadmap(undefined).errors[0], /not a path/)
  for (const junk of [null, 42, 'text', { 'ROADMAP.md': 7, 'nodes/E-1.md': {} }]) {
    const m = parseRoadmapFiles(junk)
    assert.ok(m.errors.length > 0)
    assert.deepEqual(m.nodes, {})
  }
  const crlf = parseRoadmapFiles({ 'ROADMAP.md': '---\r\ndoc: roadmap\r\nmode: dfs\r\n---\r\n', 'nodes/E-1.md': node('E-1', 'drill: open').replace(/\n/g, '\r\n') })
  assert.deepEqual(crlf.errors, [])
  assert.equal(crlf.roadmap.mode, 'dfs')
  assert.equal(crlf.nodes['E-1'].drill, 'open')
})

test('E1 reads a flow list wrapped over lines', () => {
  const m = parseRoadmapFiles({ 'ROADMAP.md': '---\ndoc: roadmap\n---\n', 'nodes/T-1.md': node('T-1', 'depends_on: [T-2,\n  T-3]\nsatisfies: []') })
  assert.deepEqual(m.errors, [])
  assert.deepEqual(m.nodes['T-1'].depends_on, ['T-2', 'T-3'])
  assert.deepEqual(m.nodes['T-1'].satisfies, [])
})

test('E2 children, ancestors, depth and descendants follow the parent links', () => {
  assert.deepEqual(children(valid, 'E-1'), ['F-1', 'F-2'])
  assert.deepEqual(children(valid, 'F-3'), ['S-1', 'T-3'])
  assert.deepEqual(children(valid, 'T-1'), [])
  assert.deepEqual(ancestors(valid, 'T-1'), ['F-1', 'E-1'])
  assert.deepEqual(ancestors(valid, 'E-2'), [])
  assert.equal(depth(valid, 'E-1'), 0)
  assert.equal(depth(valid, 'F-4'), 1)
  assert.equal(depth(valid, 'S-1'), 2)
  assert.equal(depth(valid, 'nope'), -1)
  assert.deepEqual(descendants(valid, 'E-2'), ['F-3', 'F-4', 'S-1', 'T-3'])
})

test('E2 stays finite on a parent cycle and tolerates a broken model', () => {
  const m = load('cycle')
  assert.deepEqual(ancestors(m, 'F-1'), ['F-2'])
  assert.equal(depth(m, 'F-1'), 1)
  assert.deepEqual(ancestors(m, 'T-3'), [], 'an unknown parent ends the chain')
  for (const bad of [null, {}, { nodes: 5 }]) {
    assert.deepEqual(children(bad, 'E-1'), [])
    assert.deepEqual(ancestors(bad, 'E-1'), [])
    assert.equal(depth(bad, 'E-1'), -1)
  }
})

test('E3 findCycles returns every parent and depends_on cycle as a closed id path', () => {
  assert.deepEqual(findCycles(valid), [])
  assert.deepEqual(findCycles(load('cycle')), [
    { kind: 'parent', path: ['F-1', 'F-2', 'F-1'] },
    { kind: 'depends_on', path: ['T-1', 'T-2', 'T-1'] },
    { kind: 'depends_on', path: ['T-1', 'T-2', 'T-3', 'T-1'] },
  ])
})

test('E3 findCycles finds a self dependency and each cycle once', () => {
  const m = parseRoadmapFiles({
    'ROADMAP.md': '---\ndoc: roadmap\n---\n',
    'nodes/T-1.md': node('T-1', 'depends_on: [T-1]'),
    'nodes/T-2.md': node('T-2', 'depends_on: [T-3]'),
    'nodes/T-3.md': node('T-3', 'depends_on: [T-4, T-2]'),
    'nodes/T-4.md': node('T-4', 'depends_on: [T-2]'),
    'nodes/E-1.md': node('E-1', 'parent: E-1'),
  })
  assert.deepEqual(findCycles(m), [
    { kind: 'parent', path: ['E-1', 'E-1'] },
    { kind: 'depends_on', path: ['T-1', 'T-1'] },
    { kind: 'depends_on', path: ['T-2', 'T-3', 'T-2'] },
    { kind: 'depends_on', path: ['T-2', 'T-3', 'T-4', 'T-2'] },
  ])
  assert.deepEqual(findCycles(null), [])
})

test('E3 danglingRefs lists unknown parent, depends_on, satisfies and covers ids', () => {
  assert.deepEqual(danglingRefs(valid), [])
  assert.deepEqual(danglingRefs(load('cycle')), [
    { node: 'T-3', field: 'parent', ref: 'E-9' },
    { node: 'T-3', field: 'depends_on', ref: 'T-9' },
    { node: 'T-3', field: 'satisfies', ref: 'R-9' },
    { node: 'T-3', field: 'covers', ref: 'I-7' },
  ])
})

test('E4 a complete leaf has no unmet rules', () => {
  assert.deepEqual(leafReadiness(valid, 'T-1'), [])
  assert.deepEqual(leafReadiness(valid, 'T-3'), [])
})

test('E4 leafReadiness names each unmet rule', () => {
  const rules = (m, id) => leafReadiness(m, id).map((r) => r.rule)
  assert.deepEqual(rules(valid, 'T-2'), ['criteria', 'repo', 'trace', 'size', 'brief'])
  assert.ok(rules(valid, 'F-2').includes('question'), 'F-2 is named by an open question')
  assert.match(leafReadiness(valid, 'F-2').find((r) => r.rule === 'question').message, /retention-window/)
  assert.deepEqual(rules(valid, 'nope'), ['node'])

  const ready = 'drill: leaf\nrepo: acme/api\nsatisfies: [R-1]\nsize_swag: XS\nsources: [briefs/a.md]'
  const body = '\n## Goal\n\nDo it.\n\n## Acceptance criteria\n\n- [ ] It works.\n'
  const m = parseRoadmapFiles({
    'ROADMAP.md': '---\ndoc: roadmap\n---\n\n## Open questions\n\n- **scope** — `grilling` · HITL — Is E-1 one epic or two? Blocked by: none\n',
    'nodes/E-1.md': node('E-1', 'drill: split'),
    'nodes/T-1.md': node('T-1', `parent: E-1\n${ready}`) + body,
    'nodes/T-2.md': node('T-2', ready.replace('repo: acme/api', 'repo: [acme/api, acme/web]')) + '\n## Goal\n\n## Acceptance criteria\n\n- [ ] It works.\n',
  })
  assert.deepEqual(rules(m, 'T-1'), ['question'], 'an open question on an ancestor parks the leaf')
  assert.deepEqual(rules(m, 'T-2'), ['goal', 'repo'], 'an empty Goal and two repos both count')
})

test('E5 bfs gives the open nodes at the shallowest depth, parking question-blocked ones', () => {
  assert.deepEqual(frontier(valid, { mode: 'bfs' }), { mode: 'bfs', focus: 'E-1', nodes: ['F-4'], parked: ['F-2'], errors: [] })
  const deep = frontier(valid, { mode: 'bfs', focus: '' })
  assert.deepEqual(deep.nodes, ['F-4'], 'focus does not narrow bfs')
})

test('E5 dfs gives the open nodes under focus, deepest first', () => {
  assert.deepEqual(frontier(valid, { mode: 'dfs', focus: 'E-2' }).nodes, ['S-1', 'F-4'])
  assert.deepEqual(frontier(valid, { mode: 'dfs', focus: 'E-2' }).parked, [])
  const e1 = frontier(valid, { mode: 'dfs', focus: 'E-1' })
  assert.deepEqual([e1.nodes, e1.parked], [[], ['F-2']])
  assert.deepEqual(frontier(valid, { mode: 'dfs', focus: '' }).nodes, ['S-1', 'F-4'], 'no focus means the whole roadmap')
  assert.deepEqual(frontier(valid, { mode: 'dfs', focus: 'E-9' }).errors, ['unknown focus E-9'])
})

test('E5 frontier honours limit, saved settings and drill: parked', () => {
  const files = { 'ROADMAP.md': '---\ndoc: roadmap\nmode: bfs\n---\n' }
  for (let i = 1; i <= 9; i++) files[`nodes/E-${i}.md`] = node(`E-${i}`, 'drill: open')
  files['nodes/E-10.md'] = node('E-10', 'drill: parked')
  const m = parseRoadmapFiles(files)
  assert.deepEqual(frontier(m).nodes, ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7'], 'default limit is 7, in id order')
  assert.deepEqual(frontier(m, { limit: 2 }).nodes, ['E-1', 'E-2'])
  assert.deepEqual(frontier(m).parked, ['E-10'])
  assert.equal(frontier(m).mode, 'bfs', 'mode falls back to the saved one')
  assert.deepEqual(frontier(m, { mode: 'sideways' }).errors, ['unknown mode "sideways", expected bfs|dfs'])
  assert.deepEqual(frontier(null).nodes, [])
})

test('E6 coverage on the valid roadmap: one untraced leaf and derived statuses', () => {
  assert.deepEqual(coverage(valid), {
    uncoveredInventory: [],
    unsatisfiedRequirements: [],
    untracedLeaves: ['T-2'],
    parentStatus: { 'E-1': 'in_progress', 'E-2': 'blocked', 'F-1': 'in_progress', 'F-3': 'blocked' },
    requirementStatus: { 'R-1': 'met', 'R-2': 'unmet', 'R-3': 'unmet', 'R-4': 'unmet' },
  })
})

test('E6 coverage finds the orphan inventory row and the unsatisfied accepted requirement', () => {
  const c = coverage(load('orphan'))
  assert.deepEqual(c.uncoveredInventory, ['I-2'], 'I-1 is covered by a node, I-3 has an exclusion')
  assert.deepEqual(c.unsatisfiedRequirements, ['R-2'], 'R-3 is only proposed')
  assert.deepEqual(c.parentStatus, { 'E-1': 'done' })
  assert.deepEqual(c.requirementStatus, { 'R-1': 'met', 'R-2': 'unmet', 'R-3': 'unmet' })
})

test('E6 parent status rules: all done, any blocked, any started, else backlog', () => {
  const tree = (statuses) => {
    const files = { 'ROADMAP.md': '---\ndoc: roadmap\n---\n', 'nodes/E-1.md': node('E-1', 'drill: split') }
    statuses.forEach((s, i) => { files[`nodes/T-${i + 1}.md`] = node(`T-${i + 1}`, `parent: E-1\ndrill: leaf\nstatus: ${s}`) })
    return coverage(parseRoadmapFiles(files)).parentStatus['E-1']
  }
  assert.equal(tree(['done', 'done']), 'done')
  assert.equal(tree(['done', 'blocked', 'in_progress']), 'blocked')
  assert.equal(tree(['done', 'todo']), 'in_progress')
  assert.equal(tree(['in_review', 'backlog']), 'in_progress')
  assert.equal(tree(['todo', 'backlog', 'design', '']), 'backlog')
  assert.deepEqual(coverage(null).parentStatus, {})
  assert.ok(Array.isArray(coverage(load('cycle')).untracedLeaves), 'a parent cycle does not hang coverage')
})

test('compareIds orders by level letter, then counter', () => {
  assert.deepEqual(['T-1', 'E-10', 'F-2', 'E-2', 'S-1'].sort(compareIds), ['E-2', 'E-10', 'F-2', 'S-1', 'T-1'])
})
