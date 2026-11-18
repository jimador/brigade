// Tests for the optional `## Confusions` section of a cook report. A cook lists one line per
// part of the packet that read two ways; the validator caps the section so it stays short.
//
//   E1  a `## Confusions` section with more than 8 non-empty lines is a problem:
//       `report "## Confusions" has <n> non-empty lines; budget is 8`.
//   I1  a report without the section, or with 8 or fewer non-empty lines in it, gets no new
//       problem. Blank lines don't count, and counting stops at the next `## ` heading.
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

// A valid done report; `extra` is body text placed after the usual sections.
function report(extra = '') {
  return `---
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
---
## Summary
Made the widget.

## Evidence
ok 1 - widget
# pass 1

## Decisions
None.

## Out of scope
Nothing.
${extra}`
}

// A Confusions section with `n` lines, one per packet part that read two ways.
function confusions(n, sep = '\n') {
  const lines = Array.from({ length: n }, (_, i) => `- Step ${i + 1}: read two ways; assumed the first.`)
  return `\n## Confusions\n${lines.join(sep)}\n`
}

function run(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-conf-'))
  const file = path.join(dir, 'widget-cook.md')
  fs.writeFileSync(file, text)
  const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('E1: 9 non-empty Confusions lines fail with the exact text', () => {
  const r = run(report(confusions(9)))
  assert.equal(r.code, 1, r.out)
  assert.ok(r.out.includes('report "## Confusions" has 9 non-empty lines; budget is 8'), r.out)
})

test('I1a: exactly 8 non-empty lines with blank lines between them pass', () => {
  const r = run(report(confusions(8, '\n\n')))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /Confusions/)
})

test('I1b: a report without a Confusions section passes', () => {
  const r = run(report())
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /Confusions/)
})

test('I1c: a Confusions section followed by ## Blocked counts only the lines before it', () => {
  const blocked = '\n## Blocked\n' + Array.from({ length: 5 }, (_, i) => `Contradiction ${i + 1}.`).join('\n') + '\n'
  const r = run(report(confusions(8) + blocked))
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /Confusions/)
})
