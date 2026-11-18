// Tests for the ticket test plan rule in brigade-validate. When a ticket has its own test
// plan, the planner copies each item into `## Dish` under `### Ticket test plan` as a
// `- [ ] TP<k>. <item>` line, and every id must be owned by some packet's acceptance criteria.
//
//   R1  the subsection is the lines after `### Ticket test plan` inside `## Dish`, up to the
//       next `### ` or `## ` line.
//   E1  a `- ` line there without a `TP<k>.` id is a problem.
//   E2  a repeated id is a problem.
//   E3  an id no packet's `### Acceptance criteria` mentions is a problem, or a warning at
//       `level: contracts`.
//   I1  a plan without the subsection gets no new problem and no new warning.
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

// A two-item build plan. `dish` is extra text inside `## Dish`; `widget` and `gadget` are the
// bodies of the two packet sections; `level` adds a plan level when given.
function plan({ dish = '', widget = 'Change src/widget.js.\n', gadget = 'Change src/gadget.js.\n', level = null } = {}) {
  return `---
doc: plan
schema: 1
dish: local-1
role: planner
model: opus
created: 2026-07-04T03:10:00Z
ticket: "1"
source: local
${level ? `level: ${level}\n` : ''}items:
  - { slug: widget, status: todo, depends_on: [] }
  - { slug: gadget, status: todo, depends_on: [] }
---
## Dish
Make the widget and the gadget.
${dish}
## Waves
1. widget, gadget

## Packet: widget
${widget}
## Packet: gadget
${gadget}`
}

function run(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-tp-'))
  const planPath = path.join(dir, 'PLAN.md')
  fs.writeFileSync(planPath, text)
  const r = spawnSync(process.execPath, [VALIDATE, planPath], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const testPlan = (...lines) => `\n### Ticket test plan\n${lines.join('\n')}\n`
const accepts = (...lines) => `Change src/widget.js.\n\n### Acceptance criteria\n${lines.join('\n')}\n`

test('R1a: a ticket test plan heading inside a packet, not in ## Dish, is ignored', () => {
  const r = run(plan({ widget: 'Change src/widget.js.\n\n### Ticket test plan\n- [ ] run the smoke test\n' }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /ticket test plan/)
})

test('R1b: the subsection ends at the next ### heading inside ## Dish', () => {
  const dish = testPlan('- [ ] TP1. the widget renders') + '\n### Notes\n- [ ] run the smoke test\n'
  const r = run(plan({ dish, widget: accepts('- [ ] TP1 holds.') }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /ticket test plan/)
})

test('E1: a line with no TP id fails with the exact text', () => {
  const r = run(plan({ dish: testPlan('- [ ] run the smoke test') }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('ticket test plan line "- [ ] run the smoke test" has no TP<k>. id'), r.out)
})

test('E2: a repeated id fails with the exact text', () => {
  const r = run(plan({ dish: testPlan('- [ ] TP1. a', '- [ ] TP1. b'), widget: accepts('- [ ] TP1 holds.') }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('duplicate ticket test plan id: TP1'), r.out)
})

const UNOWNED = `ticket test plan TP2 is in no packet's "### Acceptance criteria"`

test('E3a: an id no packet owns fails when the plan has no level', () => {
  const r = run(plan({ dish: testPlan('- [ ] TP1. a', '- [ ] TP2. b'), widget: accepts('- [ ] TP1 holds.') }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes(`FAIL`) && r.out.includes(UNOWNED), r.out)
})

test('E3b: at level contracts an unowned id is a warning, not a failure', () => {
  const r = run(plan({ dish: testPlan('- [ ] TP1. a', '- [ ] TP2. b'), widget: accepts('- [ ] TP1 holds.'), level: 'contracts' }))
  assert.equal(r.code, 0, r.out)
  const line = r.out.split('\n').find((l) => l.includes(UNOWNED))
  assert.ok(line && line.startsWith('warn'), r.out)
  assert.doesNotMatch(r.out, /FAIL/)
})

test('E3c: an id named only in a packet goal, or only as a longer id, is still unowned', () => {
  const goalOnly = run(plan({
    dish: testPlan('- [ ] TP1. a'),
    widget: '### Goal\nMake TP1 pass.\n\n### Acceptance criteria\n- [ ] The widget renders.\n',
  }))
  assert.equal(goalOnly.code, 1, goalOnly.out)
  assert.ok(goalOnly.out.includes(`ticket test plan TP1 is in no packet's "### Acceptance criteria"`), goalOnly.out)

  const longer = run(plan({ dish: testPlan('- [ ] TP1. a'), widget: accepts('- [ ] TP10 holds.') }))
  assert.equal(longer.code, 1, longer.out)
  assert.ok(longer.out.includes(`ticket test plan TP1 is in no packet's "### Acceptance criteria"`), longer.out)
})

// The plain plan fixture from brigade-validate-dispositions.test.mjs, copied as it is.
const DISPOSITIONS_PLAN = `---
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

## Packet: widget
Change src/widget.js.
`

test('I1: a plan without the subsection validates as before', () => {
  for (const text of [DISPOSITIONS_PLAN, plan()]) {
    const r = run(text)
    assert.equal(r.code, 0, r.out)
    assert.ok(!r.out.split('\n').some((l) => l.includes('ticket test plan')), r.out)
  }
})

test('two ids, each owned by one packet, pass', () => {
  const r = run(plan({
    dish: testPlan('- [ ] TP1. the widget renders', '- [x] TP2. the gadget spins'),
    widget: accepts('- [ ] TP1: the widget renders.'),
    gadget: 'Change src/gadget.js.\n\n### Acceptance criteria\n- [ ] TP2 the gadget spins.\n',
  }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /ticket test plan/)
})
