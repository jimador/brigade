// Tests for the mechanical checks the validator does in place of a reviewer.
//
//   W1  a plan item with more than 4 files warns.
//   W2  a file listed by 3 or more items that are not done warns.
//   W3  `model: haiku` on anything but a cook, or the literal `<model>`, warns on reports,
//       verdicts, plan checks, briefs and analyst reports.
//   W4  a report whose Evidence claims a red run or a falsification, with no `mutation:` line,
//       warns.
//   P1  a verdict that repeats a finding id fails.
//   I1  warnings never change the exit code, and clean files get no new message.
//
// Each test writes throwaway files and runs the real validator on them.
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

function run(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-mech-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

// A plan whose items are given as inline YAML lines; every item gets a packet section.
function plan(items) {
  const slugs = items.map((i) => i.match(/slug: ([^,}\s]+)/)[1])
  const packets = slugs.map((s) => `## Packet: ${s}\n\nDo the thing.\n`).join('\n')
  return `---
doc: plan
schema: 1
role: planner
model: claude-opus-5-5
created: 2026-07-04T03:10:00Z
ticket: local-1
source: local
items:
${items.map((i) => `  - ${i}`).join('\n')}
---
${packets}`
}

function item(slug, files, status = 'todo') {
  return `{ slug: ${slug}, status: ${status}, depends_on: [], heavy: false, contract: false, files: [${files.join(', ')}] }`
}

function report({ role = 'cook', model = 'claude-sonnet-5', evidence = 'ok 1 - widget\n# pass 1' } = {}) {
  return `---
doc: report
schema: 1
dish: local-1
item: widget
role: ${role}
model: ${model}
created: 2026-07-04T03:10:00Z
status: done
attempt: 1
branch: wip/local-1/widget
files_changed: []
commands: []
---
## Summary
Made the widget.

## Evidence
${evidence}

## Decisions
None.

## Out of scope
Nothing.
`
}

function verdict({ model = 'claude-opus-5-5', findings = [] } = {}) {
  const list = findings.length === 0
    ? 'findings: []'
    : 'findings:\n' + findings.map((id) => `  - { id: ${id}, severity: low, summary: nit }`).join('\n')
  return `---
doc: verdict
schema: 1
dish: local-1
item: widget
role: inspector
model: ${model}
created: 2026-07-04T03:10:00Z
verdict: PASS
attempt_reviewed: 1
reran_gate: true
${list}
---
## Verdict
PASS.

## Findings
${findings.length === 0 ? 'None.' : findings.map((id) => `- ${id}: nit.`).join('\n')}

## Evidence check
Gate re-run, all green.
`
}

const PLACEHOLDER = (v) => `model "${v}" looks like the schema placeholder; write the model that produced this file`
const RED = 'report claims a red run but names no mutation: line'

test('W1: an item with 5 files warns with the exact text and exits 0', () => {
  const r = run('PLAN.md', plan([item('wide', ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'])]))
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes('item wide lists 5 files; the packet bar is 1-3 plus its own test (D13)'), r.out)
})

test('W1: an item with exactly 4 files does not warn', () => {
  const r = run('PLAN.md', plan([item('ok', ['a.js', 'b.js', 'c.js', 'a.test.js'])]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /lists \d+ files/)
})

test('W1: block-style items are counted too', () => {
  const text = plan([item('placeholder', ['x.js'])]).replace(
    /  - \{ slug: placeholder[^\n]*\n/,
    '  - slug: placeholder\n    status: todo\n    files: [a.js, b.js, c.js, d.js, e.js]\n',
  )
  const r = run('PLAN.md', text)
  assert.ok(r.out.includes('item placeholder lists 5 files'), r.out)
})

test('W2: a file listed by 3 open items warns with the exact text and exits 0', () => {
  const r = run('PLAN.md', plan([
    item('one', ['src/hot.js']),
    item('two', ['src/hot.js', 'src/b.js']),
    item('three', ['src/hot.js'], 'in_review'),
  ]))
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes('src/hot.js is listed by 3 items (one, two, three); make them one slice or split the file (D13)'), r.out)
})

test('W2: done items do not count toward a chain', () => {
  const r = run('PLAN.md', plan([
    item('one', ['src/hot.js'], 'done'),
    item('two', ['src/hot.js']),
    item('three', ['src/hot.js']),
  ]))
  assert.doesNotMatch(r.out, /is listed by/)
})

test('W3: model haiku on a verdict warns and exits 0', () => {
  const r = run('widget-verdict.md', verdict({ model: 'haiku' }))
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes(PLACEHOLDER('haiku')), r.out)
})

test('W3: the literal <model> warns, even on a cook report', () => {
  const r = run('widget-cook.md', report({ model: '<model>' }))
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes(PLACEHOLDER('<model>')), r.out)
})

test('W3 adversarial: model haiku on a cook report does not warn', () => {
  const r = run('widget-cook.md', report({ model: 'haiku' }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /schema placeholder/)
})

test('W3: a quoted haiku on a non-cook report still warns', () => {
  const r = run('widget-cook.md', report({ role: 'cook-heavy', model: '"haiku"' }))
  assert.ok(r.out.includes(PLACEHOLDER('haiku')), r.out)
})

test('W4: Evidence that says red with no mutation line warns and exits 0', () => {
  const r = run('widget-cook.md', report({ evidence: 'Red before the fix:\nnot ok 1 - widget' }))
  assert.equal(r.code, 0, r.out)
  assert.ok(r.out.includes(RED), r.out)
})

test('W4: a falsification claim with no mutation line warns', () => {
  const r = run('widget-cook.md', report({ evidence: 'Falsified the test by hand; it failed.' }))
  assert.ok(r.out.includes(RED), r.out)
})

test('W4 adversarial: a mutation: line inside a fenced block counts', () => {
  const evidence = 'Red run:\n```\n## not a heading, just pasted output\nmutation: return 0 instead of n in widget()\nnot ok 1 - widget\n```'
  const r = run('widget-cook.md', report({ evidence }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /red run/)
})

test('W4: words that only contain "red" do not count', () => {
  const r = run('widget-cook.md', report({ evidence: 'Covered and stored; tired but ordered.\nok 1' }))
  assert.doesNotMatch(r.out, /red run/)
})

test('P1: a repeated finding id fails with the exact text', () => {
  const r = run('widget-verdict.md', verdict({ findings: ['F1', 'F2', 'F1'] }))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('duplicate finding id: F1'), r.out)
})

test('I1: clean files get no new message', () => {
  for (const [name, text] of [
    ['PLAN.md', plan([item('one', ['a.js', 'a.test.js']), item('two', ['b.js'])])],
    ['widget-cook.md', report()],
    ['widget-verdict.md', verdict({ findings: ['F1', 'F2'] })],
  ]) {
    const r = run(name, text)
    assert.equal(r.code, 0, r.out)
    assert.doesNotMatch(r.out, /^(warn|FAIL) /m, r.out)
  }
})
