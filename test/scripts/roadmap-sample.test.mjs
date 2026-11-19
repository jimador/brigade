// Tests for the shipped sample roadmap in skills/roadmap/examples/migration-sample: a Node app
// whose data lives in a cloud warehouse, moving to Postgres in a VM on one bare-metal host. The
// sample is what the roadmap skill points people at, so every tool has to accept it as written.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract. Clause ids are local to this file.
//   S1 ensures: every file in the sample validates with brigade-validate, with no warning.
//   S2 ensures: `brigade-roadmap check` exits 0; `check --complete` lists only the sample's two
//      open features and the two accepted requirements they still owe.
//   S3 ensures: `brigade-roadmap next` gives a non-empty batch and parks the node the open
//      question names.
//   S4 ensures: `brigade-roadmap-view` renders the sample with no problems section.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = path.join(ROOT, 'skills', 'roadmap', 'examples', 'migration-sample')
const script = (name) => path.join(ROOT, 'scripts', name)

function run(name, ...args) {
  const r = spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
  return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter(Boolean) }
}

const temps = []
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }) })

test('S1 every sample file validates cleanly', () => {
  const r = run('brigade-validate', SAMPLE)
  assert.equal(r.code, 0, r.out + r.err)
  assert.doesNotMatch(r.out, /^(FAIL|warn)/m, r.out)
  assert.match(r.out, /20 checked, 0 nonconforming/)
})

test('S2 check passes, and check --complete lists only the expected open items', () => {
  const r = run('brigade-roadmap', 'check', SAMPLE)
  assert.equal(r.code, 0, r.out + r.err)
  assert.deepEqual(r.lines, ['roadmap OK: 13 nodes, 5 leaves ready'])

  const c = run('brigade-roadmap', 'check', '--json', '--complete', SAMPLE)
  assert.equal(c.code, 1, c.out + c.err)
  assert.deepEqual(JSON.parse(c.out).problems.map((p) => [p.code, p.id]), [
    ['open_node', 'F-3'], ['open_node', 'F-5'],
    ['unsatisfied_requirement', 'R-2'], ['unsatisfied_requirement', 'R-4'],
  ])
})

test('S3 next gives a non-empty batch and parks the questioned node', () => {
  const r = run('brigade-roadmap', 'next', '--json', SAMPLE)
  assert.equal(r.code, 0, r.err)
  const j = JSON.parse(r.out)
  assert.ok(j.nodes.length > 0, r.out)
  assert.deepEqual(j.nodes.map((n) => n.id), ['F-3'])
  assert.deepEqual(j.parked, [{ id: 'F-5', title: 'Back up and restore the host', questions: ['backup-target'] }])
})

test('S4 the view renders the sample with no problems', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-sample-'))
  temps.push(dir)
  const out = path.join(dir, 'roadmap.html')
  const r = run('brigade-roadmap-view', SAMPLE, '--out', out)
  assert.equal(r.code, 0, r.err)
  const html = fs.readFileSync(out, 'utf8')
  for (const title of ['Preserve application behavior', 'Deliver object-storage data to Postgres', 'Operate on one host']) {
    assert.ok(html.includes(title), `the page names epic "${title}"`)
  }
  assert.doesNotMatch(html, /id="problems"/)
  assert.ok(!fs.existsSync(path.join(SAMPLE, 'roadmap.html')), 'the sample folder gets no page written into it')
})
