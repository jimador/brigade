// Tests for the mechanical checks the validator does in place of a reviewer.
//
//   W1  a plan item with more than 4 files warns.
//   W2  a file listed by 3 or more items that are not done warns.
//   E1  W1 skips done items.
//   E2  W1 and W2 skip files git marks linguist-generated.
//   E3  outside a git work tree nothing counts as generated, so the warnings stay.
//   W3  `model: haiku` on anything but a cook, or the literal `<model>`, warns on reports,
//       verdicts, plan checks, briefs and analyst reports.
//   W4  a report whose Evidence claims a red run or a falsification, with no `mutation:` line,
//       warns.
//   P1  a verdict that repeats a finding id fails.
//   E1  finding fields are read from the real key, never from `id:` text inside a quoted
//       string or a `#` comment.
//   E2  a fence closes only on a bare line of the same character, at least as long as the
//       opener, so a three-backtick line inside a four-backtick block is content.
//   E1  a quoted summary that wraps onto the next line stays quoted there, so the fields
//       after its closing quote are still read.
//   E2  only a list dash at the start of a line lets a quote open after it; a dash inside
//       a plain summary is text.
//   E1  a quote opens only where a value starts: after `key:`, after a line-leading dash,
//       or after `[` or `,` in a `[...]` list; a comma or `{` alone never opens one.
//   E2  so the adversarial corpus reads exactly the real ids and severities.
//   I1  warnings never change the exit code, and clean files get no new message.
//
// Each test writes throwaway files and runs the real validator on them.
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
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

// Like run, but inside a fresh git repo whose .gitattributes marks gen/*.js generated.
function runInGit(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-mech-git-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'gen/*.js linguist-generated=true\n')
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
    : 'findings:\n' + findings.map((f) => `  - ${f.startsWith('{') ? f : `{ id: ${f}, severity: low, summary: nit }`}`).join('\n')
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
${findings.length === 0 ? 'None.' : findings.map((f) => `- ${f}: nit.`).join('\n')}

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

test('E1: a done item with 6 files does not warn', () => {
  const r = runInGit('PLAN.md', plan([item('landed', ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'], 'done')]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /lists \d+ files/, r.out)
})

test('E2: 3 source files plus 3 generated files do not warn', () => {
  const r = runInGit('PLAN.md', plan([item('bundled', ['a.js', 'b.js', 'a.test.js', 'gen/x.js', 'gen/y.js', 'gen/z.js'])]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /lists \d+ files/, r.out)
})

test('E2: the W1 count leaves out generated files', () => {
  const r = runInGit('PLAN.md', plan([item('wide', ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'gen/x.js'])]))
  assert.ok(r.out.includes('item wide lists 5 files; the packet bar is 1-3 plus its own test (D13)'), r.out)
})

test('E2: 3 open items sharing only a generated file raise no W2', () => {
  const r = runInGit('PLAN.md', plan([
    item('one', ['src/a.js', 'gen/x.js']),
    item('two', ['src/b.js', 'gen/x.js']),
    item('three', ['src/c.js', 'gen/x.js']),
  ]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /is listed by/, r.out)
})

test('E3: outside a git repo the same plans still warn', () => {
  const wide = run('PLAN.md', plan([item('bundled', ['a.js', 'b.js', 'a.test.js', 'gen/x.js', 'gen/y.js', 'gen/z.js'])]))
  assert.equal(wide.code, 0, wide.out)
  assert.ok(wide.out.includes('item bundled lists 6 files'), wide.out)
  const chain = run('PLAN.md', plan([
    item('one', ['src/a.js', 'gen/x.js']),
    item('two', ['src/b.js', 'gen/x.js']),
    item('three', ['src/c.js', 'gen/x.js']),
  ]))
  assert.equal(chain.code, 0, chain.out)
  assert.ok(chain.out.includes('gen/x.js is listed by 3 items'), chain.out)
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

test('E1: "id:" inside a quoted summary is not read as the finding id', () => {
  const r = run('widget-verdict.md', verdict({
    findings: [
      '{ summary: "The id: field is wrong here", id: F1, severity: low }',
      '{ summary: \'The id: field is also odd\', id: F2, severity: low }',
    ],
  }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /duplicate finding id/, r.out)
})

test('E1: "id:" after a # comment is not read either, and a real duplicate still fails', () => {
  const ok = run('widget-verdict.md', verdict({
    findings: ['{ # id: F9\n      id: F1, severity: low }', '{ # id: F9\n      id: F2, severity: low }'],
  }))
  assert.equal(ok.code, 0, ok.out)
  const dup = run('widget-verdict.md', verdict({
    findings: ['{ summary: "id: X", id: F1, severity: low }', '{ summary: "id: Y", id: F1, severity: low }'],
  }))
  assert.equal(dup.code, 1, dup.out)
  assert.ok(dup.out.includes('duplicate finding id: F1'), dup.out)
})

test('E1: severity comes from the real field, not from quoted text', () => {
  const r = run('widget-verdict.md', verdict({
    findings: ['{ summary: "The severity: bogus", id: F1, severity: low }'],
  }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /invalid finding severity/, r.out)
})

// A FAIL verdict whose findings list is written out as given, one line per array item.
function failVerdict(lines) {
  return verdict({ findings: ['F0'] })
    .replace('verdict: PASS', 'verdict: FAIL')
    .replace(/findings:\n  - [^\n]*\n/, `findings:\n${lines.join('\n')}\n`)
}

test('E1: a double-quoted summary that wraps keeps the id and severity after it', () => {
  const r = run('widget-verdict.md', failVerdict([
    '  - summary: "a long summary that',
    '      wraps here", id: F1, severity: low',
  ]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /FAIL verdict with no findings/, r.out)
})

test('E1: a closing quote that starts the continuation line does not open a new one', () => {
  const r = run('widget-verdict.md', failVerdict([
    '  - summary: "a long summary that wraps here',
    '      ", id: F1, severity: low',
  ]))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /FAIL verdict with no findings/, r.out)
})

test('E1: "id:" and "severity:" on the wrapped half of a quoted summary are not read', () => {
  const ok = run('widget-verdict.md', failVerdict([
    '  - summary: "a long summary that',
    '      cites id: F9 and severity: bogus", id: F1, severity: low',
    '  - { id: F9, severity: low, summary: nit }',
  ]))
  assert.equal(ok.code, 0, ok.out)
  const dup = run('widget-verdict.md', failVerdict([
    '  - summary: "a long summary that',
    '      cites id: F9", id: F1, severity: low',
    '  - { id: F1, severity: low, summary: nit }',
  ]))
  assert.equal(dup.code, 1, dup.out)
  assert.ok(dup.out.includes('duplicate finding id: F1'), dup.out)
})

const Q2 = "  - { summary: Fails on the input - 'x, id: F1, severity: high }"

test('E2: a dash inside a plain summary does not let an apostrophe hide the fields', () => {
  const ok = run('widget-verdict.md', failVerdict([Q2]))
  assert.equal(ok.code, 0, ok.out)
  const bad = run('widget-verdict.md', failVerdict([Q2.replace('high', 'bogus')]))
  assert.equal(bad.code, 1, bad.out)
  assert.ok(bad.out.includes('invalid finding severity: bogus'), bad.out)
  const dup = run('widget-verdict.md', failVerdict([Q2, '  - { id: F1, severity: low, summary: nit }']))
  assert.equal(dup.code, 1, dup.out)
  assert.ok(dup.out.includes('duplicate finding id: F1'), dup.out)
})

// The validator's own field reader, lifted out of the script so a test can see exactly
// which ids and severities it pulls from a findings list.
const readField = (() => {
  const src = fs.readFileSync(VALIDATE, 'utf8')
  const start = src.indexOf('function listEntries(')
  const end = src.indexOf('// --- writing checks')
  return new Function(`${src.slice(start, end)}\nreturn nestedFieldValues`)()
})()

// Each case is a findings list, the ids and severities the validator must read from it,
// and the problem the full validator must report on it as a FAIL verdict (null = clean).
const CORPUS = [
  ['quoted summary that says the id: field', [
    '  - { summary: "the id: field is wrong", id: F1, severity: low }',
    "  - { summary: 'the id: field again', id: F2, severity: high }",
  ], ['F1', 'F2'], ['low', 'high'], null],
  ['double-quoted summary that wraps and closes on the next line', [
    '  - summary: "a long summary that',
    '      cites id: F9 and closes here"',
    '    id: F1',
    '    severity: medium',
  ], ['F1'], ['medium'], null],
  ['plain summary with a dash before an apostrophe', [
    "  - { summary: Fails on the input - 'x, id: F1, severity: high }",
  ], ['F1'], ['high'], null],
  ['Q3: plain block summary with a comma before an apostrophe', [
    "  - summary: Rejects the input, 'x",
    '    id: F1',
    '    severity: high',
    '  - { id: F2, severity: low, summary: nit }',
  ], ['F1', 'F2'], ['high', 'low'], null],
  ['plain flow summary with a comma before an apostrophe', [
    "  - { summary: Rejects the input, 'x, id: F1, severity: high }",
  ], ['F1'], ['high'], null],
  ["plain summary with an apostrophe in don't", [
    "  - summary: don't stop",
    '    id: F1',
    '    severity: low',
  ], ['F1'], ['low'], null],
  ["quoted summary that contains , 'x'", [
    `  - { summary: "keeps , 'x' and id: F9 inside", id: F1, severity: blocking }`,
  ], ['F1'], ['blocking'], null],
  ['wrapped quoted summary, then a key whose quoted value says id:', [
    '  - summary: "wraps',
    "      here\", note: 'q, id: F9'",
    '    id: F1',
    '    severity: low',
  ], ['F1'], ['low'], null],
  ['a real duplicate id', [
    "  - summary: Rejects the input, 'x",
    '    id: F1',
    '    severity: low',
    '  - { id: F1, severity: low, summary: nit }',
  ], ['F1', 'F1'], ['low', 'low'], 'duplicate finding id: F1'],
  ['an invalid severity after a plain summary with an apostrophe', [
    "  - summary: Rejects the input, 'x",
    '    id: F1',
    '    severity: bogus',
  ], ['F1'], ['bogus'], 'invalid finding severity: bogus'],
]

test('adversarial corpus', async (t) => {
  for (const [name, lines, ids, severities, problem] of CORPUS) {
    await t.test(name, () => {
      const fm = ['verdict: FAIL', 'findings:', ...lines, 'reran_gate: true']
      assert.deepEqual(readField(fm, 'findings', 'id'), ids)
      assert.deepEqual(readField(fm, 'findings', 'severity'), severities)
      const r = run('widget-verdict.md', failVerdict(lines))
      assert.doesNotMatch(r.out, /FAIL verdict with no findings/, r.out)
      if (problem === null) {
        assert.equal(r.code, 0, r.out)
      } else {
        assert.equal(r.code, 1, r.out)
        assert.ok(r.out.includes(problem), r.out)
      }
    })
  }
})

const G3 = 'Red run:\n````\n```js\nconst a = 1\n## quoted heading\n````\nmutation: flipped'

test('E2: a three-backtick line inside a four-backtick block does not close it', () => {
  const r = run('widget-cook.md', report({ evidence: G3 }))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /red run/, r.out)
})

test('E2: the same report without the mutation line still warns', () => {
  const r = run('widget-cook.md', report({ evidence: G3.replace('\nmutation: flipped', '') }))
  assert.ok(r.out.includes(RED), r.out)
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
