// Tests for brigade-roadmap-view. Each test runs the real script on a copy of a fixture roadmap
// (or a throwaway one), so the fixtures never get a roadmap.html written into them.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (brigade-roadmap-view). Clause ids are local to this file.
//   R1 requires: exactly one positional directory; `--out <path>` optional; anything else is a
//      usage error (exit 2); a path that is not a directory is exit 2.
//   E1 ensures: the page is written to --out, or to roadmap.html inside the directory; the output
//      path is printed; exit 0.
//   E2 ensures: a top nav links four anchored sections: outline, dependencies, boards, coverage;
//      the outline is nested <details>; dependency graphs mark cycle edges; boards put leaves in
//      lanes with an unpublished lane for leaves without a ticket; coverage lists the gaps.
//   E3 ensures: a malformed or cyclic roadmap still renders, its problems listed above the outline.
//   E4 ensures: roadmap text is escaped; the page holds no <script element and no network URL.
//   I1 invariant: the page depends only on the roadmap's content: two runs, or the same roadmap in
//      two places, give the same bytes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VIEW = path.join(ROOT, 'scripts', 'brigade-roadmap-view')
const FIXTURES = path.join(ROOT, 'test', 'scripts', 'fixtures', 'roadmap')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-view-'))
const run = (...args) => spawnSync(process.execPath, [VIEW, ...args], { encoding: 'utf8' })

// A copy of a fixture roadmap in a fresh temp folder.
function copyFixture(name) {
  const dir = path.join(tmp(), name)
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true })
  return dir
}

// Renders `dir` to a file beside it and returns the page text.
function render(dir) {
  const out = path.join(path.dirname(dir), `${path.basename(dir)}.html`)
  const r = run(dir, '--out', out)
  assert.equal(r.status, 0, r.stderr)
  return fs.readFileSync(out, 'utf8')
}

// The inner HTML of the board lane with the given name, in the first board on the page that has
// that card.
const lane = (html, name) => {
  const m = new RegExp(`<div class="lane" aria-label="${name}">((?:<div class="ticket[\\s\\S]*?</div></div>)*)</div>`).exec(html)
  return m ? m[1] : null
}

test('R1: usage errors and a missing directory exit 2', () => {
  assert.equal(run().status, 2)
  assert.equal(run('a', 'b').status, 2)
  assert.equal(run(copyFixture('valid'), '--out').status, 2)
  assert.equal(run(copyFixture('valid'), '--bogus').status, 2)
  const missing = run(path.join(tmp(), 'nope'))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /not a roadmap directory/)
})

test('E1: writes roadmap.html inside the directory by default and prints the path', () => {
  const dir = copyFixture('valid')
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  const want = path.join(dir, 'roadmap.html')
  assert.equal(r.stdout.trim(), want)
  assert.ok(fs.statSync(want).size > 0)
})

test('E1: --out writes to the given path instead', () => {
  const dir = copyFixture('valid')
  const out = path.join(tmp(), 'page.html')
  const r = run(dir, '--out', out)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), out)
  assert.ok(fs.existsSync(out))
  assert.equal(fs.existsSync(path.join(dir, 'roadmap.html')), false)
})

test('I1: two runs, and the same roadmap in two places, give identical bytes', () => {
  const a = copyFixture('valid')
  const first = render(a)
  const second = render(a)
  assert.equal(first, second)
  const b = copyFixture('valid')
  assert.equal(render(b), first)
  const c = copyFixture('cycle')
  assert.equal(render(c), render(c))
})

test('E2: the top nav links all four anchored sections', () => {
  const html = render(copyFixture('valid'))
  const nav = /<nav class="top"[\s\S]*?<\/nav>/.exec(html)
  assert.ok(nav, 'no top nav')
  for (const id of ['outline', 'dependencies', 'boards', 'coverage']) {
    assert.ok(nav[0].includes(`href="#${id}"`), `nav lacks #${id}`)
    assert.ok(html.includes(`<section id="${id}">`), `no section #${id}`)
  }
  assert.ok(html.indexOf('<nav class="top"') < html.indexOf('<section id="outline">'))
})

test('E2: the outline nests each node inside its parent with its facts', () => {
  const html = render(copyFixture('valid'))
  const outline = /<section id="outline">([\s\S]*?)<\/section>/.exec(html)[1]
  // T-1 sits inside F-1, which sits inside E-1.
  const e1 = outline.indexOf('<span class="code">E-1</span>')
  const f1 = outline.indexOf('<span class="code">F-1</span>')
  const t1 = outline.indexOf('<span class="code">T-1</span>')
  const e2 = outline.indexOf('<span class="code">E-2</span>')
  assert.ok(e1 >= 0 && e1 < f1 && f1 < t1 && t1 < e2)
  assert.ok(outline.includes('<details class="node"'))
  // Derived status for a parent, the leaf's ticket and its requirement id.
  assert.match(outline, /E-2<\/span> <span class="title">Prove parity<\/span> <span class="pill blocked">blocked<\/span>/)
  assert.ok(outline.includes('ACME-7'))
  assert.match(outline, /<dt>Requirements<\/dt><dd><span class="s">R-1<\/span>/)
  assert.match(outline, /<dt>Inventory<\/dt><dd><span class="s">I-2<\/span>/)
})

test('E2: dependencies draw an epic graph with the cross-epic edge, then one graph per epic', () => {
  const html = render(copyFixture('valid'))
  const deps = /<section id="dependencies">([\s\S]*?)<\/section>/.exec(html)[1]
  assert.equal((deps.match(/<svg class="dag"/g) || []).length, 3)
  assert.match(deps, /aria-label="Dependencies between 2 epics"/)
  // T-3 (under E-2) depends on T-1 (under E-1): one aggregated edge E-1 -> E-2.
  assert.match(deps, /<title>E-1 to E-2<\/title>/)
  assert.ok(deps.includes('T-3 on T-1'))
  assert.ok(deps.includes('id="deps-E-1"') && deps.includes('id="deps-E-2"'))
})

test('E2: boards put leaves in lanes and leaves without a ticket in unpublished', () => {
  const html = render(copyFixture('valid'))
  const boards = /<section id="boards">([\s\S]*?)<\/section>/.exec(html)[1]
  for (const name of ['Backlog', 'Todo', 'In progress', 'In review', 'Done', 'Blocked', 'Unpublished']) {
    assert.ok(boards.includes(`aria-label="${name}"`), `no ${name} lane`)
  }
  assert.ok(lane(boards, 'Done').includes('T-1'), 'T-1 (ticket ACME-7, done) belongs in Done')
  assert.ok(lane(boards, 'Unpublished').includes('T-2'), 'T-2 has no ticket')
  assert.ok(!lane(boards, 'In progress').includes('T-2'))
})

test('E2: coverage lists the gaps, questions, missing access and met requirements', () => {
  const html = render(copyFixture('valid'))
  const cov = /<section id="coverage">([\s\S]*?)<\/section>/.exec(html)[1]
  for (const id of ['cov-inventory', 'cov-requirements', 'cov-leaves', 'cov-questions', 'cov-cycles', 'cov-access', 'cov-met']) {
    assert.ok(cov.includes(`id="${id}"`), `no ${id} table`)
  }
  const block = (id) => cov.slice(cov.indexOf(`id="${id}"`), cov.indexOf('</table>', cov.indexOf(`id="${id}"`)))
  assert.ok(block('cov-leaves').includes('T-2'))
  assert.ok(!block('cov-leaves').includes('T-1'))
  assert.ok(block('cov-questions').includes('retention-window'))
  assert.match(block('cov-questions'), /<span class="s">F-2<\/span>/)
  assert.ok(block('cov-access').includes('SYS-2') && !block('cov-access').includes('SYS-1'))
  assert.match(block('cov-met'), /R-1<\/td>[\s\S]*?<span class="pill done">met<\/span>/)
  const orphan = /<section id="coverage">([\s\S]*?)<\/section>/.exec(render(copyFixture('orphan')))[1]
  assert.ok(orphan.includes('I-2') && orphan.includes('R-2'))
})

test('E3: a cyclic roadmap renders with its cycles listed at the top and marked in the graph', () => {
  const html = render(copyFixture('cycle'))
  const problems = /<section class="card warn" id="problems">([\s\S]*?)<\/section>/.exec(html)
  assert.ok(problems, 'no problems list')
  assert.ok(html.indexOf('id="problems"') < html.indexOf('<section id="outline">'))
  assert.ok(problems[1].includes('depends_on cycle: T-1 -&gt; T-2 -&gt; T-1'))
  assert.ok(problems[1].includes('parent cycle: F-1 -&gt; F-2 -&gt; F-1'))
  assert.ok(problems[1].includes('T-3: parent names E-9, which does not exist'))
  assert.match(html, /<path class="edge cycle"/)
  const cycles = html.slice(html.indexOf('id="cov-cycles"'), html.indexOf('</table>', html.indexOf('id="cov-cycles"')))
  assert.ok(cycles.includes('T-1 -&gt; T-2 -&gt; T-3 -&gt; T-1'))
  // Nodes that never reach an epic still show up, each once.
  assert.ok(html.includes('id="outline-unplaced"'))
  const outline = /<section id="outline">([\s\S]*?)<\/section>/.exec(html)[1]
  assert.equal((outline.match(/<span class="code">F-2<\/span>/g) || []).length, 1)
})

test('E3: a malformed roadmap renders with its parse errors listed at the top', () => {
  const html = render(copyFixture('malformed'))
  const problems = /<section class="card warn" id="problems">([\s\S]*?)<\/section>/.exec(html)
  assert.ok(problems)
  assert.ok(problems[1].includes('mode is &quot;sideways&quot;'))
  assert.ok(problems[1].includes('duplicate id T-3'))
  for (const id of ['outline', 'dependencies', 'boards', 'coverage']) assert.ok(html.includes(`<section id="${id}">`))
  // A folder with nothing in it still gives a page that says so.
  const empty = tmp()
  const page = render(empty)
  assert.ok(page.includes('ROADMAP.md is missing'))
})

test('E4: hostile titles and table text are escaped; no script and no network URL', () => {
  const dir = path.join(tmp(), 'hostile')
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true })
  const evil = `<script>alert("x")</script> & 'quoted'`
  fs.writeFileSync(path.join(dir, 'ROADMAP.md'), [
    '---', 'doc: roadmap', 'title: "<script>bad()</script>"', 'mode: bfs', '---', '',
    '## Requirements', '', '| id | kind | statement | source | status |', '|----|------|-----------|--------|--------|',
    '| R-1 | functional | <img src=x onerror=alert(1)> | intent | accepted |', '',
  ].join('\n'))
  fs.writeFileSync(path.join(dir, 'nodes', 'E-1.md'), ['---', 'doc: roadmap_node', 'id: E-1', 'level: epic',
    `title: ${evil}`, 'drill: split', '---', ''].join('\n'))
  fs.writeFileSync(path.join(dir, 'nodes', 'T-1.md'), ['---', 'doc: roadmap_node', 'id: T-1', 'level: task',
    'parent: E-1', `title: ${evil}`, 'drill: leaf', 'ticket: "<b>ACME-1</b>"', 'status: todo', '---', ''].join('\n'))
  const html = render(dir)
  assert.ok(!/<script/i.test(html), 'page holds a <script')
  assert.ok(!/<img/i.test(html) && !/<b>/.test(html))
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;'))
  assert.ok(html.includes('<title>Roadmap: &lt;script&gt;bad()&lt;/script&gt;</title>'))
  assert.ok(!/https?:\/\//.test(html), 'page names a network URL')
  assert.ok(!/<link|<iframe|<object|<embed/i.test(html))
})
