// Tests for `brigade-validate --ticket <ticket.md> <PLAN.md>`: on a markdown board the validator
// counts the items in the ticket's own test plan and makes the plan carry exactly that many
// `TP<k>` lines, so an item the planner never copied is caught.
//
//   R1  `--ticket <path>` may sit anywhere in the arguments; the value is the next argument.
//       `--ticket` with no value prints `brigade-validate: --ticket needs a file path` to
//       stderr and exits 2. Without `--ticket` nothing changes.
//   R2  the ticket's section is the first level 2 or 3 heading named Validation, Test plan or
//       Testing (any case), up to the next heading; its items are unindented `- ` lines (with or
//       without a box) and `1.` / `1)` lines.
//   E1  m TP lines against n ticket items, m !== n, is the problem
//       `ticket test plan has <m> TP items; the ticket's "<heading>" section has <n>`.
//   E2  no such section and m > 0 is the problem
//       `plan has <m> TP items but the ticket has no Validation, Test plan or Testing section`.
//   E3  an unreadable ticket is the problem `cannot read ticket <path as given>`.
//   I1  `--ticket` applies only to `doc: plan` files; other artifacts validate as before.
//
// Each test writes a throwaway folder and runs the real validator.
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

// A one-item build plan whose `## Dish` carries the given TP ids, each owned by the packet.
function plan(...ids) {
  const tp = ids.length > 0
    ? `\n### Ticket test plan\n${ids.map((id) => `- [ ] ${id}. check ${id}`).join('\n')}\n`
    : ''
  const owned = ids.map((id) => `- [ ] ${id} holds.`).join('\n')
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
${tp}
## Waves
1. widget

## Packet: widget
Change src/widget.js.

### Acceptance criteria
- [ ] The widget renders.
${owned}
`
}

const REPORT = `---
doc: report
schema: 1
dish: local-1
item: widget
role: cook
model: haiku
created: 2026-07-04T03:10:00Z
status: done
attempt: 1
branch: wip/local-1/widget
files_changed: []
commands: []
findings_addressed: []
---
## Summary
Changed the widget.

## Evidence
All tests pass.
`

// Output with each file path dropped, so runs in different temp folders compare equal.
const strip = (out) => out.replace(/^(FAIL|warn|ok) +\S+/gm, '$1')

// Writes the plan (or another artifact) and the ticket into a fresh folder, then runs the
// validator. `args` builds the argument list from the two paths; by default `--ticket` comes
// first.
function run({ artifact, ticket = null, args = (p, t) => ['--ticket', t, p] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-tc-'))
  const planPath = path.join(dir, 'PLAN.md')
  fs.writeFileSync(planPath, artifact)
  const ticketPath = path.join(dir, 'ticket.md')
  if (ticket !== null) fs.writeFileSync(ticketPath, ticket)
  const r = spawnSync(process.execPath, [VALIDATE, ...args(planPath, ticketPath)], { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr, ticketPath }
}

test('R1a: --ticket as the last argument exits 2 with the exact stderr text', () => {
  const r = run({ artifact: plan('TP1'), args: (p) => [p, '--ticket'] })
  assert.equal(r.code, 2, r.out)
  assert.equal(r.stderr, 'brigade-validate: --ticket needs a file path\n')
})

test('R1b: --ticket before the plan path and after it give the same result', () => {
  const ticket = '# Ticket\n\n## Test plan\n- one\n- two\n'
  const before = run({ artifact: plan('TP1'), ticket, args: (p, t) => ['--ticket', t, p] })
  const after = run({ artifact: plan('TP1'), ticket, args: (p, t) => [p, '--ticket', t] })
  assert.equal(before.code, 1, before.out)
  assert.equal(after.code, before.code, after.out)
  assert.equal(strip(after.stdout), strip(before.stdout))
  assert.match(before.out, /ticket test plan has 1 TP items; the ticket's "Test plan" section has 2/)
})

test('R2 (adversarial): indented lines, a later heading and a level 4 heading are not counted', () => {
  const ticket = [
    '# Ticket',
    '',
    '#### Test plan',
    '- not this one',
    '',
    '## Testing',
    '- [ ] first',
    '  - sub-step',
    '- [x] second',
    '',
    '### Notes',
    '- note',
    '',
  ].join('\n')
  const two = run({ artifact: plan('TP1', 'TP2'), ticket })
  assert.equal(two.code, 0, two.out)
  assert.doesNotMatch(two.out, /ticket test plan has|cannot read ticket|ticket has no/)

  const three = run({ artifact: plan('TP1', 'TP2', 'TP3'), ticket })
  assert.equal(three.code, 1, three.out)
  assert.match(three.out, /ticket test plan has 3 TP items; the ticket's "Testing" section has 2/)
})

test('E1: ticket Test plan with 3 items against 2 TP lines fails with the exact text', () => {
  const ticket = '# Ticket\n\n## Test plan\n- a\n- b\n- c\n'
  const r = run({ artifact: plan('TP1', 'TP2'), ticket })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /FAIL {2}.*: ticket test plan has 2 TP items; the ticket's "Test plan" section has 3\n/)
})

test('E2: a ticket with no test plan section against 1 TP line fails with the exact text', () => {
  const ticket = '# Ticket\n\n## Description\n- make the widget\n'
  const r = run({ artifact: plan('TP1'), ticket })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /: plan has 1 TP items but the ticket has no Validation, Test plan or Testing section\n/)
})

test('E3: a missing ticket path fails with cannot read ticket <path>', () => {
  const r = run({ artifact: plan('TP1') })
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes(`: cannot read ticket ${r.ticketPath}\n`), r.out)
})

test('I1: the same --ticket run on a report file adds no problem', () => {
  const plain = run({ artifact: REPORT, args: (p) => [p] })
  const withTicket = run({ artifact: REPORT })
  assert.equal(plain.code, 0, plain.out)
  assert.equal(withTicket.code, plain.code, withTicket.out)
  assert.equal(strip(withTicket.stdout), strip(plain.stdout))
  assert.doesNotMatch(withTicket.out, /ticket/)
})

test('passing: a Validation section with "1. a" and "2) b" matches TP1 and TP2, both owned', () => {
  const ticket = '# Ticket\n\n### Validation\n1. a\n2) b\n'
  const r = run({ artifact: plan('TP1', 'TP2'), ticket })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1 checked, 0 nonconforming/)
})
