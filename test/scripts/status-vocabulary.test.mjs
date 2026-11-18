// Checks that the config template and the ticket schema agree on Brigade's ticket statuses.
// The template's "Status mapping" section and the status list in SCHEMAS.md's `ticket` type
// must name the same set, so adding a status in one place without the other fails here.
//
//   E1: the template's abstract keys equal the schema's status list.
//   E2: both sets include `rework` and `merging`.
//   E3: the `rework` line is active and the `merging` line ships commented out.
//   E4: the check catches drift: dropping `rework` from a copy of the template breaks E1.
//
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'skills', 'brigade', 'templates', 'config.md'), 'utf8')
const SCHEMAS = fs.readFileSync(path.join(ROOT, 'skills', 'brigade', 'SCHEMAS.md'), 'utf8')

// Finds the template's status mapping lines, from just after the heading up to the next heading.
// A commented `# - merging:` line is still a key, so only a real heading (`## ` and deeper) ends it.
function mappingLines(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim().startsWith('### Status mapping'))
  assert.ok(start >= 0, 'template has a ### Status mapping section')
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,6} /.test(line)) break
    if (/^#?\s*- ([a-z_]+):/.test(line)) out.push(line)
  }
  return out
}

function templateKeys(text) {
  return new Set(mappingLines(text).map((l) => l.match(/^#?\s*- ([a-z_]+):/)[1]))
}

// Reads the first backticked `a|b|c` list after the `ticket` type heading.
function schemaStatuses(text) {
  const at = text.indexOf('### `ticket`')
  assert.ok(at >= 0, 'SCHEMAS.md has a ### `ticket` section')
  const m = text.slice(at).match(/\(`([a-z_|]+)`\)/)
  assert.ok(m, 'ticket section has a status list')
  return new Set(m[1].split('|'))
}

const sorted = (set) => [...set].sort()

test('E1: template status keys equal the ticket schema status list', () => {
  assert.deepEqual(sorted(templateKeys(TEMPLATE)), sorted(schemaStatuses(SCHEMAS)))
})

test('E2: both sets include rework and merging', () => {
  for (const set of [templateKeys(TEMPLATE), schemaStatuses(SCHEMAS)]) {
    assert.ok(set.has('rework'), 'rework present')
    assert.ok(set.has('merging'), 'merging present')
  }
})

test('E3: rework is active and merging ships commented out', () => {
  const lines = mappingLines(TEMPLATE)
  const rework = lines.filter((l) => /^#?\s*- rework:/.test(l))
  const merging = lines.filter((l) => /^#?\s*- merging:/.test(l))
  assert.equal(rework.length, 1)
  assert.equal(merging.length, 1)
  assert.ok(!rework[0].startsWith('#'), 'rework line is not commented')
  assert.ok(merging[0].startsWith('# - merging:'), 'merging line is commented')
})

test('E4: removing rework from the template makes the sets differ', () => {
  const drifted = TEMPLATE.split('\n').filter((l) => !/^- rework:/.test(l)).join('\n')
  assert.notEqual(drifted, TEMPLATE, 'the copy really lost its rework line')
  const keys = templateKeys(drifted)
  assert.ok(!keys.has('rework'))
  assert.notDeepEqual(sorted(keys), sorted(schemaStatuses(SCHEMAS)))
})
