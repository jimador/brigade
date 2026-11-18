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

// Each item: { slug, files: [[path, mark]], depends_on, status, heavy, contract }. A mark of
// null leaves the path unmarked in the packet body.
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
  }
  const planPath = path.join(root, 'PLAN.md')
  fs.writeFileSync(planPath, lines.join('\n'))
  return planPath
}

function rehearse(root, args) {
  return spawnSync(process.execPath, [REHEARSE, ...args], { cwd: root, encoding: 'utf8' })
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
