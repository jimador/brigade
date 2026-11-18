// Tests for scripts/lib/dag.mjs, the graph layout shared by the plan view and the roadmap view.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (dag.mjs). Clause ids are local to this file.
//   E1 ensures: esc, place, reduceLinks and renderDag take a generic
//      { nodes: [{ id, label, cls }], edges: [[from, to]] } graph.
//   E2 ensures: brigade-plan-view draws the same graph bytes it drew before the layout moved here.
//   E3 ensures: renderDag ends on a cyclic graph and gives every edge on a cycle the class "cycle".
//   L1 law: the same graph always gives the same layout and the same SVG.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { esc, place, reduceLinks, renderDag } from '../../scripts/lib/dag.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLAN_VIEW = path.join(ROOT, 'scripts', 'brigade-plan-view')

// A small build: fetch feeds parse and lint, both feed test, and pack waits on everything.
const BUILD = {
  nodes: [
    { id: 'fetch', label: 'fetch', cls: 'done' },
    { id: 'parse', label: 'parse', cls: 'todo' },
    { id: 'lint', label: 'lint', cls: 'todo' },
    { id: 'test', label: 'test', cls: 'todo' },
    { id: 'pack', label: 'pack', cls: 'todo' },
  ],
  edges: [
    ['fetch', 'parse'], ['fetch', 'lint'], ['parse', 'test'], ['lint', 'test'],
    ['test', 'pack'], ['fetch', 'pack'], ['parse', 'pack'], ['test', 'pack'], ['ghost', 'pack'],
  ],
}

const edgesOf = (svg) => [...svg.matchAll(/<path class="([^"]*)"[^>]*><title>([^<]*)<\/title>/g)]
  .map((m) => ({ cls: m[1], title: m[2] }))

test('E1: esc turns markup and script-looking text into references', () => {
  assert.equal(esc(`a<b>&"c'`), 'a&lt;b&gt;&amp;&quot;c&#39;')
  assert.equal(esc('onload=x href url(y)'), 'onload&#61;x &#104;ref url&#40;y)')
  assert.equal(esc(42), '42')
})

test('E1/L1: a small DAG gets a stable layout', () => {
  assert.deepEqual(place(BUILD), [
    { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 1, row: 1 }, { col: 2, row: 0 }, { col: 3, row: 0 },
  ])
  assert.deepEqual(reduceLinks(BUILD), [
    ['fetch', 'parse'], ['fetch', 'lint'], ['parse', 'test'], ['lint', 'test'], ['test', 'pack'],
  ])
  const first = renderDag(BUILD)
  assert.deepEqual(renderDag(BUILD), first)
  assert.equal(first.hidden, 2)
  assert.equal(first.cycles, 0)
  assert.match(first.svg, /^<svg class="dag" viewBox="0 0 980 168" style="min-width:980px" role="img" aria-label="Dependency graph of 5 nodes">/)
  assert.deepEqual(edgesOf(first.svg).map((e) => e.title),
    ['fetch to parse', 'fetch to lint', 'parse to test', 'lint to test', 'test to pack'])
  assert.ok(edgesOf(first.svg).every((e) => e.cls === 'edge'))
  assert.match(first.svg, /<g class="node done" data-id="fetch"><title>fetch<\/title><rect x="52" y="16" width="180" height="56" rx="8"\/>/)
  assert.match(first.svg, /<path class="edge" marker-end="url\(#dag-arrow\)" d="M232 34.7 C258 34.7 258 44 284 44"><title>fetch to parse<\/title><\/path>/)
  assert.match(first.svg, /<path class="edge" marker-end="url\(#dag-arrow\)" d="M696 44 C722 44 722 44 748 44"><title>test to pack<\/title><\/path>/)
})

test('E1: optional meta, tag and data fields reach the node', () => {
  const { svg } = renderDag({
    nodes: [{ id: 'w', label: 'warehouse-load-with-a-long-name', cls: 'active', meta: 'nightly', tag: 'gate', data: { epic: 'e<1>' } }],
    edges: [],
  }, { ariaLabel: 'Load order' })
  assert.match(svg, /aria-label="Load order"/)
  assert.match(svg, /<g class="node active" data-epic="e&lt;1&gt;"><title>warehouse-load-with-a-long-name - nightly<\/title>/)
  assert.match(svg, /<text class="slug" x="62" y="44">warehouse-load-with...<\/text>/)
  assert.match(svg, /<text class="meta" x="62" y="62">nightly<\/text>/)
  assert.match(svg, /<text class="tag" x="222" y="31" text-anchor="end">gate<\/text>/)
})

test('E3: a cycle renders, ends, and marks only its own edges', () => {
  const graph = {
    nodes: ['x', 'y', 'z', 'tail', 'self'].map((id) => ({ id, label: id, cls: 'todo' })),
    edges: [['x', 'y'], ['y', 'z'], ['z', 'x'], ['z', 'tail'], ['self', 'self'], ['tail', 'self']],
  }
  const out = renderDag(graph)
  const edges = edgesOf(out.svg)
  assert.deepEqual(edges.map((e) => `${e.title}: ${e.cls}`), [
    'x to y: edge cycle', 'y to z: edge cycle', 'z to x: edge cycle',
    'z to tail: edge', 'self to self: edge cycle', 'tail to self: edge',
  ])
  assert.equal(out.cycles, 4)
  assert.equal(out.hidden, 0)
  assert.equal(place(graph).length, 5)
  // Marking can be turned off, and then every edge is a plain edge.
  const plain = renderDag(graph, { markCycles: false })
  assert.ok(edgesOf(plain.svg).every((e) => e.cls === 'edge'))
  assert.equal(plain.cycles, 0)
})

test('E3: a dense cyclic graph still finishes', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `n${i}`)
  const edges = ids.flatMap((a) => ids.map((b) => [a, b]))
  const out = renderDag({ nodes: ids.map((id) => ({ id, label: id })), edges })
  assert.equal(edgesOf(out.svg).length, 1600)
  assert.equal(out.cycles, 1600)
})

test('E1: an empty graph draws an empty frame', () => {
  const out = renderDag({ nodes: [], edges: [] })
  assert.match(out.svg, /^<svg class="dag" viewBox="0 0 284 88"/)
  assert.deepEqual(place({ nodes: [], edges: [] }), [])
})

// The plan view's graph, hashed. The hashes were taken from the plan view before its layout
// moved into dag.mjs; only the drawn graph and its note are hashed, so a page template change
// leaves them alone.
const row = (slug, status, deps, contract = false) =>
  `  - { slug: ${slug}, status: ${status}, depends_on: [${deps.join(', ')}], files: [x.js], heavy: false, contract: ${contract}, attempts: [] }\n`
const plan = (dish, rows) => `---\ndish: ${dish}\nticket: t-1\ntier: two-star\nitems:\n${rows.join('')}---\n`
const BEFORE = [
  ['diamond', 'ed5a24cdb9b981aa6111e7763eca25d0f3cc13145396960007d1a85d934cada0', plan('diamond', [
    row('a', 'done', [], true), row('b', 'dispatched', ['a']), row('c', 'todo', ['a']),
    row('d', 'blocked', ['b', 'c', 'a']), row('e', 'todo', ['a', 'd', 'b']),
    row('a-very-long-slug-that-gets-shortened', 'review', ['e', 'c']),
  ])],
  ['cycle', 'ea2ae97694e24f5c76b629fb3558a89af05109d8b417c22aed8f0f598149ee44', plan('loop', [
    row('x', 'todo', ['y']), row('y', 'todo', ['x', 'nowhere']), row('z', 'todo', ['y', 'x', 'z']),
  ])],
  ['repeated slugs', 'cb92cf79a97ff4ade466dbf6df2ff0c11d6fc8c112e29f09300d91ac84e79b56', plan('repeated', [
    row('p', 'todo', []), row('q', 'todo', ['p']), row('p', 'done', ['q']), row('r', 'landed', ['p', 'p']),
  ])],
]

test('E2: the plan view draws the same graph bytes as before the move', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-lib-'))
  try {
    for (const [name, hash, text] of BEFORE) {
      const planPath = path.join(dir, `${name.replace(/ /g, '-')}.md`)
      const outPath = path.join(dir, `${name.replace(/ /g, '-')}.html`)
      fs.writeFileSync(planPath, text)
      const r = spawnSync(process.execPath, [PLAN_VIEW, '--out', outPath, planPath], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      const html = fs.readFileSync(outPath, 'utf8')
      const svg = html.match(/<svg class="dag"[^]*?<\/svg>/)[0]
      const note = (html.match(/<p class="dag-note[^]*?<\/p>/) || [''])[0]
      assert.equal(crypto.createHash('sha256').update(svg + note).digest('hex'), hash, name)
      assert.doesNotMatch(svg, /class="edge cycle"/, name)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
