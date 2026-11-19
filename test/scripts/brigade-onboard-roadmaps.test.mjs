// Tests for the roadmap side of brigade-onboard: a repo whose only open work is a roadmap still
// counts as having work to upgrade, and `stale-pages` lists the generated pages an older plugin
// version drew. Each test runs the real script against a throwaway repo folder.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (brigade-onboard roadmaps and stale-pages). Clause ids are local to this file.
//   E1 ensures: a repo with only `<roadmap_dir>/<slug>/ROADMAP.md` reports the pending ledger
//      entries that touch work; roadmap_dir comes from the `## Repo` section of .brigade/config.md
//      (a trailing comment ignored), default .brigade/roadmaps; a folder without ROADMAP.md is no
//      roadmap.
//   E2 ensures: `stale-pages` lists roadmap.html in each roadmap folder and plan.html in each dish
//      whose generator stamp is missing or names another version, each with a command that redraws
//      it from the repo root; a page with the current stamp is not listed; exit 0 always.
//   I1 invariant: a repo with no roadmaps, dishes or board reports no work drift and no stale pages.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ONBOARD = path.join(ROOT, 'scripts', 'brigade-onboard')
const ROADMAP_FIXTURE = path.join(ROOT, 'test', 'scripts', 'fixtures', 'roadmap', 'valid')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-roadmaps-'))

// Runs brigade-onboard in `repo`. With `plugRoot` it reads that fake plugin instead of this one.
function onboard(repo, args, plugRoot) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo }
  delete env.BRIGADE_PLUGIN_ROOT
  if (plugRoot) env.BRIGADE_PLUGIN_ROOT = plugRoot
  return spawnSync(process.execPath, [ONBOARD, ...args], { encoding: 'utf8', env })
}

// A fake plugin at 2.0.0 whose ledger has one entry touching roadmaps.
function fakePlugin() {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.claude-plugin'))
  fs.mkdirSync(path.join(dir, 'skills', 'onboard'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{ "version": "2.0.0" }\n')
  fs.writeFileSync(path.join(dir, 'skills', 'onboard', 'UPGRADES.md'),
    '## Ledger\n\n### 2.0.0\n\n- touches: dishes, roadmaps\n\n### 1.0.0\n\n- touches: none\n')
  return dir
}

const status = (repo, plugRoot) => {
  const r = onboard(repo, ['status', '--json'], plugRoot)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const stale = (repo) => {
  const r = onboard(repo, ['stale-pages', '--json'])
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout).stale_pages
}

test('I1: a repo with no work has no work drift and no stale pages', () => {
  const repo = tmp()
  const doc = status(repo, fakePlugin())
  assert.equal(doc.work_drift, false)
  assert.deepEqual(doc.work_upgrades_pending, [])
  assert.deepEqual(stale(repo), [])
  const plain = onboard(repo, ['stale-pages'])
  assert.equal(plain.status, 0)
  assert.match(plain.stdout, /no stale pages/)
})

test('E1: a roadmap under the default roadmap dir is work to upgrade', () => {
  const repo = tmp()
  const plug = fakePlugin()
  fs.mkdirSync(path.join(repo, '.brigade', 'roadmaps', 'empty'), { recursive: true })
  assert.equal(status(repo, plug).work_drift, false, 'a folder without ROADMAP.md is no roadmap')
  fs.cpSync(ROADMAP_FIXTURE, path.join(repo, '.brigade', 'roadmaps', 'demo'), { recursive: true })
  const doc = status(repo, plug)
  assert.equal(doc.work_drift, true)
  assert.deepEqual(doc.work_upgrades_pending, ['2.0.0'])
})

test('E1: roadmap_dir from the config Repo section moves where roadmaps are looked for', () => {
  const repo = tmp()
  fs.mkdirSync(path.join(repo, '.brigade'))
  fs.writeFileSync(path.join(repo, '.brigade', 'config.md'),
    '# Config\n\n## Board\n\n- roadmap_dir: wrong/place\n\n## Repo\n\n- main_branch: main\n'
    + '- roadmap_dir: plans/roadmaps  # where /brigade:roadmap keeps its files\n')
  fs.cpSync(ROADMAP_FIXTURE, path.join(repo, 'plans', 'roadmaps', 'demo'), { recursive: true })
  fs.cpSync(ROADMAP_FIXTURE, path.join(repo, '.brigade', 'roadmaps', 'ignored'), { recursive: true })
  const view = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brigade-roadmap-view'),
    path.join(repo, 'plans', 'roadmaps', 'demo')], { encoding: 'utf8' })
  assert.equal(view.status, 0, view.stderr)
  const html = path.join(repo, 'plans', 'roadmaps', 'demo', 'roadmap.html')
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/<meta name="generator"[^>]*>\n/, ''))
  fs.cpSync(path.join(repo, 'plans', 'roadmaps', 'demo', 'roadmap.html'),
    path.join(repo, '.brigade', 'roadmaps', 'ignored', 'roadmap.html'))
  assert.deepEqual(stale(repo).map((p) => p.page), [path.join('plans', 'roadmaps', 'demo', 'roadmap.html')])
})

test('E2: pages without the current stamp are listed with a command that redraws them', () => {
  const repo = tmp()
  const roadmaps = path.join(repo, '.brigade', 'roadmaps')
  fs.cpSync(ROADMAP_FIXTURE, path.join(roadmaps, 'old'), { recursive: true })
  fs.cpSync(ROADMAP_FIXTURE, path.join(roadmaps, 'fresh'), { recursive: true })
  fs.cpSync(ROADMAP_FIXTURE, path.join(roadmaps, 'unrendered'), { recursive: true })
  fs.writeFileSync(path.join(roadmaps, 'old', 'roadmap.html'), '<!doctype html>\n<html><head><title>old</title></head></html>\n')
  fs.writeFileSync(path.join(roadmaps, 'fresh', 'roadmap.html'),
    `<!doctype html>\n<html><head><meta name="generator" content="brigade-roadmap-view ${VERSION}"></head></html>\n`)
  const dish = path.join(repo, '.brigade', 'dishes', 'soup')
  fs.mkdirSync(dish, { recursive: true })
  fs.writeFileSync(path.join(dish, 'PLAN.md'), '---\ndish: soup\nitems:\n  - { slug: alpha, status: todo, depends_on: [], files: [a.js], attempts: [] }\n---\n')
  fs.writeFileSync(path.join(dish, 'plan.html'),
    '<!doctype html>\n<html><head><meta name="generator" content="brigade-plan-view 0.0.1"></head></html>\n')

  const pages = stale(repo)
  assert.deepEqual(pages.map((p) => [p.kind, p.page, p.stamp]), [
    ['roadmap', path.join('.brigade', 'roadmaps', 'old', 'roadmap.html'), null],
    ['plan', path.join('.brigade', 'dishes', 'soup', 'plan.html'), 'brigade-plan-view 0.0.1'],
  ])

  // Every listed command, run from the repo root, redraws its page with the current stamp.
  for (const p of pages) {
    const r = spawnSync('/bin/sh', ['-c', p.command], { cwd: repo, encoding: 'utf8' })
    assert.equal(r.status, 0, `${p.command}: ${r.stderr}`)
    const expected = `${p.kind === 'roadmap' ? 'brigade-roadmap-view' : 'brigade-plan-view'} ${VERSION}`
    assert.ok(fs.readFileSync(path.join(repo, p.page), 'utf8').includes(`<meta name="generator" content="${expected}">`))
  }
  assert.deepEqual(stale(repo), [])
})
