// Tests for the plan-check dispositions rule in brigade-validate: every finding a plan check
// lists must be ruled on in PLAN.md before dispatch. Each test writes a throwaway dish folder
// and runs the real validator on it. Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VALIDATE = path.join(ROOT, 'scripts', 'brigade-validate')

const PLAN_HEAD = `---
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
`

const PACKET = `
## Packet: widget
Change src/widget.js.
`

function planCheck(findingsLine) {
  return `---
doc: plan_check
schema: 1
dish: local-1
role: inspector
model: sonnet
created: 2026-07-04T03:10:00Z
blind_sketch_first: true
${findingsLine}
---
## Blind sketch
One item.

## Comparison
Same.

## Recommendations
M1: pin the zero case.
`
}

const BRIEF = `---
doc: brief
schema: 1
dish: local-1
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: where is the widget
confidence: high
sources: [src/widget.js]
---
## Answer
In src/widget.js.

## Risks
- The zero case is untested.
`

// Writes a dish with the given plan body extras and plan check, runs the validator on PLAN.md.
function run({ dispositions = '', findingsLine = 'findings: [M1]\nblocking: []', brief = false, check = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-disp-'))
  fs.mkdirSync(path.join(dir, 'reports'))
  fs.mkdirSync(path.join(dir, 'briefs'))
  fs.writeFileSync(path.join(dir, 'PLAN.md'), PLAN_HEAD + dispositions + PACKET)
  if (check) fs.writeFileSync(path.join(dir, 'reports', 'plan-check-1.md'), planCheck(findingsLine))
  if (brief) fs.writeFileSync(path.join(dir, 'briefs', '1.md'), BRIEF)
  const targets = [path.join(dir, 'PLAN.md')]
  if (check) targets.push(path.join(dir, 'reports', 'plan-check-1.md'))
  const r = spawnSync('node', [VALIDATE, ...targets], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const table = (rows) => `
## Plan-check dispositions
| id | source | ruling | how |
| --- | --- | --- | --- |
${rows.join('\n')}
`

test('a plan-check finding with no disposition section fails the plan', () => {
  const r = run()
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /no "## Plan-check dispositions" section/)
})

test('a plan-check finding missing from the table fails the plan', () => {
  const r = run({ dispositions: table(['| M2 | plan-check-1 | fixed | widget |']), findingsLine: 'findings: [M1, M2]\nblocking: []' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /plan-check-1 M1 has no row/)
})

test('every finding ruled passes', () => {
  const r = run({ dispositions: table(['| M1 | plan-check-1 | pinned | widget.test.js zero case |']) })
  assert.equal(r.code, 0, r.out)
})

test('an unknown ruling fails the plan', () => {
  const r = run({ dispositions: table(['| M1 | plan-check-1 | noted | later |']) })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ruling "noted" is not one of fixed\|pinned\|accepted/)
})

test('an accepted finding with no reason fails the plan', () => {
  const r = run({ dispositions: table(['| M1 | plan-check-1 | accepted |  |']) })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /accepted but names no test or reason/)
})

test('a brief risk with no row warns but does not fail', () => {
  const r = run({ dispositions: table(['| M1 | plan-check-1 | fixed | widget |']), brief: true })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1 R1 has no row/)
})

test('a plan check written before the findings key needs no table', () => {
  const r = run({ findingsLine: 'blocking: []' })
  assert.equal(r.code, 0, r.out)
})

test('a plan with no plan check needs no table', () => {
  const r = run({ check: false })
  assert.equal(r.code, 0, r.out)
})

test('a blocking id missing from findings fails the plan check', () => {
  const r = run({ dispositions: table(['| M1 | plan-check-1 | fixed | widget |']), findingsLine: 'findings: [M1]\nblocking: [B1]' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /blocking id B1 is not listed in findings/)
})
