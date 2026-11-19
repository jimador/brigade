// Tests for brigade-plan-view (C4). Each test runs the real script on a throwaway PLAN.md.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (brigade-plan-view). Clause ids are local to this file.
//   R1 requires: exactly one positional PLAN.md; `--out <path>` optional; any other flag or a
//      missing value is a usage error (exit 2).
//   R2 requires: a plan that cannot be read or written is an I/O error (exit 2); a plan with no
//      parseable items is exit 1.
//   E1 ensures: the page is written to --out, or to plan.html beside PLAN.md; the output path is
//      printed; exit 0.
//   E2 ensures: every plan-derived string is escaped; the page holds no <script element.
//   E3 ensures: every item slug appears as a node and as a table row; a contract item is marked
//      on its node (class "contract") and its table row ("yes").
//   E4 ensures: column = longest dependency depth from a root; a dependent sits strictly right of
//      each of its dependencies; each dependency edge is drawn once.
//   E5 ensures: every parked row appears in the parked table with its id, question and reopens at.
//   E6 ensures: the page head carries <meta name="generator" content="brigade-plan-view <v>">, <v>
//      being the plugin version in .claude-plugin/plugin.json beside the script.
//   I1 invariant: the page depends only on the plan content, never on the clock or the path.
//   L1 law: the same plan written in inline item style and in block item style gives identical
//      bytes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLAN_VIEW = path.join(ROOT, 'scripts', 'brigade-plan-view')

const INLINE_PLAN = `---
dish: demo-dish
ticket: demo-ticket
tier: two-star
created: 2026-11-18T07:45:00Z
items:
  - { slug: alpha, status: done, depends_on: [], files: [a.js], heavy: false, contract: true, attempts: [{ model: haiku, trigger: initial, result: done }] }
  - { slug: beta, status: dispatched, depends_on: [alpha], files: [b.js, c.js], heavy: false, contract: false, attempts: [{ model: haiku, trigger: initial, result: failed, cause: inspector-fail }] }
  - { slug: gamma, status: todo, depends_on: [alpha, beta], files: [d.js], heavy: true, contract: false, attempts: [] }
---

## Packet: beta

## Parked

| id | question | reopens at | raised |
|----|----------|------------|--------|
| Q1 | Is Tom & Jerry in scope? | alpha | 2026-11-18 |
`

// The same plan with block-style items; every value matches INLINE_PLAN.
const BLOCK_PLAN = `---
dish: demo-dish
ticket: demo-ticket
tier: two-star
created: 2026-11-18T07:45:00Z
items:
  - slug: alpha
    status: done
    depends_on: []
    files:
      - a.js
    heavy: false
    contract: true
    attempts:
      - { model: haiku, trigger: initial, result: done }
  - slug: beta
    status: dispatched
    depends_on:
      - alpha
    files:
      - b.js
      - c.js
    heavy: false
    contract: false
    attempts:
      - { model: haiku, trigger: initial, result: failed, cause: inspector-fail }
  - slug: gamma
    status: todo
    depends_on: [alpha, beta]
    files:
      - d.js
    heavy: true
    contract: false
    attempts: []
---

## Packet: beta

## Parked

| id | question | reopens at | raised |
|----|----------|------------|--------|
| Q1 | Is Tom & Jerry in scope? | alpha | 2026-11-18 |
`

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-plan-view-test-'))
}

function writePlan(dir, text, name = 'PLAN.md') {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}

function view(args) {
  return spawnSync(PLAN_VIEW, args, { encoding: 'utf8' })
}

// Renders a plan text to a fresh output file and returns the page HTML.
function render(text) {
  const dir = tmpDir()
  const plan = writePlan(dir, text)
  const out = path.join(dir, 'page.html')
  const run = view(['--out', out, plan])
  assert.equal(run.status, 0, run.stderr)
  return fs.readFileSync(out, 'utf8')
}

// Each node group as { slug, cls, x, y } in document order.
function nodes(html) {
  const re = /<g class="node ([^"]*)" data-slug="([^"]*)"><title>[^]*?<rect x="(\d+)" y="(\d+)"/g
  return [...html.matchAll(re)].map((m) => ({ cls: m[1], slug: m[2], x: Number(m[3]), y: Number(m[4]) }))
}

test('R1: exactly one positional plan, and bad flags exit 2', () => {
  const dir = tmpDir()
  const plan = writePlan(dir, INLINE_PLAN)
  assert.equal(view([]).status, 2)
  assert.equal(view(['--bogus', plan]).status, 2)
  assert.equal(view(['--out']).status, 2)
  assert.equal(view([plan, plan]).status, 2)
})

test('R2: an unreadable plan exits 2; a plan with no items exits 1', () => {
  const dir = tmpDir()
  assert.equal(view([path.join(dir, 'missing.md')]).status, 2)
  const empty = writePlan(dir, '---\ndish: nothing\n---\n\nno items here\n', 'EMPTY.md')
  const run = view(['--out', path.join(dir, 'x.html'), empty])
  assert.equal(run.status, 1)
  assert.match(run.stderr, /no parseable items/)
})

test('R2: an output path that cannot be written exits 2', () => {
  const dir = tmpDir()
  const plan = writePlan(dir, INLINE_PLAN)
  assert.equal(view(['--out', path.join(dir, 'no-such-dir', 'x.html'), plan]).status, 2)
})

test('E1: default output is plan.html beside PLAN.md and the path is printed', () => {
  const dir = tmpDir()
  const plan = writePlan(dir, INLINE_PLAN)
  const run = view([plan])
  assert.equal(run.status, 0, run.stderr)
  const expected = path.join(dir, 'plan.html')
  assert.equal(run.stdout.trim(), expected)
  assert.ok(fs.existsSync(expected))
  assert.match(fs.readFileSync(expected, 'utf8'), /^<!doctype html>/i)
})

test('E2: plan-derived strings are escaped and the page has no script element', () => {
  const hostile = INLINE_PLAN
    .replace('slug: alpha,', 'slug: s<script>alert(1)</script>,')
    .replace('ticket: demo-ticket', 'ticket: Tom & Jerry')
  const html = render(hostile)
  assert.doesNotMatch(html, /<script/i)
  assert.match(html, /s&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /Tom &amp; Jerry/)
  assert.match(html, /Is Tom &amp; Jerry in scope\?/)
})

test('E3: every slug is a node and a table row; the contract item is marked', () => {
  const html = render(INLINE_PLAN)
  for (const slug of ['alpha', 'beta', 'gamma']) {
    assert.ok(html.includes(`data-slug="${slug}"`), `node for ${slug}`)
    assert.ok(html.includes(`<td class="code">${slug}</td>`), `table row for ${slug}`)
  }
  const alpha = nodes(html).find((n) => n.slug === 'alpha')
  assert.equal(alpha.cls, 'done contract')
  assert.match(html, /<text class="tag"[^>]*>contract<\/text>/)
  assert.match(html, /<td class="yes">yes<\/td>/)
  assert.doesNotMatch(nodes(html).find((n) => n.slug === 'beta').cls, /contract/)
})

test('E4: column follows dependency depth and each dependency edge is drawn once', () => {
  const html = render(INLINE_PLAN)
  const byslug = Object.fromEntries(nodes(html).map((n) => [n.slug, n]))
  assert.ok(byslug.beta.x > byslug.alpha.x, 'beta sits right of alpha')
  assert.ok(byslug.gamma.x > byslug.beta.x, 'gamma sits right of beta (depth 2)')
  // alpha->beta, beta->gamma; alpha->gamma is implied through beta and not drawn
  assert.equal((html.match(/class="edge"/g) || []).length, 2)
})

test('E5: parked rows render with id, question and reopens at', () => {
  const html = render(INLINE_PLAN)
  assert.match(html, /<td class="code">Q1<\/td>/)
  assert.match(html, /<td class="code">alpha<\/td>/)
})

test('E5: a plan with no parked rows shows an empty state', () => {
  const html = render(INLINE_PLAN.replace(/## Parked[^]*$/, ''))
  assert.match(html, /<td colspan="4" class="muted">none<\/td>/)
})

test('E6: the page head names the generator and the plugin version', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version
  const html = render(INLINE_PLAN)
  const head = html.slice(0, html.indexOf('</head>'))
  assert.ok(head.includes(`<meta name="generator" content="brigade-plan-view ${version}">`))
})

test('L1: inline and block item styles give identical bytes', () => {
  assert.equal(render(INLINE_PLAN), render(BLOCK_PLAN))
})

test('I1: two runs on the same plan give identical bytes', () => {
  const dir = tmpDir()
  const plan = writePlan(dir, INLINE_PLAN)
  const a = path.join(dir, 'a.html')
  const b = path.join(dir, 'b.html')
  assert.equal(view(['--out', a, plan]).status, 0)
  assert.equal(view(['--out', b, plan]).status, 0)
  assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)))
})

// Each edge path in document order as { slug, d, markerEnd }.
function edgePaths(html) {
  const re = /<path class="edge"( marker-end="[^"]*")? d="([^"]*)"><title>[^<]*? to ([^<]*)<\/title><\/path>/g
  return [...html.matchAll(re)].map((m) => ({ markerEnd: m[1] ?? '', d: m[2], slug: m[3], t: m[0].match(/<title>([^<]*)</)[1] }))
}

test('M1: one arrow marker is defined and every edge points at it', () => {
  const html = render(INLINE_PLAN)
  assert.equal((html.match(/<marker id="dag-arrow"/g) || []).length, 1)
  const edges = edgePaths(html)
  assert.equal(edges.length, 2)
  for (const e of edges) assert.equal(e.markerEnd, ' marker-end="url(#dag-arrow)"', e.slug)
  assert.match(html, /\.dag \.arrow \{ fill: var\(--edge\); \}/)
})

test('P1: each edge is its own path element with a unique d', () => {
  const edges = edgePaths(render(INLINE_PLAN))
  assert.equal(edges.length, 2)
  assert.equal(new Set(edges.map((e) => e.d)).size, edges.length)
})

// A diamond (a -> b, a -> c, b -> d, c -> d) plus the redundant a -> d, and a long chain edge.
const DIAMOND_PLAN = `---
dish: diamond
ticket: t
tier: two-star
items:
  - { slug: a, status: done, depends_on: [], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: b, status: done, depends_on: [a], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: c, status: todo, depends_on: [a], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: d, status: todo, depends_on: [a, b, c], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: e, status: todo, depends_on: [a, d, ghost], files: [], heavy: false, contract: false, attempts: [] }
---
`

test('T1: only the transitive reduction is drawn; the table keeps every dependency', () => {
  const html = render(DIAMOND_PLAN)
  const titles = [...html.matchAll(/<path class="edge"[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]).sort()
  assert.deepEqual(titles, ['a to b', 'a to c', 'b to d', 'c to d', 'd to e'])
  assert.match(html, /<span class="s">a<\/span>, <span class="s">b<\/span>, <span class="s">c<\/span>/)
  assert.match(html, /<span class="s">ghost<\/span>/)
})

test('T2: the caption counts the implied dependencies, and is absent at zero', () => {
  // a->d and a->e are implied; ghost does not resolve and is not counted.
  assert.match(render(DIAMOND_PLAN), /<p class="dag-note muted">2 implied dependencies not drawn; the table lists every dependency\.<\/p>/)
  assert.match(render(INLINE_PLAN), /1 implied dependency not drawn; the table lists every dependency\./)
  const chain = INLINE_PLAN.replace('depends_on: [alpha, beta]', 'depends_on: [beta]')
  assert.doesNotMatch(render(chain), /implied dependenc/)
})

test('T3: no two edge paths share a d attribute, even with many into one node', () => {
  const edges = edgePaths(render(DIAMOND_PLAN))
  assert.equal(new Set(edges.map((e) => e.d)).size, edges.length)
  assert.ok(edges.every((e) => /^M[\d. -]+ C[\d. -]+ [\d. -]+ [\d. -]+$/.test(e.d)), 'each edge is one cubic')
})

test('T4: an edge that skips columns keeps clear of every node in between', () => {
  const plan = DIAMOND_PLAN.replace('depends_on: [a, d, ghost]', 'depends_on: [d, r]')
    .replace('---\n', '---\n', 1)
    .replace('  - { slug: b,', '  - { slug: r, status: done, depends_on: [], files: [], heavy: false, contract: false, attempts: [] }\n  - { slug: b,')
  const html = render(plan)
  const by = Object.fromEntries(nodes(html).map((q) => [q.slug, q]))
  const skip = edgePaths(html).find((x) => x.t === 'r to e')
  assert.ok(skip, 'r to e is drawn')
  assert.ok(by.e.x > by.d.x && by.d.x > by.b.x && by.b.x > by.r.x, 'r to e spans three columns')
  const num = skip.d.match(/-?[\d.]+/g).map(Number)
  const pts = [[num[0], num[1]], [num[2], num[3]], [num[4], num[5]], [num[6], num[7]]]
  for (let s = 0; s <= 60; s++) {
    const t = s / 60
    const u = 1 - t
    const x = u ** 3 * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t ** 3 * pts[3][0]
    const y = u ** 3 * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t ** 3 * pts[3][1]
    for (const n of ['b', 'c', 'd']) {
      if (x > by[n].x && x < by[n].x + 180) assert.ok(y < by[n].y || y > by[n].y + 56, `edge at (${x}, ${y}) crosses ${n}`)
    }
  }
})

test('T5: a dependency cycle and a missing slug still render, drawn as declared', () => {
  const cyc = `---
dish: loop
ticket: t
tier: two-star
items:
  - { slug: x, status: todo, depends_on: [y], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: y, status: todo, depends_on: [x, nowhere], files: [], heavy: false, contract: false, attempts: [] }
  - { slug: z, status: todo, depends_on: [y, x], files: [], heavy: false, contract: false, attempts: [] }
---
`
  const html = render(cyc)
  const titles = [...html.matchAll(/<path class="edge"[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]).sort()
  assert.deepEqual(titles, ['x to y', 'x to z', 'y to x', 'y to z'])
  assert.doesNotMatch(html, /implied dependenc/)
})

test('M2: the DAG sits in an overflow-x wrapper with a minimum width from its viewBox', () => {
  const html = render(INLINE_PLAN)
  assert.match(html, /<div class="card dag-scroll"><svg class="dag"/)
  assert.match(html, /\.dag-scroll \{ overflow-x: auto;/)
  const viewBox = html.match(/viewBox="0 0 (\d+) (\d+)"/)
  assert.ok(viewBox)
  assert.match(html, new RegExp(`style="min-width:${viewBox[1]}px"`))
})

test('P2: slug cells stay nowrap while the depends-on cell may wrap', () => {
  const html = render(INLINE_PLAN)
  assert.match(html, /\.items td\.code \{ white-space: nowrap; \}/)
  assert.match(html, /\.items td\.mono \.s \{ white-space: nowrap; \}/)
  assert.match(html, /<table class="items">/)
})
