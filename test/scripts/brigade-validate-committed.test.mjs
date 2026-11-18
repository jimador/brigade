// Tests for the optional `committed:` key of a cook report. A cook whose `git commit` was refused
// by policy sets `committed: false`, leaves the packet's files staged, and quotes the refusal.
//
//   E1  `committed: true|false` is accepted; any other value fails with
//       `invalid report committed: <value>`. A quoted "false" counts as false.
//   E2  a done report with `committed: false` must have the word `refus` (any case) in
//       `## Evidence`, else `committed: false needs the refusal quoted in ## Evidence`.
//   I1  a report without the key validates as before.
//
// Each test writes a throwaway report and runs the real validator on it.
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VALIDATE = path.join(ROOT, 'scripts', 'brigade-validate')

const REFUSED = 'git commit: Permission to use Bash has been denied (refused by policy).'

// A report; `committed` is the raw frontmatter line (or '' to leave the key out).
function report({ committed = '', status = 'done', evidence = 'ok 1 - widget\n# pass 1' } = {}) {
  const blocked = status === 'blocked' ? '\n## Blocked\nThe packet named a file that does not exist.\n' : ''
  return `---
doc: report
schema: 1
dish: local-1
item: widget
role: cook
model: haiku
created: 2026-07-04T03:10:00Z
status: ${status}
attempt: 1
branch: wip/local-1/widget
files_changed: []
${committed ? committed + '\n' : ''}commands: []
---
## Summary
Made the widget.

## Evidence
${evidence}

## Decisions
None.

## Out of scope
Nothing.
${blocked}`
}

function run(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-ckey-'))
  const file = path.join(dir, 'widget-cook.md')
  fs.writeFileSync(file, text)
  const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('E1a: committed: true passes', () => {
  const r = run(report({ committed: 'committed: true' }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /committed/)
})

test('E1b: committed: false with the refusal quoted passes', () => {
  const r = run(report({ committed: 'committed: false', evidence: REFUSED }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /committed/)
})

test('E1c: a quoted "false" is accepted as false, and E2 still applies to it', () => {
  const ok = run(report({ committed: 'committed: "false"', evidence: REFUSED }))
  assert.equal(ok.code, 0, ok.out)
  const bad = run(report({ committed: 'committed: "false"' }))
  assert.equal(bad.code, 1, bad.out)
  assert.ok(bad.out.includes('committed: false needs the refusal quoted in ## Evidence'), bad.out)
  assert.doesNotMatch(bad.out, /invalid report committed/)
})

test('E1d: committed: no fails with the exact text', () => {
  const r = run(report({ committed: 'committed: no' }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('invalid report committed: no'), r.out)
})

test('E1e: an empty committed value fails', () => {
  const r = run(report({ committed: 'committed:' }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('invalid report committed: '), r.out)
})

test('E2a: committed: false without the refusal in Evidence fails with the exact text', () => {
  const r = run(report({ committed: 'committed: false' }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('committed: false needs the refusal quoted in ## Evidence'), r.out)
})

test('E2b: the refusal match is case-insensitive', () => {
  const r = run(report({ committed: 'committed: false', evidence: 'REFUSED: git commit blocked' }))
  assert.equal(r.code, 0, r.out)
})

test('E2c: the word refus outside ## Evidence does not count', () => {
  const text = report({ committed: 'committed: false' }).replace('Made the widget.', 'Commit was refused.')
  const r = run(text)
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('committed: false needs the refusal quoted in ## Evidence'), r.out)
})

test('E2d: a blocked report with committed: false does not need the refusal quoted', () => {
  const r = run(report({ committed: 'committed: false', status: 'blocked' }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /committed/)
})

test('I1: a report without the key validates as before', () => {
  const r = run(report())
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /committed/)
})
