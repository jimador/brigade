// Tests for the design-review layer of brigade-risk (C6). Each test runs the real script,
// either against the shipped policy or against a throwaway copy of it with the design_review
// block changed. Run with `node --test test/scripts/*.test.mjs`.
//
// Contract (brigade-risk, design review). Clause ids are local to this file.
//   R1 requires: the policy's json block may omit design_review (no design categories); when
//      present it must be an array, else brigade-risk exits 1 with a message on stderr.
//   R2 requires: each design_review category has a string id and a patterns array, and every
//      pattern compiles as a regex (same rule as categories).
//   E1 ensures: --json output carries design_review (boolean) and design_matches (rows shaped
//      like matches: {path, category}); design_review is true exactly when design_matches is
//      non-empty.
//   E2 ensures: text output prints one `design-review: <ids>` line when design_review is true,
//      and no such line when it is false.
//   E3 ensures: a path matches at most one design category, the first in policy order.
//   I1 invariant: a design-review match leaves escalate, file_count, threshold_exceeded and
//      matches unchanged; the same file list gives the same values with or without the block.
//   L1 law: a design-review match does not change escalate; escalate for a file list equals
//      escalate computed from the risk categories and threshold alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RISK = path.join(ROOT, 'scripts', 'brigade-risk')
const SHIPPED_POLICY = path.join(ROOT, 'skills', 'brigade', 'policies', 'risk-escalation.md')

function readShippedJson() {
  const text = fs.readFileSync(SHIPPED_POLICY, 'utf8')
  const match = text.match(/```json\s*\n([\s\S]*?)\n```/)
  assert.ok(match, 'shipped policy has a fenced json block')
  return JSON.parse(match[1])
}

// Writes a policy file in the same shape the shipped file uses (a markdown file whose first
// fenced json block is the policy) and returns its path.
function writePolicy(dir, policy, name = 'policy.md') {
  const file = path.join(dir, name)
  fs.writeFileSync(file, `# policy\n\n\`\`\`json\n${JSON.stringify(policy, null, 2)}\n\`\`\`\n`)
  return file
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-risk-test-'))
}

function risk(args, policyFile) {
  const env = { ...process.env }
  if (policyFile) env.BRIGADE_RISK_POLICY = policyFile
  else delete env.BRIGADE_RISK_POLICY
  return spawnSync(RISK, args, { encoding: 'utf8', env })
}

function evaluateJson(files, policyFile) {
  const run = risk(['--json', '--files', ...files], policyFile)
  assert.equal(run.status, 0, `brigade-risk exited ${run.status}: ${run.stderr}`)
  return JSON.parse(run.stdout)
}

// Positive examples per design category. Each path is chosen so no risk category
// (auth, dotenv, secrets, ci-deploy, payments, data-migration) also matches, so the
// design-review result stands alone.
const PUBLIC_CONTRACT = ['src/interfaces/store.ts', 'lib/ports/clock.js', 'api/openapi.yaml', 'proto/user.proto']
const PERSISTED_DATA = ['data/schemas/user.json', 'db/ledger.sql', 'config/records.avsc']
const SECURITY_BOUNDARY = ['src/permissions.ts', 'lib/authz/check.js', 'src/oauth-client.js', 'lib/crypto/hash.js', 'config/iam-policy.json']

// Benign paths that contain a design token as a substring, or a word that looks like one.
const DESIGN_NEGATIVES = [
  'src/author.js',
  'docs/authoring.md',
  'src/report.ts',
  'src/support/index.js',
  'src/export/csv.js',
  'lib/passports.txt',
  'skills/brigade/policies/risk-escalation.md',
  'src/secretary.js',
  'src/checkout.js',
]

test('R1: a policy without design_review yields no design matches', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  delete policy.design_review
  const file = writePolicy(dir, policy)
  const out = evaluateJson(['src/interfaces/store.ts'], file)
  assert.equal(out.design_review, false)
  assert.deepEqual(out.design_matches, [])
})

test('R1: design_review as an empty array is accepted', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  policy.design_review = []
  const out = evaluateJson(['src/interfaces/store.ts'], writePolicy(dir, policy))
  assert.equal(out.design_review, false)
})

test('R1: design_review that is not an array exits 1 with a message', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  policy.design_review = 'public-contract'
  const run = risk(['--json', '--files', 'src/interfaces/store.ts'], writePolicy(dir, policy))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /design_review must be an array/)
})

test('R2: a design category with no patterns array exits 1 with a message', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  policy.design_review = [{ id: 'public-contract', description: 'x' }]
  const run = risk(['--json', '--files', 'src/interfaces/store.ts'], writePolicy(dir, policy))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /design-review category missing id or patterns/)
})

test('R2: a design category with a bad regex exits 1 with a message', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  policy.design_review = [{ id: 'public-contract', description: 'x', patterns: ['(unclosed'] }]
  const run = risk(['--json', '--files', 'src/interfaces/store.ts'], writePolicy(dir, policy))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /bad regex/)
})

test('E1: json output has design_review and design_matches shaped like matches', () => {
  const out = evaluateJson(['src/interfaces/store.ts', 'README.md'])
  assert.equal(typeof out.design_review, 'boolean')
  assert.equal(out.design_review, true)
  assert.deepEqual(out.design_matches, [{ path: 'src/interfaces/store.ts', category: 'public-contract' }])
  assert.deepEqual(Object.keys(out.design_matches[0]).sort(), ['category', 'path'])
})

test('E1: design_review is false and design_matches empty when nothing matches', () => {
  const out = evaluateJson(['src/main.js'])
  assert.equal(out.design_review, false)
  assert.deepEqual(out.design_matches, [])
})

for (const p of PUBLIC_CONTRACT) {
  test(`E1: public-contract matches ${p}`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, true)
    assert.equal(out.design_matches[0].category, 'public-contract')
  })
}

for (const p of PERSISTED_DATA) {
  test(`E1: persisted-data matches ${p}`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, true)
    assert.equal(out.design_matches[0].category, 'persisted-data')
  })
}

for (const p of SECURITY_BOUNDARY) {
  test(`E1: security-boundary matches ${p}`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, true)
    assert.equal(out.design_matches[0].category, 'security-boundary')
  })
}

for (const p of DESIGN_NEGATIVES) {
  test(`E1: no design-review match for benign path ${p}`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, false, `false positive on ${p}`)
    assert.deepEqual(out.design_matches, [])
  })
}

test('E2: text output prints one design-review line for a design match', () => {
  const run = risk(['--files', 'src/interfaces/store.ts', 'lib/authz/check.js'])
  assert.equal(run.status, 0)
  const lines = run.stdout.split('\n').filter((l) => l.startsWith('design-review:'))
  assert.equal(lines.length, 1)
  assert.equal(lines[0], 'design-review: public-contract, security-boundary')
})

test('E2: text output has no design-review line when nothing design-matches', () => {
  const run = risk(['--files', 'src/author.js'])
  assert.equal(run.status, 0)
  assert.doesNotMatch(run.stdout, /design-review/)
})

test('E3: a path matching two design categories reports the first in policy order', () => {
  // contract/ is public-contract and permissions.ts is security-boundary; public-contract is first.
  const out = evaluateJson(['src/contract/permissions.ts'])
  assert.deepEqual(out.design_matches, [{ path: 'src/contract/permissions.ts', category: 'public-contract' }])
})

test('I1: a design-review-only change does not escalate', () => {
  const out = evaluateJson(['src/interfaces/store.ts'])
  assert.equal(out.design_review, true)
  assert.equal(out.escalate, false)
  assert.deepEqual(out.matches, [])
})

test('I1/L1: escalate, matches and threshold are identical with and without design_review', () => {
  const dir = tmpDir()
  const withBlock = readShippedJson()
  const withoutBlock = readShippedJson()
  delete withoutBlock.design_review
  const fileWith = writePolicy(dir, withBlock, 'with.md')
  const fileWithout = writePolicy(dir, withoutBlock, 'without.md')

  const cases = [
    ['src/interfaces/store.ts'],
    ['src/permissions.ts', 'src/token.js'],
    ['db/migrations/0002_add.sql', 'src/permissions.ts'],
    ['src/main.js', 'docs/readme.md'],
    Array.from({ length: 11 }, (_, i) => `src/mod${i}.js`),
  ]
  for (const files of cases) {
    const a = evaluateJson(files, fileWith)
    const b = evaluateJson(files, fileWithout)
    assert.equal(a.escalate, b.escalate, `escalate changed for ${files.join(',')}`)
    assert.equal(a.file_count, b.file_count)
    assert.equal(a.threshold_exceeded, b.threshold_exceeded)
    assert.deepEqual(a.matches, b.matches, `matches changed for ${files.join(',')}`)
    assert.equal(b.design_review, false)
  }
})

test('L1: escalate for a risk-plus-design change is true because of the risk match alone', () => {
  const dir = tmpDir()
  const policy = readShippedJson()
  delete policy.design_review
  const out = evaluateJson(['src/token.js', 'src/interfaces/store.ts'], writePolicy(dir, policy))
  assert.equal(out.escalate, true)
  const full = evaluateJson(['src/token.js', 'src/interfaces/store.ts'])
  assert.equal(full.escalate, true)
  assert.equal(full.design_review, true)
  assert.deepEqual(full.matches, out.matches)
})

test('L1: an auth-category author path is not a risk match, so it does not escalate', () => {
  const out = evaluateJson(['src/author.js'])
  assert.equal(out.escalate, false)
  assert.deepEqual(out.matches, [])
})

// Review findings F1-F2 (attempt 2). Each path is checked in both directions.
// F1: documentation, fixtures and seed data never produce a design-review match.
const F1_NOT_DESIGN = [
  'docs/interfaces-guide.md',
  'docs/contract.md',
  'docs/ports-and-adapters.md',
  'docs/schemas/readme.md',
  'test/fixtures/schema.json',
  'db/seed.sql',
  'db/seeds/users.sql',
  'db/user_seed.sql',
]
// F2: camelCase and suffix names in the public-contract and security-boundary categories.
const F2_DESIGN = [
  ['src/NotifierPort.java', 'public-contract'],
  ['src/AuthService.ts', 'security-boundary'],
  ['src/authService.ts', 'security-boundary'],
  ['src/oauth2/client.ts', 'security-boundary'],
]
// F2: names that must stay out of design review.
const F2_NOT_DESIGN = ['src/components/ContractCard.tsx', 'src/author/profile.ts']

for (const p of F1_NOT_DESIGN) {
  test(`F1: ${p} is not a design-review match`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, false, `false positive on ${p}`)
    assert.deepEqual(out.design_matches, [])
  })
}

test('F1: docs and fixture paths stay out of design review even when they would match a token', () => {
  // docs/contract.md and test/fixtures/schema.json both contain a design token; the exclusion,
  // not the pattern, is what keeps them out, so a non-doc copy of the same name still matches.
  assert.equal(evaluateJson(['contract.md']).design_review, false)
  assert.equal(evaluateJson(['src/contract.ts']).design_review, true)
  assert.equal(evaluateJson(['fixtures/schema.json']).design_review, false)
  assert.equal(evaluateJson(['db/schema.json']).design_review, true)
})

test('F1: migrations and schema SQL still match persisted-data beside the seed exclusion', () => {
  for (const p of ['db/migrations/0001_init.sql', 'db/schema.sql', 'db/ledger.sql', 'db/seedling.sql']) {
    const out = evaluateJson([p])
    assert.equal(out.design_review, true, `missed ${p}`)
    assert.equal(out.design_matches[0].category, 'persisted-data')
  }
})

for (const [p, category] of F2_DESIGN) {
  test(`F2: ${p} matches ${category}`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, true, `missed ${p}`)
    assert.deepEqual(out.design_matches, [{ path: p, category }])
  })
}

for (const p of F2_NOT_DESIGN) {
  test(`F2: ${p} is not a design-review match`, () => {
    const out = evaluateJson([p])
    assert.equal(out.design_review, false, `false positive on ${p}`)
    assert.deepEqual(out.design_matches, [])
  })
}
