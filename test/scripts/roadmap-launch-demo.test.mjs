// Tests for the showcase roadmap in skills/roadmap/examples/launch-demo: a made-up launch of
// 30-minute drone delivery, caught mid-drill so every view of the roadmap page has something to
// show. The docs render it, so every tool has to accept it as written.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract. Clause ids are local to this file.
//   L1 ensures: every file in the demo validates with brigade-validate, with no warning.
//   L2 ensures: `brigade-roadmap check` exits 0.
//   L3 ensures: `brigade-roadmap next` gives a non-empty batch and parks the questioned nodes.
//   L4 ensures: `brigade-roadmap-view` renders the demo with every epic, its own title in the
//      heading, a card in every board lane, and no problems section.
//   L5 ensures: the launch is mid-flight: `status` reads some requirements met and others not,
//      `links` finds every published blocker linked, and `check --complete` still reports the
//      coverage gaps, open and parked nodes, and unpublished leaves the views show.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEMO = path.join(ROOT, 'skills', 'roadmap', 'examples', 'launch-demo')
const script = (name) => path.join(ROOT, 'scripts', name)

function run(name, ...args) {
  const r = spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
  return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter(Boolean) }
}

const temps = []
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }) })

test('L1 every demo file validates cleanly', () => {
  const r = run('brigade-validate', DEMO)
  assert.equal(r.code, 0, r.out + r.err)
  assert.doesNotMatch(r.out, /^(FAIL|warn)/m, r.out)
  assert.match(r.out, /31 checked, 0 nonconforming/)
})

test('L2 check passes', () => {
  const r = run('brigade-roadmap', 'check', DEMO)
  assert.equal(r.code, 0, r.out + r.err)
  assert.deepEqual(r.lines, ['roadmap OK: 24 nodes, 10 leaves ready'])
})

test('L3 next gives a non-empty batch and parks the questioned nodes', () => {
  const r = run('brigade-roadmap', 'next', '--json', DEMO)
  assert.equal(r.code, 0, r.err)
  const j = JSON.parse(r.out)
  assert.ok(j.nodes.length > 0, r.out)
  assert.deepEqual(j.nodes.map((n) => n.id), ['F-6', 'F-9'])
  assert.deepEqual(j.parked.map((p) => [p.id, p.questions]), [['F-4', ['vendor-sandbox']], ['F-8', ['wind-source']]])
})

test('L4 the view renders the demo with every epic and no problems', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-launch-demo-'))
  temps.push(dir)
  const out = path.join(dir, 'roadmap.html')
  const r = run('brigade-roadmap-view', DEMO, '--out', out)
  assert.equal(r.code, 0, r.err)
  const html = fs.readFileSync(out, 'utf8')
  for (const title of ['Offer drone delivery at checkout', 'Get a drone airborne in two minutes',
    'Track every flight live, door to door', 'Fly safe: geofences, wind holds and landing pads']) {
    assert.ok(html.includes(title), `the page names epic "${title}"`)
  }
  assert.doesNotMatch(html, /id="problems"/)
  assert.ok(html.includes('<title>Roadmap: Acme Skyhop launches 30-minute drone delivery in two pilot cities</title>'))
  assert.ok(html.includes('<h1><span class="label">Roadmap</span> Acme Skyhop launches 30-minute drone delivery in two pilot cities</h1>'))
  // Every lane but backlog holds at least one card somewhere on the page.
  for (const name of ['Todo', 'In progress', 'In review', 'Done', 'Blocked', 'Unpublished']) {
    assert.match(html, new RegExp(`<div class="lane" aria-label="${name}"><div class="ticket`), `lane ${name} has a card`)
  }
  assert.ok(!fs.existsSync(path.join(DEMO, 'roadmap.html')), 'the demo folder gets no page written into it')
})

test('L5 the launch is mid-flight: some requirements met, blockers linked, gaps still shown', () => {
  const status = run('brigade-roadmap', 'status', DEMO)
  assert.equal(status.code, 0, status.err)
  const met = status.lines.filter((l) => /^ {2}R-\d+\s+met\b/.test(l)).map((l) => l.trim().split(/\s+/)[0])
  assert.deepEqual(met, ['R-7', 'R-8'])
  assert.ok(status.lines.some((l) => /^ {2}E-2\s+blocked\b/.test(l)), status.out)

  const links = run('brigade-roadmap', 'links', DEMO)
  assert.equal(links.code, 0, links.out + links.err)
  assert.deepEqual(links.lines, ['links OK: 12 published nodes checked'])

  const complete = run('brigade-roadmap', 'check', '--complete', DEMO)
  assert.equal(complete.code, 1, complete.out)
  const codes = complete.lines.map((l) => l.split(': ').slice(0, 2).join(': '))
  assert.deepEqual(codes, [
    'parked_node: F-4', 'open_node: F-6', 'open_node: F-8', 'open_node: F-9',
    'uncovered_inventory: I-9', 'uncovered_inventory: I-10',
    'unsatisfied_requirement: R-5', 'unsatisfied_requirement: R-6',
    'unpublished_leaf: T-9', 'unpublished_leaf: T-10',
  ])
})
