// Tests for the stale-worktree listing in brigade-status. Each test builds a throwaway git repo
// with real `git worktree add` worktrees under .brigade/worktrees/ and runs the real script.
// Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (brigade-status, stale worktrees). Clause ids are local to this file.
//   R1 requires: only directories directly under .brigade/worktrees/ are considered.
//   E1 ensures: a name containing `--` is an item worktree (item slug after the last `--`, delivery
//      slug before). Stale `item done` when a dish whose delivery_branch ends with /<delivery-slug>
//      (or equals it) lists the item as done; `dish finished` when that dish lists every item as
//      done; `no dish` when no dish matches. `item done` is checked before `dish finished`.
//   E2 ensures: a name without `--` is a delivery worktree: stale `dish finished` when its dish has
//      every item done, `no dish` when none matches.
//   E3 ensures: each entry reports branch (or `?` when not a git worktree), dirty (yes when status
//      prints anything or when not a git worktree) and merged (HEAD is an ancestor of the config's
//      main_branch, default main).
//   E4 ensures: cleanup is `git worktree remove .brigade/worktrees/<name>` only when dirty is no and
//      merged is yes; otherwise no text line and null in JSON.
//   E5 ensures: text prints `## stale worktrees` after `## worktrees` only when the list is
//      non-empty; --json has stale_worktrees [{name, path, reason, branch, dirty, merged, cleanup}],
//      [] when none.
//   I1 invariant: the worktrees key and `## worktrees` section are unchanged; a live worktree is
//      never listed.
//   I2 invariant: text mode works without jq; nothing is removed or modified.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATUS = path.join(ROOT, 'scripts', 'brigade-status')
const CLEANUP = 'git worktree ' + 'remove'

// Every temp folder a test makes, deleted once the file's tests finish.
const temps = []
after(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }) })

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of ['BRIGADE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]
  return env
}

function git(cwd, ...args) {
  const r = spawnSync('git', [
    '-c', 'user.name=alex', '-c', 'user.email=alex@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { cwd, encoding: 'utf8', env: cleanEnv() })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

function plan(branch, items) {
  const rows = Object.entries(items).map(([slug, status]) => `  - { slug: ${slug}, status: ${status} }`)
  return `---\ndish: demo\ndelivery_branch: ${branch}\nitems:\n${rows.join('\n')}\n---\n\n# Plan\n`
}

// Builds a repo with one commit on main, .brigade/ excluded, and the given dishes.
function fixture({ dishes = {}, mainBranch = 'main' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-stale-')))
  temps.push(dir)
  git(dir, '-c', 'init.defaultBranch=main', 'init', '-q')
  fs.writeFileSync(path.join(dir, 'README.md'), 'demo\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-q', '-m', 'init')
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.brigade/\n')
  fs.mkdirSync(path.join(dir, '.brigade', 'worktrees'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.brigade', 'config.md'), `# Brigade\n\n## Repo\n\n- main_branch: ${mainBranch}\n`)
  for (const [name, text] of Object.entries(dishes)) {
    fs.mkdirSync(path.join(dir, '.brigade', 'dishes', name), { recursive: true })
    fs.writeFileSync(path.join(dir, '.brigade', 'dishes', name, 'PLAN.md'), text)
  }
  return dir
}

function addWorktree(dir, name, branch, base = 'main') {
  git(dir, 'worktree', 'add', '-q', `.brigade/worktrees/${name}`, '-b', branch, base)
  return path.join(dir, '.brigade', 'worktrees', name)
}

function run(dir, json = false, extraEnv = {}) {
  const r = spawnSync('bash', [STATUS, ...(json ? ['--json'] : [])], {
    encoding: 'utf8', env: cleanEnv({ CLAUDE_PROJECT_DIR: dir, ...extraEnv }),
  })
  assert.equal(r.status, 0, r.stderr)
  return json ? JSON.parse(r.stdout) : r.stdout
}

function staleByName(dir) {
  return Object.fromEntries(run(dir, true).stale_worktrees.map((e) => [e.name, e]))
}

function section(text, heading) {
  const lines = text.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).filter(Boolean)
}

test('R1: only directories directly under .brigade/worktrees are considered', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'todo' }) } })
  const live = addWorktree(dir, 'demo--beta', 'wip/demo/beta')
  fs.writeFileSync(path.join(dir, '.brigade', 'worktrees', 'other--file'), 'not a directory\n')
  fs.mkdirSync(path.join(live, 'nested--deep'))
  assert.deepEqual(run(dir, true).stale_worktrees, [])
  assert.equal(section(run(dir), '## stale worktrees'), null)
})

test('E1: item worktrees are stale for item done, dish finished or no dish, item done first', () => {
  const dir = fixture({
    dishes: {
      demo: plan('feat/demo', { alpha: 'done', beta: 'done' }),
      pair: plan('fix/a--b', { gamma: 'done', delta: 'todo' }),
    },
  })
  addWorktree(dir, 'demo--alpha', 'wip/demo/alpha')
  addWorktree(dir, 'demo--omega', 'wip/demo/omega')
  addWorktree(dir, 'nodish--alpha', 'wip/nodish/alpha')
  addWorktree(dir, 'a--b--gamma', 'wip/a--b/gamma')
  const stale = staleByName(dir)
  assert.equal(stale['demo--alpha'].reason, 'item done')
  assert.equal(stale['demo--omega'].reason, 'dish finished')
  assert.equal(stale['nodish--alpha'].reason, 'no dish')
  assert.equal(stale['a--b--gamma'].reason, 'item done')
  assert.equal(Object.keys(stale).length, 4)
})

test('E2: delivery worktrees are stale for dish finished or no dish', () => {
  const dir = fixture({
    dishes: {
      demo: plan('feat/demo', { alpha: 'done', beta: 'done' }),
      live: plan('feat/live', { gamma: 'todo' }),
    },
  })
  addWorktree(dir, 'demo', 'feat/demo')
  addWorktree(dir, 'ghost', 'feat/ghost')
  addWorktree(dir, 'live', 'feat/live')
  const stale = staleByName(dir)
  assert.equal(stale.demo.reason, 'dish finished')
  assert.equal(stale.ghost.reason, 'no dish')
  assert.equal(stale.live, undefined)
})

test('E3: branch, dirty and merged come from git, with the main branch read from config', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'done', gamma: 'done' }) }, mainBranch: 'trunk' })
  git(dir, 'branch', 'trunk', 'main')
  const alpha = addWorktree(dir, 'demo--alpha', 'wip/demo/alpha', 'trunk')
  const beta = addWorktree(dir, 'demo--beta', 'wip/demo/beta', 'trunk')
  addWorktree(dir, 'demo--gamma', 'wip/demo/gamma', 'trunk')
  fs.writeFileSync(path.join(alpha, 'scratch.txt'), 'uncommitted\n')
  fs.writeFileSync(path.join(beta, 'b.txt'), 'b\n')
  git(beta, 'add', 'b.txt')
  git(beta, 'commit', '-q', '-m', 'unmerged work')
  fs.mkdirSync(path.join(dir, '.brigade', 'worktrees', 'demo--plain'))
  let stale = staleByName(dir)
  assert.deepEqual([stale['demo--alpha'].branch, stale['demo--alpha'].dirty, stale['demo--alpha'].merged], ['wip/demo/alpha', true, true])
  assert.deepEqual([stale['demo--beta'].branch, stale['demo--beta'].dirty, stale['demo--beta'].merged], ['wip/demo/beta', false, false])
  assert.deepEqual([stale['demo--gamma'].branch, stale['demo--gamma'].dirty, stale['demo--gamma'].merged], ['wip/demo/gamma', false, true])
  assert.deepEqual([stale['demo--plain'].branch, stale['demo--plain'].dirty, stale['demo--plain'].merged], ['?', true, false])
  // Point main_branch at a branch that does not contain gamma's base commit chain: merged turns no.
  git(dir, 'checkout', '-q', '--orphan', 'island')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'unrelated root')
  git(dir, 'checkout', '-q', 'main')
  fs.writeFileSync(path.join(dir, '.brigade', 'config.md'), '# Brigade\n\n## Repo\n\n- main_branch: island\n')
  stale = staleByName(dir)
  assert.equal(stale['demo--gamma'].merged, false)
})

test('E4: the cleanup command appears only for clean, merged worktrees', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'done', gamma: 'done' }) } })
  addWorktree(dir, 'demo--alpha', 'wip/demo/alpha')
  const beta = addWorktree(dir, 'demo--beta', 'wip/demo/beta')
  const gamma = addWorktree(dir, 'demo--gamma', 'wip/demo/gamma')
  fs.writeFileSync(path.join(beta, 'scratch.txt'), 'uncommitted\n')
  fs.writeFileSync(path.join(gamma, 'g.txt'), 'g\n')
  git(gamma, 'add', 'g.txt')
  git(gamma, 'commit', '-q', '-m', 'unmerged work')
  const stale = staleByName(dir)
  assert.equal(stale['demo--alpha'].cleanup, `${CLEANUP} .brigade/worktrees/demo--alpha`)
  assert.equal(stale['demo--beta'].cleanup, null)
  assert.equal(stale['demo--gamma'].cleanup, null)
  const cleanups = section(run(dir), '## stale worktrees').filter((l) => l.includes('cleanup:'))
  assert.deepEqual(cleanups, [`    cleanup: ${CLEANUP} .brigade/worktrees/demo--alpha`])
})

test('E5: text section follows ## worktrees in the stated format; JSON shape; empty when none', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'todo' }) } })
  addWorktree(dir, 'demo--alpha', 'wip/demo/alpha')
  addWorktree(dir, 'demo--beta', 'wip/demo/beta')
  const text = run(dir)
  const lines = text.split('\n')
  assert.equal(lines.indexOf('## stale worktrees'), lines.indexOf('## worktrees') + 3)
  assert.deepEqual(section(text, '## stale worktrees'), [
    '  .brigade/worktrees/demo--alpha  reason: item done  branch: wip/demo/alpha  dirty: no  merged: yes',
    `    cleanup: ${CLEANUP} .brigade/worktrees/demo--alpha`,
  ])
  assert.deepEqual(run(dir, true).stale_worktrees, [{
    name: 'demo--alpha', path: '.brigade/worktrees/demo--alpha', reason: 'item done',
    branch: 'wip/demo/alpha', dirty: false, merged: true,
    cleanup: `${CLEANUP} .brigade/worktrees/demo--alpha`,
  }])

  const empty = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'todo' }) } })
  addWorktree(empty, 'demo--alpha', 'wip/demo/alpha')
  assert.equal(section(run(empty), '## stale worktrees'), null)
  assert.deepEqual(run(empty, true).stale_worktrees, [])
})

test('I1: the worktrees key and section are unchanged and live worktrees are never listed', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'todo' }) } })
  addWorktree(dir, 'demo', 'feat/demo')
  addWorktree(dir, 'demo--alpha', 'wip/demo/alpha')
  addWorktree(dir, 'demo--beta', 'wip/demo/beta')
  const out = run(dir, true)
  assert.deepEqual(out.worktrees, ['demo', 'demo--alpha', 'demo--beta'])
  assert.deepEqual(out.stale_worktrees.map((e) => e.name), ['demo--alpha'])
  assert.deepEqual(section(run(dir), '## worktrees'), ['  demo', '  demo--alpha', '  demo--beta'])
})

test('I2: text mode never calls jq, and neither mode changes or removes anything', () => {
  const dir = fixture({ dishes: { demo: plan('feat/demo', { alpha: 'done', beta: 'done' }) } })
  addWorktree(dir, 'demo--alpha', 'wip/demo/alpha')
  const beta = addWorktree(dir, 'demo--beta', 'wip/demo/beta')
  fs.writeFileSync(path.join(beta, 'scratch.txt'), 'uncommitted\n')
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-nojq-'))
  temps.push(shim)
  const marker = path.join(shim, 'called')
  fs.writeFileSync(path.join(shim, 'jq'), `#!/bin/sh\necho called >> "${marker}"\nexit 127\n`, { mode: 0o755 })

  const snapshot = () => ({
    list: git(dir, 'worktree', 'list', '--porcelain'),
    main: git(dir, 'status', '--porcelain'),
    beta: git(beta, 'status', '--porcelain'),
    refs: git(dir, 'for-each-ref'),
    dirs: fs.readdirSync(path.join(dir, '.brigade', 'worktrees')),
  })
  const before = snapshot()
  const text = run(dir, false, { PATH: `${shim}:${process.env.PATH}` })
  assert.match(text, /## stale worktrees/)
  assert.equal(fs.existsSync(marker), false)
  run(dir, true)
  assert.deepEqual(snapshot(), before)
})
