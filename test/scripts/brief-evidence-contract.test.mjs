// Tests that scouts get one evidence contract for their briefs. SCHEMAS.md lets a brief cite
// read-only command output for a system that is not code; the brief block the research
// workflow pastes into scout prompts, and the scout agent itself, have to say the same thing.
// One test per guarantee:
//   E1  the injected brief block and the scout agent allow the literal read-only command and its
//       sanitized output (no secrets, no customer rows, schema and counts only), cited as
//       `cmd: <command>` in sources, and rule out write commands
//   E2  the generated research workflow's brief block and SCHEMAS.md's brief section agree that
//       read-only command output is evidence
// Plus an adversarial case: the old "the code itself, nothing else" wording fails the checks.
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

// Collapses runs of whitespace so a phrase still matches when the prose wraps mid-sentence.
const flat = (text) => text.replace(/\s+/g, ' ')

// The brief block out of a workflow file: the template literal after `brief: `, with its
// escaped backticks turned back into plain ones.
function briefBlock(source) {
  const start = source.indexOf('  brief: `Producer: scout.')
  assert.ok(start >= 0, 'no brief block in the workflow')
  const body = source.slice(start + '  brief: `'.length)
  const end = body.search(/(?<!\\)`,\n/)
  assert.ok(end >= 0, 'brief block never closes')
  return body.slice(0, end).replace(/\\`/g, '`')
}

// SCHEMAS.md's brief section, from its heading to the next ### heading.
function schemasBriefSection(md) {
  const start = md.indexOf('### `brief`')
  assert.ok(start >= 0, 'SCHEMAS.md has no ### `brief` heading')
  const next = md.indexOf('\n### ', start + 1)
  return md.slice(start, next < 0 ? md.length : next)
}

// What a text is missing from the evidence contract, one line each. Empty means it holds.
function contractGaps(text) {
  const t = flat(text).toLowerCase()
  const out = []
  if (!t.includes('read-only command')) out.push('does not allow read-only command output')
  if (!t.includes('cmd: <command>')) out.push('does not cite commands as `cmd: <command>`')
  if (!t.includes('no secrets')) out.push('does not forbid secrets')
  if (!t.includes('no customer rows')) out.push('does not forbid customer rows')
  if (!t.includes('schema and counts only')) out.push('does not limit output to schema and counts')
  if (!/write command[^.]*never evidence/.test(t)) out.push('does not rule out write commands')
  if (t.includes('the code itself, nothing else')) out.push('still says the code is the only authority')
  return out
}

const RESEARCH = read('workflows', 'brigade-research.js')
const CONFIG = read('workflows', 'config.js')
const SCOUT = read('agents', 'brigade-scout.md')
const SCHEMAS_BRIEF = schemasBriefSection(read('skills', 'brigade', 'SCHEMAS.md'))

test('E1: the brief block injected into scout prompts carries the evidence contract', () => {
  assert.ok(RESEARCH.includes('${MD_SCHEMA_BLOCKS.brief}'), 'the research workflow no longer injects the brief block')
  assert.deepEqual(contractGaps(briefBlock(RESEARCH)), [])
  assert.deepEqual(contractGaps(briefBlock(CONFIG)), [])
  assert.match(briefBlock(RESEARCH), /^ {2}- "cmd: [^"]+"/m, 'the sources example shows no cmd: entry')
})

test('E1: the scout agent carries the same evidence contract', () => {
  assert.deepEqual(contractGaps(SCOUT), [])
})

test('E2: the generated research brief block and SCHEMAS.md agree on read-only command output', () => {
  const block = flat(briefBlock(RESEARCH)).toLowerCase()
  const schemas = flat(SCHEMAS_BRIEF).toLowerCase()
  for (const phrase of ['read-only command', 'never evidence']) {
    assert.ok(schemas.includes(phrase), `SCHEMAS.md's brief section does not say "${phrase}"`)
    assert.ok(block.includes(phrase), `the research workflow's brief block does not say "${phrase}"`)
  }
  const sourcesComment = (text) => (text.match(/^sources:.*#\s*(.+)$/m) || [])[1]?.trim()
  assert.equal(sourcesComment(briefBlock(RESEARCH)), sourcesComment(SCHEMAS_BRIEF))
})

test('adversarial: the old code-only wording fails the contract checks', () => {
  const old = 'sources: # authority: the code itself, nothing else\nEverything pasted is verbatim from the working tree.'
  const gaps = contractGaps(old)
  assert.ok(gaps.includes('does not allow read-only command output'))
  assert.ok(gaps.includes('still says the code is the only authority'))
})
