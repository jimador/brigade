// Tests for brigade-coord's path leases and hot-files report. Each test builds a throwaway
// project directory, points the real script at it with BRIGADE_PROJECT_DIR, and checks exit
// codes and JSON. Run with `node --test test/scripts/*.test.mjs`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const COORD = path.join(ROOT, 'scripts', 'brigade-coord')

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-coord-paths-'))
}

function coord(dir, ...args) {
  const r = spawnSync(process.execPath, [COORD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BRIGADE_PROJECT_DIR: dir, CLAUDE_PROJECT_DIR: '', CODEX_PROJECT_DIR: '' },
  })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    json = null
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

// Takes the dish lease and returns its owner token.
function lease(dir, dish) {
  const r = coord(dir, 'acquire', dish, 'claude')
  assert.equal(r.code, 0, r.stderr)
  return r.json.owner
}

function pathsFile(dir, dish) {
  return path.join(dir, '.brigade', 'coordination', `${dish}.paths`)
}

test('path-acquire writes the paths file, normalizes paths and merges later calls', () => {
  const dir = project()
  const owner = lease(dir, 'alpha')
  const first = coord(dir, 'path-acquire', 'alpha', owner, './src//a.js', 'src/b.js')
  assert.equal(first.code, 0, first.stderr)
  assert.deepEqual(first.json.paths, ['src/a.js', 'src/b.js'])
  const second = coord(dir, 'path-acquire', 'alpha', owner, 'docs/c.md', 'src/a.js')
  assert.equal(second.code, 0, second.stderr)
  const stored = JSON.parse(fs.readFileSync(pathsFile(dir, 'alpha'), 'utf8'))
  assert.equal(stored.schema, 1)
  assert.equal(stored.dish, 'alpha')
  assert.equal(stored.owner, owner)
  assert.deepEqual(stored.paths, ['docs/c.md', 'src/a.js', 'src/b.js'])
  assert.equal(stored.acquired_at, first.json.acquired_at)
})

test('path-acquire needs the dish lease held by the same owner (exit 2)', () => {
  const dir = project()
  assert.equal(coord(dir, 'path-acquire', 'alpha', 'claude-nobody', 'a.js').code, 2)
  lease(dir, 'alpha')
  const r = coord(dir, 'path-acquire', 'alpha', 'claude-someone-else', 'a.js')
  assert.equal(r.code, 2)
  assert.match(r.stderr, /owner mismatch/)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
})

test('a path another live dish holds is refused with exit 3 naming the holder', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  const beta = lease(dir, 'beta')
  assert.equal(coord(dir, 'path-acquire', 'alpha', alpha, 'src/shared.js', 'src/a.js').code, 0)
  const r = coord(dir, 'path-acquire', 'beta', beta, 'src/b.js', 'src/shared.js')
  assert.equal(r.code, 3)
  assert.equal(r.json.acquired, false)
  assert.deepEqual(r.json.holder, { dish: 'alpha', owner: alpha })
  assert.deepEqual(r.json.conflicts[0].paths, ['src/shared.js'])
  assert.equal(fs.existsSync(pathsFile(dir, 'beta')), false, 'a refusal takes nothing')
  // A folder lease covers the files inside it.
  assert.equal(coord(dir, 'path-acquire', 'beta', beta, 'src').code, 3)
  assert.equal(coord(dir, 'path-acquire', 'beta', beta, 'src/b.js').code, 0)
})

test('a leftover paths file whose dish has no lease never blocks', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  assert.equal(coord(dir, 'path-acquire', 'alpha', alpha, 'src/shared.js').code, 0)
  assert.equal(coord(dir, 'break', 'alpha', '--force').code, 0)
  // break archives the paths file now, so put a leftover back by hand to cover the
  // case where one survives anyway (a crash, or a file from an older script).
  fs.writeFileSync(pathsFile(dir, 'alpha'), JSON.stringify({ schema: 1, dish: 'alpha', owner: alpha, paths: ['src/shared.js'] }))
  const listed = coord(dir, 'path-list')
  assert.equal(listed.code, 0)
  assert.equal(listed.json.paths[0].live, false)
  const beta = lease(dir, 'beta')
  const r = coord(dir, 'path-acquire', 'beta', beta, 'src/shared.js')
  assert.equal(r.code, 0, r.stdout + r.stderr)
})

test('break archives the paths file next to the lease and reports where (E1)', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  assert.equal(coord(dir, 'path-acquire', 'alpha', alpha, 'src/shared.js').code, 0)
  const r = coord(dir, 'break', 'alpha', '--force')
  assert.equal(r.code, 0, r.stderr)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
  assert.equal(typeof r.json.paths_archived_at, 'string')
  assert.match(path.basename(r.json.paths_archived_at), /^alpha\.paths\.broken-[0-9TZ-]+-[0-9a-f-]{36}$/)
  const archived = JSON.parse(fs.readFileSync(r.json.paths_archived_at, 'utf8'))
  assert.equal(archived.owner, alpha)
  assert.deepEqual(archived.paths, ['src/shared.js'])
  assert.deepEqual(coord(dir, 'path-list').json, { paths: [] })
  // With no paths file, break still works and says so with null.
  lease(dir, 'alpha')
  const bare = coord(dir, 'break', 'alpha', '--force')
  assert.equal(bare.code, 0, bare.stderr)
  assert.equal(bare.json.paths_archived_at, null)
})

test('break refuses with exit 5 and changes nothing while the paths mutex is busy (E1)', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  assert.equal(coord(dir, 'path-acquire', 'alpha', alpha, 'a.js').code, 0)
  const pathsMutex = path.join(dir, '.brigade', 'coordination', 'paths.mutex')
  fs.mkdirSync(pathsMutex)
  const r = coord(dir, 'break', 'alpha', '--force')
  assert.equal(r.code, 5)
  assert.equal(coord(dir, 'status', 'alpha').json.held, true)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), true)
  assert.equal(fs.existsSync(path.join(dir, '.brigade', 'coordination', 'alpha.mutex')), false,
    'the dish mutex is not left behind')
  fs.rmdirSync(pathsMutex)
  assert.equal(coord(dir, 'break', 'alpha', '--force').code, 0)
})

test('a broken and reacquired lease does not revive the old owner\'s paths (E1, E2)', () => {
  const dir = project()
  const tokA = lease(dir, 'alpha')
  assert.equal(coord(dir, 'path-acquire', 'alpha', tokA, 'src/shared.js').code, 0)
  assert.equal(coord(dir, 'break', 'alpha', '--force').code, 0)
  const tokB = lease(dir, 'alpha')
  assert.notEqual(tokA, tokB)
  const beta = lease(dir, 'beta')
  const r = coord(dir, 'path-acquire', 'beta', beta, 'src/shared.js')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  // The new owner's own claims still block.
  assert.equal(coord(dir, 'path-acquire', 'alpha', tokB, 'src/other.js').code, 0)
  assert.equal(coord(dir, 'path-acquire', 'beta', beta, 'src/other.js').code, 3)
})

test('a stale record from a previous owner is ignored and the new owner can clear it (E2, E3)', () => {
  const dir = project()
  const tokA = lease(dir, 'alpha')
  assert.equal(coord(dir, 'break', 'alpha', '--force').code, 0)
  const tokB = lease(dir, 'alpha')
  fs.writeFileSync(pathsFile(dir, 'alpha'), JSON.stringify({ schema: 1, dish: 'alpha', owner: tokA, paths: ['src/shared.js'] }))
  const beta = lease(dir, 'beta')
  const r = coord(dir, 'path-acquire', 'beta', beta, 'src/shared.js')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  // A stranger still cannot clear it.
  assert.equal(coord(dir, 'path-release', 'alpha', 'claude-someone-else').code, 2)
  const released = coord(dir, 'path-release', 'alpha', tokB)
  assert.equal(released.code, 0, released.stderr)
  assert.equal(released.json.released, true)
  assert.equal(released.json.owner, tokB)
  assert.equal(released.json.previous_owner, tokA)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
})

test('path-list reports every dish with owner, paths, time and liveness', () => {
  const dir = project()
  assert.deepEqual(coord(dir, 'path-list').json, { paths: [] })
  const alpha = lease(dir, 'alpha')
  coord(dir, 'path-acquire', 'alpha', alpha, 'a.js')
  const r = coord(dir, 'path-list')
  assert.equal(r.code, 0)
  const [entry] = r.json.paths
  assert.equal(entry.dish, 'alpha')
  assert.equal(entry.owner, alpha)
  assert.deepEqual(entry.paths, ['a.js'])
  assert.equal(typeof entry.acquired_at, 'string')
  assert.equal(entry.live, true)
})

test('path-release deletes the file, refuses the wrong owner and reports a missing one', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  assert.equal(coord(dir, 'path-release', 'alpha', alpha).code, 4)
  coord(dir, 'path-acquire', 'alpha', alpha, 'a.js')
  assert.equal(coord(dir, 'path-release', 'alpha', 'claude-someone-else').code, 2)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), true)
  const r = coord(dir, 'path-release', 'alpha', alpha)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.json.released, true)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
  assert.equal(coord(dir, 'path-release', 'alpha', alpha).code, 4)
})

test('release drops the path leases with the dish lease', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  coord(dir, 'path-acquire', 'alpha', alpha, 'a.js')
  const r = coord(dir, 'release', 'alpha', alpha)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.json.paths_released, true)
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
})

test('absolute paths and .. segments are refused with exit 1', () => {
  const dir = project()
  const alpha = lease(dir, 'alpha')
  for (const bad of ['/etc/passwd', '../outside.js', 'src/../../x', 'src/..', '.', '']) {
    const r = coord(dir, 'path-acquire', 'alpha', alpha, 'ok.js', bad)
    assert.equal(r.code, 1, `expected exit 1 for ${JSON.stringify(bad)}`)
  }
  assert.equal(fs.existsSync(pathsFile(dir, 'alpha')), false)
})

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function commit(dir, message, files) {
  for (const f of files) {
    const abs = path.join(dir, f)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.appendFileSync(abs, `${message}\n`)
  }
  git(dir, 'add', '--', ...files)
  git(dir, 'commit', '-q', '-m', message)
}

function plan(dir, slug, branch) {
  const file = path.join(dir, '.brigade', 'dishes', slug, 'PLAN.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\ndoc: plan\ndish: ${slug}\ndelivery_branch: ${branch}\nitems: []\n---\n`)
}

test('hot-files counts distinct dishes per path from merge subjects and landed branches', () => {
  const dir = project()
  git(dir, 'init', '-q', '-b', 'trunk')
  fs.mkdirSync(path.join(dir, '.brigade'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.brigade', 'config.md'), '## Repo\n\n- main_branch: trunk\n')
  commit(dir, 'base', ['README.md', 'src/shared.js'])
  plan(dir, 'dish-a', 'feat/a')
  plan(dir, 'dish-b', 'feat/b')

  // dish-a lands through a merge commit that names its branch.
  git(dir, 'checkout', '-q', '-b', 'feat/a')
  commit(dir, 'a work', ['src/shared.js', 'src/a.js'])
  git(dir, 'checkout', '-q', 'trunk')
  git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'feat/a')
  git(dir, 'branch', '-q', '-D', 'feat/a')

  // dish-b fast-forwards, so only its branch's reflog ties its commits to it.
  git(dir, 'checkout', '-q', '-b', 'feat/b')
  commit(dir, 'b work', ['src/shared.js', 'src/b.js'])
  git(dir, 'checkout', '-q', 'trunk')
  git(dir, 'merge', '-q', '--ff-only', 'feat/b')

  // A commit no dish can claim is counted as unmapped, never as a dish.
  commit(dir, 'ACME-12 tidy shared', ['src/shared.js', 'src/a.js'])

  const r = coord(dir, 'hot-files', '--min', '2', '--json')
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.json.main_branch, 'trunk')
  assert.deepEqual(r.json.mapped_dishes, ['dish-a', 'dish-b'])
  // The base commit and the ACME-12 commit belong to no dish.
  assert.equal(r.json.unmapped_commits, 2)
  assert.equal(r.json.unknown_tickets, 1)
  assert.deepEqual(r.json.hot_files, [
    { path: 'src/shared.js', dish_count: 2, dishes: ['dish-a', 'dish-b'] },
  ])

  // The default threshold of 3 dishes leaves nothing hot here.
  const quiet = coord(dir, 'hot-files', '--json')
  assert.equal(quiet.code, 0, quiet.stderr)
  assert.deepEqual(quiet.json.hot_files, [])

  const text = coord(dir, 'hot-files', '--min', '2')
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /^2\tsrc\/shared\.js\tdish-a,dish-b$/m)
  assert.match(text.stdout, /hot-files: 1 path\(s\)/)

  assert.equal(coord(dir, 'hot-files', '--days', 'soon').code, 1)
})
