// Tests for brigade-rehearse. Each test builds a throwaway git repo whose `main` branch holds a
// few files, writes a small PLAN.md (frontmatter items plus a `## Packet:` section per item with
// its (edit)/(create) marks), and runs the real script in that repo. One test per check fires it
// on a crafted defect; the clean plan stays quiet. Run with `node --test test/scripts/*.test.mjs`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REHEARSE = path.join(ROOT, 'scripts', 'brigade-rehearse')

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

// A repo whose `main` commit holds `baseFiles`. The plan is written outside git's view of the
// base commit, so it never counts as an existing path.
function makeRepo(baseFiles = ['src/a.js', 'src/b.js', 'src/c.js', 'README.md']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-rehearse-'))
  git(root, ['init', '-q', '-b', 'main'])
  for (const f of baseFiles) writeFile(root, f)
  git(root, ['add', '--', ...baseFiles])
  git(root, ['commit', '-q', '-m', 'base'])
  return root
}

// Each item: { slug, files: [[path, mark]], depends_on, status, heavy, contract, body }. A mark of
// null leaves the path unmarked in the packet body; `body` lines go after the file list.
// A deliveryBranch of null leaves the key out of the frontmatter.
function writePlan(root, items, { deliveryBranch = 'main', extraFrontmatter = [] } = {}) {
  const lines = ['---', 'doc: plan', 'schema: 1', 'dish: rehearse-test', 'ticket: rehearse-test',
    'source: local', ...(deliveryBranch === null ? [] : [`delivery_branch: ${deliveryBranch}`]),
    ...extraFrontmatter, 'items:']
  for (const it of items) {
    const parts = [
      `slug: ${it.slug}`,
      `status: ${it.status ?? 'todo'}`,
      `depends_on: [${(it.depends_on ?? []).join(', ')}]`,
      `heavy: ${it.heavy ? 'true' : 'false'}`,
      `contract: ${it.contract ? 'true' : 'false'}`,
      `files: [${it.files.map(([p]) => p).join(', ')}]`,
    ]
    lines.push(`  - { ${parts.join(', ')} }`)
  }
  lines.push('---', '', '## Dish', '', 'Fixture plan.', '')
  for (const it of items) {
    lines.push(`## Packet: ${it.slug} — fixture packet`, '', '- **files:** the ONLY files you may touch')
    for (const [p, mark] of it.files) lines.push(mark ? `  - ${p} (${mark})` : `  - ${p}`)
    lines.push('')
    if (it.body) lines.push(...it.body, '')
  }
  const planPath = path.join(root, 'PLAN.md')
  fs.writeFileSync(planPath, lines.join('\n'))
  return planPath
}

// The fallback reads the main branch through brigade-config, which follows the project-dir
// variables and the user's ~/.brigade. Both are cleared so only the temp repo's config counts.
const BRIGADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-rehearse-home-'))
function cleanEnv() {
  const env = { ...process.env, BRIGADE_HOME }
  delete env.BRIGADE_PROJECT_DIR
  delete env.CLAUDE_PROJECT_DIR
  delete env.CODEX_PROJECT_DIR
  return env
}

function rehearse(root, args, script = REHEARSE) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: cleanEnv() })
}

function findingLines(r) {
  return r.stdout.split('\n').filter((l) => /^(validate|premise|owner|overlap|chain|risk): /.test(l))
}

function jsonRows(r) {
  return r.stdout.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
}

// Two independent items on disjoint files, each marking its paths correctly.
const CLEAN = [
  { slug: 'one', files: [['src/a.js', 'edit'], ['src/new-one.js', 'create']] },
  { slug: 'two', files: [['src/b.js', 'edit'], ['test/two.test.js', 'create, executable']] },
]

test('clean plan: no findings, no warnings, exit 0', () => {
  const root = makeRepo()
  const plan = writePlan(root, CLEAN)
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [])
  assert.match(r.stdout, /0 findings, 0 warnings/)
  const j = rehearse(root, ['--json', plan])
  assert.equal(j.status, 0, j.stdout + j.stderr)
  assert.equal(j.stdout.trim(), '')
})

test('validate: each brigade-validate FAIL becomes a finding', () => {
  const root = makeRepo()
  const plan = writePlan(root, [...CLEAN, { slug: 'three', depends_on: ['ghost'], files: [['src/c.js', 'edit']] }])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const lines = findingLines(r).filter((l) => l.startsWith('validate: '))
  assert.ok(lines.length >= 1, r.stdout)
  assert.ok(lines.some((l) => l.includes('ghost')), r.stdout)
  // The finding count matches brigade-validate's own FAIL lines.
  const v = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brigade-validate'), plan],
    { cwd: root, encoding: 'utf8' })
  const fails = v.stdout.split('\n').filter((l) => l.startsWith('FAIL  '))
  assert.equal(lines.length, fails.length, `${r.stdout}\n---\n${v.stdout}`)
})

test('premise: an (edit) path missing at the base is a finding; an unmarked path counts as edit', () => {
  const root = makeRepo()
  const plan = writePlan(root, [
    { slug: 'one', files: [['src/missing.js', 'edit'], ['src/a.js', 'edit']] },
    { slug: 'two', files: [['src/also-missing.js', null], ['src/b.js', null]] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [
    'premise: one: src/missing.js is marked (edit) but does not exist at main',
    'premise: two: src/also-missing.js is unmarked (checked as edit) but does not exist at main',
  ])
})

test('premise (adversarial): a (create) path that already exists is a finding', () => {
  const root = makeRepo()
  const plan = writePlan(root, [{ slug: 'one', files: [['src/a.js', 'create'], ['src/fresh.js', 'create']] }])
  const r = rehearse(root, ['--json', plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(jsonRows(r), [{
    check: 'premise', level: 'finding', item: 'one',
    detail: 'src/a.js is marked (create) but already exists at main', path: 'src/a.js',
  }])
})

test('premise: done items are skipped, an edit of a file an ancestor creates is allowed, --base wins', () => {
  const root = makeRepo()
  git(root, ['checkout', '-q', '-b', 'other'])
  writeFile(root, 'src/only-on-other.js')
  git(root, ['add', '--', 'src/only-on-other.js'])
  git(root, ['commit', '-q', '-m', 'other'])
  git(root, ['checkout', '-q', 'main'])
  const items = [
    { slug: 'old', status: 'done', files: [['src/gone.js', 'edit']] },
    { slug: 'maker', files: [['src/made.js', 'create']] },
    { slug: 'middle', depends_on: ['maker'], files: [['src/b.js', 'edit']] },
    { slug: 'user', depends_on: ['middle'], files: [['src/made.js', 'edit'], ['src/only-on-other.js', 'edit']] },
  ]
  const plan = writePlan(root, items)
  const onMain = rehearse(root, [plan])
  assert.deepEqual(findingLines(onMain), [
    'premise: user: src/only-on-other.js is marked (edit) but does not exist at main',
  ])
  const onOther = rehearse(root, ['--base', 'other', plan])
  assert.equal(onOther.status, 0, onOther.stdout + onOther.stderr)
  assert.deepEqual(findingLines(onOther), [])
})

test('owner: a non-contract item listing a contract path is a finding; contracts are exempt among themselves', () => {
  const root = makeRepo(['src/a.js', 'src/b.js', 'lib/x.mjs', 'lib/y.mjs'])
  const plan = writePlan(root, [
    // A merged contract owns lib/; a second, open contract edits a path under it (allowed).
    { slug: 'shape', status: 'done', contract: true, files: [['lib/', 'edit']] },
    { slug: 'shape-two', contract: true, depends_on: ['shape'], files: [['lib/x.mjs', 'edit']] },
    { slug: 'consumer', depends_on: ['shape'], files: [['lib/y.mjs', 'edit'], ['src/a.js', 'edit']] },
    { slug: 'bystander', depends_on: ['shape'], files: [['src/b.js', 'edit']] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), ['owner: consumer: lib/y.mjs is owned by contract item shape'])
})

test('overlap: two items with no dependency path sharing a file is a finding', () => {
  const root = makeRepo()
  const plan = writePlan(root, [
    { slug: 'left', files: [['src/a.js', 'edit']] },
    { slug: 'right', files: [['src/a.js', 'edit'], ['src/b.js', 'edit']] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [
    'overlap: left: src/a.js is also listed by right, and neither depends on the other',
  ])
})

test('overlap (adversarial): a transitive dependency through a third item is not an overlap', () => {
  const root = makeRepo()
  // late reaches early only through mid, which does not list src/a.js.
  const plan = writePlan(root, [
    { slug: 'early', files: [['src/a.js', 'edit']] },
    { slug: 'mid', depends_on: ['early'], files: [['src/b.js', 'edit']] },
    { slug: 'late', depends_on: ['mid'], files: [['src/a.js', 'edit'], ['src/c.js', 'edit']] },
    // A sibling of mid that also depends on early: shares nothing with late, so still quiet.
    { slug: 'side', depends_on: ['early'], files: [['README.md', 'edit']] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [])
})

test('chain: a file listed by three items is a warning in landing order and keeps exit 0', () => {
  const root = makeRepo()
  // Plan order differs from landing order: third is listed first but depends on second.
  const plan = writePlan(root, [
    { slug: 'third', depends_on: ['second'], files: [['src/a.js', 'edit']] },
    { slug: 'first', files: [['src/a.js', 'edit']] },
    { slug: 'second', depends_on: ['first'], files: [['src/a.js', 'edit']] },
    { slug: 'pair-a', files: [['src/b.js', 'edit']] },
    { slug: 'pair-b', depends_on: ['pair-a'], files: [['src/b.js', 'edit']] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), ['chain: src/a.js: first -> second -> third'])
  assert.match(r.stdout, /0 findings, 1 warning\b/)
  const j = rehearse(root, ['--json', plan])
  assert.equal(j.status, 0)
  assert.deepEqual(jsonRows(j), [{
    check: 'chain', level: 'warning', item: 'src/a.js', detail: 'first -> second -> third',
    items: ['first', 'second', 'third'],
  }])
})

test('risk: an escalating item without heavy: true is a finding; the heavy one is not', () => {
  const root = makeRepo(['src/auth/session.js', 'src/a.js'])
  const plan = writePlan(root, [
    { slug: 'light', files: [['src/auth/session.js', 'edit']] },
    { slug: 'strong', heavy: true, depends_on: ['light'], files: [['src/auth/session.js', 'edit']] },
    { slug: 'plain', files: [['src/a.js', 'edit']] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const lines = findingLines(r)
  assert.equal(lines.length, 1, r.stdout)
  assert.match(lines[0], /^risk: light: brigade-risk escalates \(categories auth\) but the item is not heavy: true$/)
})

test('usage and I/O errors exit 2', () => {
  const root = makeRepo()
  const plan = writePlan(root, CLEAN)
  assert.equal(rehearse(root, []).status, 2)
  assert.equal(rehearse(root, [plan, plan]).status, 2)
  assert.equal(rehearse(root, ['--base']).status, 2)
  assert.equal(rehearse(root, ['--bogus', plan]).status, 2)
  assert.equal(rehearse(root, [path.join(root, 'nope.md')]).status, 2)
  const badBase = rehearse(root, ['--base', 'no-such-ref', plan])
  assert.equal(badBase.status, 2)
  assert.match(badBase.stderr, /no-such-ref/)
})

// Commits `rel` on a new branch `name`, then returns to main.
function branchWith(root, name, rel) {
  git(root, ['checkout', '-q', '-b', name])
  writeFile(root, rel)
  git(root, ['add', '--', rel])
  git(root, ['commit', '-q', '-m', name])
  git(root, ['checkout', '-q', 'main'])
}

function baseLines(text) {
  return text.split('\n').filter((l) => l.startsWith('base: '))
}

test('base E1: a delivery branch that exists is the base, with no fallback line', () => {
  const root = makeRepo()
  branchWith(root, 'feature/ready', 'src/only-on-feature.js')
  const plan = writePlan(root, [{ slug: 'one', files: [['src/only-on-feature.js', 'edit']] }],
    { deliveryBranch: 'feature/ready' })
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [])
  assert.deepEqual(baseLines(r.stdout + r.stderr), [])
  assert.match(r.stdout, /against feature\/ready: 0 findings/)
})

test('base E2: a delivery branch that does not exist yet falls back to main and runs every check', () => {
  const root = makeRepo()
  const clean = writePlan(root, CLEAN, { deliveryBranch: 'feature/not-there' })
  const ok = rehearse(root, [clean])
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.deepEqual(baseLines(ok.stdout), ['base: main (delivery branch feature/not-there does not exist yet)'])
  assert.match(ok.stdout, /against main: 0 findings, 0 warnings/)
  // The checks really run against main: a missing (edit) path is a finding, so exit 1, not 2.
  const bad = writePlan(root, [{ slug: 'one', files: [['src/missing.js', 'edit']] }],
    { deliveryBranch: 'feature/not-there' })
  const r = rehearse(root, [bad])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), ['premise: one: src/missing.js is marked (edit) but does not exist at main'])
  // With --json the note goes to stderr so stdout stays one JSON object per line.
  const j = rehearse(root, ['--json', bad])
  assert.equal(j.status, 1, j.stdout + j.stderr)
  assert.equal(jsonRows(j).length, 1)
  assert.deepEqual(baseLines(j.stderr), ['base: main (delivery branch feature/not-there does not exist yet)'])
})

test('base E2: with no delivery branch in the plan the note says so', () => {
  const root = makeRepo()
  const plan = writePlan(root, CLEAN, { deliveryBranch: null })
  const r = rehearse(root, [plan])
  assert.notEqual(r.status, 2, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: main (no delivery branch in the plan)'])
  assert.match(r.stdout, /rehearsed 2 items against main/)
})

test('base E2 (adversarial): origin/HEAD wins over main, and master is used when main is absent', () => {
  const root = makeRepo()
  branchWith(root, 'trunk', 'src/only-on-trunk.js')
  const trunk = git(root, ['rev-parse', 'trunk']).trim()
  git(root, ['update-ref', 'refs/remotes/origin/trunk', trunk])
  git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
  const plan = writePlan(root, [{ slug: 'one', files: [['src/only-on-trunk.js', 'edit']] }],
    { deliveryBranch: 'feature/not-there' })
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: origin/trunk (delivery branch feature/not-there does not exist yet)'])

  const other = makeRepo()
  git(other, ['branch', '-m', 'main', 'master'])
  git(other, ['checkout', '-q', '--detach'])
  const p2 = writePlan(other, CLEAN, { deliveryBranch: 'feature/not-there' })
  const r2 = rehearse(other, [p2])
  assert.equal(r2.status, 0, r2.stdout + r2.stderr)
  assert.deepEqual(baseLines(r2.stdout), ['base: master (delivery branch feature/not-there does not exist yet)'])
})

test('base E3: an explicit --base that does not resolve exits 2 even when the delivery branch exists', () => {
  const root = makeRepo()
  const plan = writePlan(root, CLEAN)
  const r = rehearse(root, ['--base', 'feature/not-there', plan])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.equal(r.stderr.trim(), 'base feature/not-there does not name a commit here; pass --base <ref>')
  assert.equal(r.stdout, '')
})

// A repo with `main` and `develop` on different trees: only develop holds src/only-on-develop.js.
// origin/HEAD points at origin/main, the case the configured branch has to beat.
function mainAndDevelop() {
  const root = makeRepo()
  branchWith(root, 'develop', 'src/only-on-develop.js')
  const head = git(root, ['rev-parse', 'main']).trim()
  git(root, ['update-ref', 'refs/remotes/origin/main', head])
  git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  const plan = writePlan(root, [{ slug: 'one', files: [['src/only-on-develop.js', 'edit']] }],
    { deliveryBranch: 'feature/not-there' })
  return { root, plan }
}

function configureMainBranch(root, value) {
  writeFile(root, '.brigade/config.local.json', JSON.stringify({ mainBranch: value }) + '\n')
}

// A copy of the scripts folder with brigade-config swapped for a stub, so the lookup's failure
// and output shapes can be driven directly. brigade-risk reads its policy from ../skills, so
// that folder is linked in beside the copy.
function scriptsWithConfigStub(body) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-rehearse-scripts-'))
  const dir = path.join(top, 'scripts')
  fs.cpSync(path.join(ROOT, 'scripts'), dir, { recursive: true })
  fs.symlinkSync(path.join(ROOT, 'skills'), path.join(top, 'skills'))
  fs.writeFileSync(path.join(dir, 'brigade-config'), body)
  return path.join(dir, 'brigade-rehearse')
}

test('base E1: the configured main branch wins the fallback over origin/HEAD and main', () => {
  const { root, plan } = mainAndDevelop()
  configureMainBranch(root, 'develop')
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(findingLines(r), [])
  assert.deepEqual(baseLines(r.stdout), ['base: develop (delivery branch feature/not-there does not exist yet)'])
  assert.match(r.stdout, /against develop: 0 findings/)
})

test('base E1: with no local branch, the configured branch on origin is next', () => {
  const { root, plan } = mainAndDevelop()
  configureMainBranch(root, 'develop')
  const dev = git(root, ['rev-parse', 'develop']).trim()
  git(root, ['update-ref', 'refs/remotes/origin/develop', dev])
  git(root, ['branch', '-D', 'develop'])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: origin/develop (delivery branch feature/not-there does not exist yet)'])
})

test('base E1: a nested { value } mainBranch in the config output is accepted', () => {
  const { root, plan } = mainAndDevelop()
  const script = scriptsWithConfigStub(
    "console.log(JSON.stringify({ config: { mainBranch: { value: 'develop' } } }))\n")
  const r = rehearse(root, [plan], script)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: develop (delivery branch feature/not-there does not exist yet)'])
})

test('base E2: without a configured main branch the fallback is unchanged', () => {
  const { root, plan } = mainAndDevelop()
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: origin/main (delivery branch feature/not-there does not exist yet)'])
  // With origin/HEAD absent, main is next.
  git(root, ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'])
  const r2 = rehearse(root, [plan])
  assert.equal(r2.status, 1, r2.stdout + r2.stderr)
  assert.deepEqual(baseLines(r2.stdout), ['base: main (delivery branch feature/not-there does not exist yet)'])
  assert.deepEqual(findingLines(r2),
    ['premise: one: src/only-on-develop.js is marked (edit) but does not exist at main'])
})

test('base E2 (adversarial): a configured branch that does not exist, a failing or silent brigade-config fall through', () => {
  const { root, plan } = mainAndDevelop()
  configureMainBranch(root, 'release/none')
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(baseLines(r.stdout), ['base: origin/main (delivery branch feature/not-there does not exist yet)'])

  const fresh = mainAndDevelop()
  for (const body of ["process.exit(3)\n", "console.log('not json')\n", "console.log('{}')\n",
    "console.log(JSON.stringify({ config: { mainBranch: '--output=x' } }))\n"]) {
    const r2 = rehearse(fresh.root, [fresh.plan], scriptsWithConfigStub(body))
    assert.equal(r2.status, 1, body + r2.stdout + r2.stderr)
    assert.deepEqual(baseLines(r2.stdout),
      ['base: origin/main (delivery branch feature/not-there does not exist yet)'], body)
  }
})

// Commits each { path: body } on main, on top of makeRepo's base.
function commitOnMain(root, files) {
  for (const [rel, body] of Object.entries(files)) writeFile(root, rel, body)
  git(root, ['add', '--', ...Object.keys(files)])
  git(root, ['commit', '-q', '-m', 'more'])
}

function lineStarting(r, prefix) {
  return r.stdout.split('\n').filter((l) => l.startsWith(prefix))
}

function worktreeCount(root) {
  return git(root, ['worktree', 'list']).trim().split('\n').length
}

test('pin E1: a test file the item does not list warns once per file; an owned one does not; exit unchanged', () => {
  const root = makeRepo(['scripts/foo', 'src/a.js', 'src/data.js'])
  commitOnMain(root, {
    'test/scripts/foo.test.mjs': "import path from 'node:path'\nconst FOO = 'scripts/foo'\nconst AGAIN = 'foo'\n",
    'test/regression.sh': '#!/bin/sh\nnode --check src/data.js\ngrep -q x src/a.js\n',
    'test/board/other.test.mjs': "// mentions a.json and data.js only\n",
    'docs/notes.md': 'scripts/foo and src/a.js live outside the searched test files\n',
  })
  const plan = writePlan(root, [{ slug: 'one', files: [['scripts/foo', 'edit'], ['src/a.js', 'edit']] }])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  // Warnings come in git grep's order: by test file path, then line.
  assert.deepEqual(lineStarting(r, 'pin: '), [
    "pin: one lists src/a.js; test/regression.sh:3 pins it but is not in the item's files",
    "pin: one lists scripts/foo; test/scripts/foo.test.mjs:2 pins it but is not in the item's files",
  ])
  assert.match(r.stdout, /0 findings, 2 warnings/)
  const j = rehearse(root, ['--json', plan])
  assert.equal(j.status, 0, j.stdout + j.stderr)
  assert.deepEqual(jsonRows(j)[1], {
    check: 'pin', level: 'warning', item: 'one',
    detail: "test/scripts/foo.test.mjs:2 pins scripts/foo but is not in the item's files",
    path: 'scripts/foo', test: 'test/scripts/foo.test.mjs', line: 2,
  })

  // Listing the test file, or a directory that holds it, owns it: no warning for it.
  const owned = writePlan(root, [
    { slug: 'one', files: [['scripts/foo', 'edit'], ['test/scripts/foo.test.mjs', 'edit']] },
    { slug: 'two', depends_on: ['one'], files: [['src/a.js', 'edit'], ['test/', 'edit']] },
  ])
  const o = rehearse(root, [owned])
  assert.equal(o.status, 0, o.stdout + o.stderr)
  assert.deepEqual(lineStarting(o, 'pin: '), [])
})

test('premise E2: premise lines run in a removed worktree of the base; a failing one is a finding', () => {
  const root = makeRepo()
  // Present in the working directory but not committed: a premise about it fails on the base.
  writeFile(root, 'only-here.txt')
  const before = worktreeCount(root)
  const body = [
    '- **premise:** `test -f src/a.js`',
    '- **premise:** `test -f only-here.txt`',
    '```text',
    '- **premise:** `false`',
    '```',
  ]
  const plan = writePlan(root, [{ slug: 'one', files: [['src/a.js', 'edit']], body }])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(lineStarting(r, 'premise FAIL: '), ['premise FAIL: one: test -f only-here.txt (exit 1)'])
  assert.match(r.stdout, /1 finding, 0 warnings/)
  assert.equal(worktreeCount(root), before)

  const passing = writePlan(root, [{ slug: 'one', files: [['src/a.js', 'edit']],
    body: ['- **premise:** `test -f src/a.js && git rev-parse --verify -q HEAD >/dev/null`'] }])
  const p = rehearse(root, [passing])
  assert.equal(p.status, 0, p.stdout + p.stderr)
  assert.deepEqual(lineStarting(p, 'premise FAIL: '), [])
  assert.equal(worktreeCount(root), before)
})

// A packet whose Verify block mixes lines that cannot run on base with lines that only fail
// because the change is missing.
const VERIFY_BODY = [
  '### Steps',
  '',
  '1. **Implement:** fix src/broken.js and make the test pass.',
  '2. **Verify (must pass):**',
  '',
  '```bash',
  '# comments and blank lines are skipped',
  '',
  'node --check src/broken.js',
  'node --check src/ok.js',
  'node --test test/fails.test.mjs',
  'node --check src/new.js',
  'node --test test/missing.test.mjs',
  'no-such-tool-for-rehearse --version',
  '```',
  '',
  '### Acceptance criteria',
  '',
  '```bash',
  'node --test test/outside-verify.test.mjs',
  '```',
]

test('verify E3: a node --check failing on base, a missing file and a missing program are UNRUNNABLE; a failing test is not', () => {
  const root = makeRepo()
  commitOnMain(root, {
    'src/broken.js': 'function (\n',
    'src/ok.js': 'export const ok = 1\n',
    'test/fails.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert'\n" +
      "test('needs the change', () => assert.fail('missing'))\n",
  })
  const before = worktreeCount(root)
  const plan = writePlan(root, [{ slug: 'one', body: VERIFY_BODY, files: [
    ['src/broken.js', 'edit'], ['test/fails.test.mjs', 'edit'], ['src/new.js', 'create']] }])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.deepEqual(lineStarting(r, 'verify '), [
    'verify UNRUNNABLE: one: node --check src/broken.js: node --check fails on base (exit 1)',
    'verify UNRUNNABLE: one: node --test test/missing.test.mjs: ' +
      'test/missing.test.mjs does not exist on base and the packet does not create it',
    'verify UNRUNNABLE: one: no-such-tool-for-rehearse --version: program no-such-tool-for-rehearse not found',
  ])
  assert.equal(worktreeCount(root), before)
  const j = rehearse(root, ['--json', plan])
  assert.equal(j.status, 1, j.stdout + j.stderr)
  assert.deepEqual(jsonRows(j).filter((row) => row.check === 'verify')[0], {
    check: 'verify', level: 'finding', item: 'one',
    detail: 'node --check src/broken.js: node --check fails on base (exit 1)', command: 'node --check src/broken.js',
  })
})

test('verify E3 (adversarial): a file an ancestor item creates is not missing; failing lines that need the change print nothing', () => {
  const root = makeRepo()
  const plan = writePlan(root, [
    { slug: 'maker', files: [['src/made.mjs', 'create']] },
    { slug: 'user', depends_on: ['maker'], files: [['src/a.js', 'edit']], body: [
      '- **Verify:**',
      '  ```bash',
      '  node src/made.mjs',
      '  grep -q "new behavior" src/a.js',
      '  test "$(cat src/a.js)" = changed \\',
      '    && echo done',
      '  ```',
    ] },
  ])
  const r = rehearse(root, [plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(lineStarting(r, 'verify '), [])
})

test('no-exec E4: --no-exec skips premises and Verify commands and says so', () => {
  const root = makeRepo()
  commitOnMain(root, { 'src/broken.js': 'function (\n' })
  const before = worktreeCount(root)
  const plan = writePlan(root, [{ slug: 'one', files: [['src/broken.js', 'edit']],
    body: ['- **premise:** `false`', ...VERIFY_BODY] }])
  const ran = rehearse(root, [plan])
  assert.equal(ran.status, 1, ran.stdout + ran.stderr)
  assert.deepEqual(lineStarting(ran, 'premise FAIL: '), ['premise FAIL: one: false (exit 1)'])
  assert.deepEqual(lineStarting(ran, 'premises: '), [])

  const r = rehearse(root, ['--no-exec', plan])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(lineStarting(r, 'premises: '), ['premises: skipped'])
  assert.deepEqual(lineStarting(r, 'premise FAIL: '), [])
  assert.deepEqual(lineStarting(r, 'verify '), [])
  assert.equal(worktreeCount(root), before)
  const j = rehearse(root, ['--json', '--no-exec', plan])
  assert.equal(j.status, 0, j.stdout + j.stderr)
  assert.equal(j.stdout.trim(), '')
  assert.match(j.stderr, /^premises: skipped$/m)
})
