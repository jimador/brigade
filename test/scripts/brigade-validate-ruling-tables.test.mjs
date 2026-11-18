// Tests for the two ruling tables in brigade-validate. `## PR feedback` keeps one row per
// actionable review comment (`id | where | ruling | reply`) and `## Follow-ups` keeps one row
// per out-of-scope note (`id | source | ruling | ticket`), so no decision gets dropped.
//
//   R1  a row is a section line starting with `|`; the header row (first cell `id`, any case)
//       and separator rows are skipped; a short row is padded with empty cells; a data row
//       without a PR<k> or FU<k> id is a problem.
//   E1  a PR feedback ruling outside accept|clarify|push-back (any case) is a problem.
//   E2  a PR feedback row with an empty reply is a problem.
//   E3  a follow-up ruling outside filed|covered|dropped (any case) is a problem.
//   E4  a follow-up row with an empty ticket cell is a problem.
//   E5  a repeated id in either table is a problem.
//   I1  a plan with neither section gets no new problem and no new warning.
//
// Each test writes a throwaway dish folder and runs the real validator on its PLAN.md.
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

// A one-item build plan; `tables` is extra body text placed after `## Waves` and before the
// packet, where the ruling tables go.
function plan(tables = '') {
  return `---
doc: plan
schema: 1
dish: local-1
role: planner
model: opus
created: 2026-07-04T03:10:00Z
ticket: "1"
source: local
items:
  - { slug: widget, status: todo, depends_on: [] }
---
## Dish
Make the widget.

## Waves
1. widget
${tables}
## Packet: widget
Change src/widget.js.
`
}

function run(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-rt-'))
  const planPath = path.join(dir, 'PLAN.md')
  fs.writeFileSync(planPath, text)
  const r = spawnSync(process.execPath, [VALIDATE, planPath], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const prFeedback = (...rows) =>
  `\n## PR feedback\n| id | where | ruling | reply |\n|----|-------|--------|-------|\n${rows.join('\n')}\n`
const followUps = (...rows) =>
  `\n## Follow-ups\n| id | source | ruling | ticket |\n|----|--------|--------|--------|\n${rows.join('\n')}\n`

test('E1: an unknown PR feedback ruling fails with the exact text', () => {
  const r = run(plan(prFeedback('| PR1 | src/a.js:3 | agree | Done in the rework. |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('PR feedback PR1 ruling "agree" is not one of accept|clarify|push-back'), r.out)
})

test('E2: an empty reply fails with the exact text', () => {
  const r = run(plan(prFeedback('| PR1 | src/a.js:3 | accept |  |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('PR feedback PR1 has no reply'), r.out)
})

test('E3: an unknown follow-up ruling fails with the exact text', () => {
  const r = run(plan(followUps('| FU1 | widget-cook.md | ignored | not worth it |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('follow-up FU1 ruling "ignored" is not one of filed|covered|dropped'), r.out)
})

test('E4: an empty ticket cell fails with the exact text', () => {
  const r = run(plan(followUps('| FU1 | widget-verdict.md | filed |  |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('follow-up FU1 names no ticket or reason'), r.out)
})

test('E5: a repeated id fails in either table with the exact text', () => {
  const r = run(plan(
    prFeedback('| PR1 | a.js:1 | accept | Will do. |', '| PR1 | a.js:2 | clarify | Asked why. |') +
      followUps('| FU1 | widget-cook.md | filed | 42 |', '| FU1 | widget-verdict.md | covered | 41 |'),
  ))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('duplicate PR feedback id: PR1'), r.out)
  assert.ok(r.out.includes('duplicate follow-up id: FU1'), r.out)
})

test('R1a: a header row in capitals and a separator row are skipped', () => {
  const tables = '\n## PR feedback\n| ID | WHERE | RULING | REPLY |\n| :-- | --- | :---: | --: |\n' +
    '| PR1 | top-level | accept | Done in the rework. |\n'
  const r = run(plan(tables))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /PR feedback/)
})

test('R1b: a short row with no reply cell fails as an empty reply', () => {
  const r = run(plan(prFeedback('| PR2 | a.js:4 | accept |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('PR feedback PR2 has no reply'), r.out)
})

test('R1c: a row without a PR<k> id fails with the exact text', () => {
  const r = run(plan(prFeedback('| 7 | a.js:1 | accept | done |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('PR feedback row "| 7 | a.js:1 | accept | done |" has no PR<k> id'), r.out)
})

test('R1d: a follow-up row without an FU<k> id fails with the exact text', () => {
  const r = run(plan(followUps('| PR1 | widget-cook.md | filed | 42 |')))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('follow-up row "| PR1 | widget-cook.md | filed | 42 |" has no FU<k> id'), r.out)
})

test('I1: a plan with neither section validates as before', () => {
  const r = run(plan())
  assert.equal(r.code, 0, r.out)
  assert.ok(!r.out.split('\n').some((l) => /PR feedback|follow-up/i.test(l)), r.out)
})

test('one valid row in each table passes, with rulings in any case', () => {
  const r = run(plan(
    prFeedback('| PR1 | src/a.js:3 | Push-Back | Explained why the old name stays. |') +
      followUps('| FU1 | widget-cook.md | Dropped | the code it names was deleted |'),
  ))
  assert.equal(r.code, 0, r.out)
  assert.ok(!r.out.split('\n').some((l) => /PR feedback|follow-up/i.test(l)), r.out)
})
