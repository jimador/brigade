// Tests for brigade-scope (C3). Each test builds a throwaway git repo with a base commit on
// `main` and a work branch, writes a PLAN.md whose frontmatter lists the items, and runs the
// real script in that repo. Run with `node --test test/scripts/*.test.mjs`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCOPE = path.join(ROOT, 'scripts', 'brigade-scope')

function git(cwd, args) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function writeFile(root, rel, body = 'x\n') {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
}

// Builds a repo: `main` holds the base commit with `baseFiles`; branch `work` renames each
// `[from, to]` in `renames` with git mv, then commits `changes` (paths, each written with
// content). HEAD ends on `work`.
function makeRepo({ baseFiles = ['README.md'], changes = [], renames = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-scope-'))
  git(root, ['init', '-q', '-b', 'main'])
  for (const f of baseFiles) writeFile(root, f)
  git(root, ['add', '--', ...baseFiles])
  git(root, ['commit', '-q', '-m', 'base'])
  git(root, ['checkout', '-q', '-b', 'work'])
  for (const [from, to] of renames) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
    git(root, ['mv', '--', from, to])
  }
  for (const f of changes) writeFile(root, f, `changed ${f}\n`)
  if (changes.length > 0) git(root, ['add', '--', ...changes])
  git(root, ['commit', '-q', '-m', 'work'])
  return root
}

function writePlan(root, items) {
  const lines = ['---', 'doc: plan', 'schema: 1', 'dish: scope-test', 'delivery_branch: main', 'items:']
  for (const it of items) {
    const parts = [`slug: ${it.slug}`, 'status: todo', 'depends_on: []', 'heavy: false']
    if (it.contract) parts.push('contract: true')
    parts.push(`files: [${it.files.join(', ')}]`)
    lines.push(`  - { ${parts.join(', ')} }`)
  }
  lines.push('---', '', '## Dish', '', 'Fixture plan.', '')
  const planPath = path.join(root, 'PLAN.md')
  fs.writeFileSync(planPath, lines.join('\n'))
  return planPath
}

function runScope(root, args) {
  return spawnSync(process.execPath, [SCOPE, ...args], { cwd: root, encoding: 'utf8' })
}

const ITEMS = [
  { slug: 'mine', files: ['scripts/mine', 'test/scripts/mine.test.mjs'] },
  { slug: 'contract-x', contract: true, files: ['scripts/lib/x.mjs', 'hooks/board/'] },
]

test('clean: every changed path is within the item files', () => {
  const root = makeRepo({ changes: ['scripts/mine', 'test/scripts/mine.test.mjs'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, [plan, 'mine'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'scope OK: 2 changed files within mine\n')
})

test('out of scope: a changed path outside the item files exits 1 and names it', () => {
  const root = makeRepo({ changes: ['scripts/mine', 'docs/stray.md'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, [plan, 'mine'])
  assert.equal(r.status, 1)
  assert.equal(r.stdout, 'out of scope: docs/stray.md\n')
})

test('contract-owned: a path owned by another contract item is reported with its owner', () => {
  const root = makeRepo({ changes: ['scripts/mine', 'scripts/lib/x.mjs'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, [plan, 'mine'])
  assert.equal(r.status, 1)
  assert.equal(r.stdout, 'out of scope: scripts/lib/x.mjs\ncontract-owned: scripts/lib/x.mjs (owned by contract-x)\n')
})

test('directory entries: a trailing slash allows and protects every path under it', () => {
  // `hooks/board/` is protected by the contract item, so a change there is contract-owned
  // even though the packet below would otherwise have a directory allowance.
  const rootA = makeRepo({ changes: ['hooks/board/fleet.mjs'] })
  const planA = writePlan(rootA, [
    { slug: 'mine', files: ['hooks/'] },
    { slug: 'contract-x', contract: true, files: ['hooks/board/'] },
  ])
  const rA = runScope(rootA, [planA, 'mine', '--json'])
  assert.equal(rA.status, 1)
  const a = JSON.parse(rA.stdout)
  assert.deepEqual(a.outOfScope, [])
  assert.deepEqual(a.contractOwned, [{ path: 'hooks/board/fleet.mjs', owner: 'contract-x' }])

  // A directory entry allows nested paths; a sibling without the trailing slash does not match.
  const rootB = makeRepo({ changes: ['scripts/tools/a.sh', 'scripts/tools-extra'] })
  const planB = writePlan(rootB, [{ slug: 'mine', files: ['scripts/tools/'] }])
  const rB = runScope(rootB, [planB, 'mine', '--json'])
  assert.equal(rB.status, 1)
  const b = JSON.parse(rB.stdout)
  assert.deepEqual(b.outOfScope, ['scripts/tools-extra'])
})

test('B1 rename out of a contract directory: the old path is listed and contract-owned', () => {
  // `git mv` out of tests/contract/ must not hide the contract path behind the new name.
  const root = makeRepo({
    baseFiles: ['README.md', 'tests/contract/c.test.mjs'],
    renames: [['tests/contract/c.test.mjs', 'src/c.test.mjs']],
  })
  const plan = writePlan(root, [
    { slug: 'mine', files: ['src/'] },
    { slug: 'contract-x', contract: true, files: ['tests/contract/'] },
  ])
  const r = runScope(root, [plan, 'mine', '--json'])
  assert.equal(r.status, 1, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.changed, ['src/c.test.mjs', 'tests/contract/c.test.mjs'])
  assert.deepEqual(out.contractOwned, [{ path: 'tests/contract/c.test.mjs', owner: 'contract-x' }])

  const text = runScope(root, [plan, 'mine'])
  assert.equal(text.status, 1)
  assert.match(text.stdout, /^contract-owned: tests\/contract\/c\.test\.mjs \(owned by contract-x\)$/m)
})

test('H1 a ./ or repeated-slash contract entry protects its directory', () => {
  const root = makeRepo({
    baseFiles: ['README.md', 'tests/contract/keep.mjs'],
    changes: ['tests/contract/keep.mjs'],
  })
  const mine = { slug: 'mine', files: ['tests/contract/keep.mjs'] }
  for (const entry of ['./tests/contract/', 'tests//contract/', './tests//contract/']) {
    const plan = writePlan(root, [mine, { slug: 'contract-x', contract: true, files: [entry] }])
    const r = runScope(root, [plan, 'mine', '--json'])
    assert.equal(r.status, 1, `entry ${entry}: ${r.stderr}`)
    const out = JSON.parse(r.stdout)
    assert.deepEqual(out.contractOwned, [{ path: 'tests/contract/keep.mjs', owner: 'contract-x' }], entry)
  }
})

test('H1 a ./ allowed entry allows paths under it', () => {
  const root = makeRepo({ changes: ['src/a.js'] })
  const plan = writePlan(root, [{ slug: 'mine', files: ['./src/'] }])
  const r = runScope(root, [plan, 'mine'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout, 'scope OK: 1 changed files within mine\n')
})

test('H1 follow-up: a directory contract entry without a trailing slash warns, exit code unchanged', () => {
  const warning = 'warning: contract entry tests/contract is a directory; write it as tests/contract/ to protect its contents\n'
  const baseFiles = ['README.md', 'tests/contract/keep.mjs', 'scripts/lib/x.mjs']

  // Clean scope: warning on stderr, exit 0.
  const rootA = makeRepo({ baseFiles, changes: ['scripts/mine'] })
  const planA = writePlan(rootA, [
    { slug: 'mine', files: ['scripts/mine'] },
    { slug: 'contract-x', contract: true, files: ['tests/contract'] },
  ])
  const rA = runScope(rootA, [planA, 'mine'])
  assert.equal(rA.status, 0, rA.stderr)
  assert.equal(rA.stderr, warning)
  assert.equal(rA.stdout, 'scope OK: 1 changed files within mine\n')

  // Violations present: warning still on stderr, exit 1 unchanged.
  const rootB = makeRepo({ baseFiles, changes: ['tests/contract/keep.mjs'] })
  const planB = writePlan(rootB, [
    { slug: 'mine', files: ['scripts/mine'] },
    { slug: 'contract-x', contract: true, files: ['tests/contract'] },
  ])
  const rB = runScope(rootB, [planB, 'mine'])
  assert.equal(rB.status, 1)
  assert.equal(rB.stderr, warning)
  assert.equal(rB.stdout, 'out of scope: tests/contract/keep.mjs\n')

  // A file entry without a trailing slash is exact-match and draws no warning.
  const rootC = makeRepo({ baseFiles, changes: ['scripts/mine'] })
  const planC = writePlan(rootC, [
    { slug: 'mine', files: ['scripts/mine'] },
    { slug: 'contract-x', contract: true, files: ['scripts/lib/x.mjs'] },
  ])
  const rC = runScope(rootC, [planC, 'mine'])
  assert.equal(rC.status, 0, rC.stderr)
  assert.equal(rC.stderr, '')
})

test('M1 a non-ASCII filename that is allowed passes', () => {
  const root = makeRepo({ changes: ['src/café.js'] })
  const plan = writePlan(root, [{ slug: 'mine', files: ['src/café.js'] }])
  const r = runScope(root, [plan, 'mine', '--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.changed, ['src/café.js'])
  assert.equal(out.ok, true)
  assert.equal(runScope(root, [plan, 'mine']).stdout, 'scope OK: 1 changed files within mine\n')
})

test('unknown slug exits 2 with a message on stderr', () => {
  const root = makeRepo({ changes: ['scripts/mine'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, [plan, 'no-such-item'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no item named no-such-item/)
})

test('usage errors exit 2', () => {
  const root = makeRepo({ changes: ['scripts/mine'] })
  const plan = writePlan(root, ITEMS)
  assert.equal(runScope(root, [plan]).status, 2)
  assert.equal(runScope(root, [plan, 'mine', '--bogus']).status, 2)
})

test('--base and --head override the plan default and the HEAD default', () => {
  const root = makeRepo({ changes: ['scripts/mine', 'docs/stray.md'] })
  const plan = writePlan(root, ITEMS)
  // Diff against the work branch itself is empty, so the scope holds trivially.
  const r = runScope(root, [plan, 'mine', '--base', 'work', '--head', 'work'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'scope OK: 0 changed files within mine\n')
})

test('--json shape: item, base, head, changed, outOfScope, contractOwned, ok', () => {
  const root = makeRepo({ changes: ['scripts/mine', 'docs/stray.md', 'scripts/lib/x.mjs'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, ['--json', plan, 'mine'])
  assert.equal(r.status, 1, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(out), ['item', 'base', 'head', 'changed', 'outOfScope', 'contractOwned', 'ok'])
  assert.equal(out.item, 'mine')
  assert.equal(out.base, 'main')
  assert.equal(out.head, 'HEAD')
  assert.deepEqual(out.changed, ['docs/stray.md', 'scripts/lib/x.mjs', 'scripts/mine'])
  assert.deepEqual(out.outOfScope, ['docs/stray.md', 'scripts/lib/x.mjs'])
  assert.deepEqual(out.contractOwned, [{ path: 'scripts/lib/x.mjs', owner: 'contract-x' }])
  assert.equal(out.ok, false)
})

test('--json on a clean scope reports ok true and exits 0', () => {
  const root = makeRepo({ changes: ['scripts/mine'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, ['--json', plan, 'mine'])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, true)
  assert.deepEqual(out.outOfScope, [])
  assert.deepEqual(out.contractOwned, [])
})

test('a bad git ref exits 2 instead of reporting a clean scope', () => {
  const root = makeRepo({ changes: ['scripts/mine'] })
  const plan = writePlan(root, ITEMS)
  const r = runScope(root, [plan, 'mine', '--base', 'no-such-ref'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /git diff/)
})

const SHARED = [
  { slug: 'contract-a', contract: true, files: ['skills/s.md', 'a.test.mjs'] },
  { slug: 'contract-b', contract: true, files: ['skills/s.md', 'b.test.mjs'] },
]

test('E1 a contract item may change a path another contract item lists; its own files still bound it', () => {
  // A shared path in its own files passes, with nothing contract-owned.
  const rootA = makeRepo({ baseFiles: ['README.md', 'skills/s.md'], changes: ['skills/s.md'] })
  const planA = writePlan(rootA, SHARED)
  const rA = runScope(rootA, [planA, 'contract-a'])
  assert.equal(rA.status, 0, rA.stderr)
  assert.equal(rA.stdout, 'scope OK: 1 changed files within contract-a\n')
  const a = JSON.parse(runScope(rootA, [planA, 'contract-a', '--json']).stdout)
  assert.deepEqual(a.contractOwned, [])
  assert.equal(a.ok, true)

  // Adversarial: a path only the other contract lists is still out of scope, and is not
  // reported as contract-owned.
  const rootB = makeRepo({ baseFiles: ['README.md', 'skills/s.md'], changes: ['skills/s.md', 'b.test.mjs'] })
  const planB = writePlan(rootB, SHARED)
  const rB = runScope(rootB, [planB, 'contract-a'])
  assert.equal(rB.status, 1)
  assert.equal(rB.stdout, 'out of scope: b.test.mjs\n')
  assert.doesNotMatch(rB.stdout, /contract-owned:/)
  const b = JSON.parse(runScope(rootB, [planB, 'contract-a', '--json']).stdout)
  assert.deepEqual(b.outOfScope, ['b.test.mjs'])
  assert.deepEqual(b.contractOwned, [])
  assert.equal(b.ok, false)
})

test('I1 an implementation item is still blocked on a path a contract item lists', () => {
  const root = makeRepo({ baseFiles: ['README.md', 'skills/s.md'], changes: ['skills/s.md'] })
  const plan = writePlan(root, [{ slug: 'impl', files: ['skills/s.md'] }, ...SHARED])
  const r = runScope(root, [plan, 'impl'])
  assert.equal(r.status, 1)
  assert.equal(r.stdout, 'contract-owned: skills/s.md (owned by contract-a)\n')
})
