// Tests that the verdict schema has one source, scripts/lib/schemas.mjs, and that everything
// else that describes a verdict agrees with it. One test per guarantee:
//   E1  brigade-validate takes severities, verdict values, keys, budget and sections from the module
//   E2  the workflows get the same doc text and return schema, and the bundler catches drift
//   E3  SCHEMAS.md's verdict section matches the module, and stops matching when either side moves;
//       its body-section list must equal the module's list exactly, so an added, dropped or
//       reordered section on either side fails
//   I1  scripts/brigade-bundle --check passes on the committed tree
// Set BRIGADE_SCHEMAS_MODULE to a scratch copy of the module to see the checks against it.
// Run with `node --test test/scripts/*.test.mjs`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE_PATH = process.env.BRIGADE_SCHEMAS_MODULE
  ? path.resolve(process.env.BRIGADE_SCHEMAS_MODULE)
  : path.join(ROOT, 'scripts', 'lib', 'schemas.mjs')
const schemas = await import(pathToFileURL(MODULE_PATH).href)
const { SEVERITIES, VERDICT_VALUES, VERDICT, SCHEMA_VERDICT_RETURN } = schemas

// Scratch folders the tests make, removed when the file is done.
const scratch = []
after(() => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }) })
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); scratch.push(dir); return dir }

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const SCHEMAS_MD = read('skills', 'brigade', 'SCHEMAS.md')

// Envelope keys every artifact carries; the verdict's own keys come after these.
const ENVELOPE = ['doc', 'schema', 'dish', 'item', 'role', 'model', 'created']
// Keys SCHEMAS.md shows that the validator does not require.
const OPTIONAL = ['trivial_only']

// SCHEMAS.md's `verdict` section, from its heading to the next ### heading.
function verdictSection(md) {
  const start = md.indexOf('### `verdict`')
  assert.ok(start >= 0, 'SCHEMAS.md has no ### `verdict` heading')
  const next = md.indexOf('\n### ', start + 1)
  return md.slice(start, next < 0 ? md.length : next)
}

// The backticked `## …` names in the "Body sections, in order:" sentence, in the order written.
// The sentence ends at the first full stop outside parentheses, so the notes in brackets after
// each name stay part of it. Takes prose with its whitespace already collapsed.
function bodySections(prose) {
  const lead = 'Body sections, in order:'
  const start = prose.indexOf(lead)
  if (start < 0) return []
  let depth = 0
  let end = prose.length
  for (let i = start + lead.length; i < prose.length; i++) {
    const c = prose[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === '.' && depth === 0) { end = i; break }
  }
  return [...prose.slice(start, end).matchAll(/`(## [^`]+)`/g)].map((m) => m[1])
}

// Everything in SCHEMAS.md's verdict section that disagrees with the module, one line each.
function mismatches(mod, md) {
  const out = []
  const section = verdictSection(md)
  const fence = section.match(/```yaml\n([\s\S]*?)\n```/)
  if (!fence) return ['no ```yaml block in the verdict section']
  const yaml = fence[1]
  const keys = yaml.split('\n').map((l) => l.match(/^([a-z_]+):/)).filter(Boolean).map((m) => m[1])
  const own = keys.filter((k) => !ENVELOPE.includes(k) && !OPTIONAL.includes(k))
  if (JSON.stringify(own) !== JSON.stringify(mod.VERDICT.keys)) {
    out.push(`keys: SCHEMAS.md has ${own.join(',')}, module has ${mod.VERDICT.keys.join(',')}`)
  }
  const verdictEnum = (yaml.match(/^verdict:.*#\s*([A-Z|]+)\s*$/m) || [])[1]
  if (verdictEnum !== mod.VERDICT_VALUES.join('|')) {
    out.push(`verdict values: SCHEMAS.md has ${verdictEnum}, module has ${mod.VERDICT_VALUES.join('|')}`)
  }
  const severityEnum = (yaml.match(/severity:\s*([a-z|]+)/) || [])[1]
  if (severityEnum !== mod.SEVERITIES.join('|')) {
    out.push(`severities: SCHEMAS.md has ${severityEnum}, module has ${mod.SEVERITIES.join('|')}`)
  }
  const prose = section.replace(/\s+/g, ' ')
  if (!prose.includes(`Budget: ≤ ${mod.VERDICT.budget} lines.`)) out.push(`budget ${mod.VERDICT.budget} not stated in SCHEMAS.md`)
  const listed = bodySections(prose)
  if (JSON.stringify(listed) !== JSON.stringify(mod.VERDICT.sections)) {
    out.push(`sections: SCHEMAS.md has ${listed.join(',')}, module has ${mod.VERDICT.sections.join(',')}`)
  }
  if (!section.includes(mod.VERDICT.doc)) out.push('VERDICT.doc does not appear verbatim in SCHEMAS.md\'s verdict section')
  return out
}

// A copy of the module with one value changed, for the "fails when the module moves" checks.
const mutated = (patch) => structuredClone({ SEVERITIES, VERDICT_VALUES, VERDICT, SCHEMA_VERDICT_RETURN, ...patch })

test('E1 brigade-validate takes the verdict schema from the module', () => {
  const src = read('scripts', 'brigade-validate')
  assert.match(src, /^import \{[^}]*\bSEVERITIES\b[^}]*\} from '\.\/lib\/schemas\.mjs'$/m)
  for (const literal of ["'blocking', 'high'", "'PASS', 'FAIL'", "'## Evidence check'", "'attempt_reviewed'"]) {
    assert.ok(!src.includes(literal), `brigade-validate still has its own copy: ${literal}`)
  }

  const dir = tempDir('schemas-single-source-')
  const file = path.join(dir, 'a-verdict.md')
  const write = (verdict, severity) => fs.writeFileSync(file, [
    '---', 'doc: verdict', 'schema: 1', 'dish: dish', 'item: a', 'role: inspector', 'model: sonnet',
    'created: 2026-01-01T00:00:00Z', `verdict: ${verdict}`, 'attempt_reviewed: 1', 'reran_gate: true',
    'findings:', `  - { id: F1, severity: ${severity}, location: "x.js:1", summary: s }`, 'trivial_only: false', '---', '',
    '## Verdict', verdict, '', '## Findings', 'F1', '', '## Evidence check', 'ran it', '',
  ].join('\n'))
  const validate = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brigade-validate'), file], { encoding: 'utf8' })
  for (const severity of SEVERITIES) {
    write('FAIL', severity)
    const r = validate()
    assert.equal(r.status, 0, `${severity} rejected:\n${r.stdout}${r.stderr}`)
  }
  write('FAIL', 'severe')
  assert.match(validate().stdout, /invalid finding severity: severe/)
  write('MAYBE', 'low')
  assert.match(validate().stdout, /invalid verdict: MAYBE/)
})

test('E2 the workflows carry the module\'s verdict text and return schema', () => {
  const config = read('workflows', 'config.js')
  const evaluated = new Function(config + '; return { MD_SCHEMA_BLOCKS, SCHEMA_VERDICT_RETURN }')()
  assert.equal(evaluated.MD_SCHEMA_BLOCKS.verdict, VERDICT.doc)
  assert.deepEqual(evaluated.SCHEMA_VERDICT_RETURN, SCHEMA_VERDICT_RETURN)

  // The text the inspector is shown comes from the generated execute workflow itself.
  const execute = read('workflows', 'brigade-execute.js')
  const region = execute.match(/\/\/ @schemas:begin verdict-doc\n([\s\S]*?)\n\s*\/\/ @schemas:end verdict-doc/)
  assert.ok(region, 'brigade-execute.js has no generated verdict-doc entry')
  assert.equal(new Function(`return {${region[1]}}`)().verdict, VERDICT.doc)
  assert.match(execute, /\$\{MD_SCHEMA_BLOCKS\.verdict\}/)
})

test('E2 brigade-bundle --check fails when config.js drifts from the module, and a bundle run repairs it', () => {
  const dir = tempDir('schemas-bundle-')
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'scripts', 'brigade-bundle'), path.join(dir, 'scripts', 'brigade-bundle'))
  fs.cpSync(path.join(ROOT, 'workflows'), path.join(dir, 'workflows'), { recursive: true })
  const lib = path.join(dir, 'scripts', 'lib', 'schemas.mjs')
  const original = read('scripts', 'lib', 'schemas.mjs')
  fs.writeFileSync(lib, original.replace("['blocking', 'high', 'medium', 'low']", "['blocking', 'severe', 'medium', 'low']"))
  const bundle = (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'brigade-bundle'), ...args], { encoding: 'utf8' })

  const stale = bundle('--check')
  assert.equal(stale.status, 1)
  assert.match(stale.stdout, /STALE: workflows\/config\.js/)

  assert.equal(bundle().status, 0)
  assert.match(fs.readFileSync(path.join(dir, 'workflows', 'config.js'), 'utf8'), /severity: \{ enum: \['blocking', 'severe', 'medium', 'low'\] \}/)
  assert.equal(bundle('--check').stdout.trim(), 'BUNDLE OK')

  // A hand edit to the generated entry is drift too.
  const configPath = path.join(dir, 'workflows', 'config.js')
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('Budget: ≤ 150 lines.`,', 'Budget: ≤ 999 lines.`,'))
  assert.equal(bundle('--check').status, 1)
})

test('E3 SCHEMAS.md\'s verdict section matches the module', () => {
  assert.deepEqual(mismatches(schemas, SCHEMAS_MD), [])
})

test('E3 the comparison fails when either side changes', () => {
  const swapSeverity = mutated({ SEVERITIES: ['blocking', 'severe', 'medium', 'low'] })
  assert.ok(mismatches(swapSeverity, SCHEMAS_MD).some((m) => m.startsWith('severities')))
  const moreValues = mutated({ VERDICT_VALUES: ['PASS', 'FAIL', 'SKIP'] })
  assert.ok(mismatches(moreValues, SCHEMAS_MD).some((m) => m.startsWith('verdict values')))
  const droppedKey = mutated({ VERDICT: { ...VERDICT, keys: VERDICT.keys.slice(1) } })
  assert.ok(mismatches(droppedKey, SCHEMAS_MD).some((m) => m.startsWith('keys')))
  const otherBudget = mutated({ VERDICT: { ...VERDICT, budget: 120 } })
  assert.ok(mismatches(otherBudget, SCHEMAS_MD).some((m) => m.startsWith('budget')))
  const otherDoc = mutated({ VERDICT: { ...VERDICT, doc: VERDICT.doc.replace('Analyst.', 'Analyst, Scout.') } })
  assert.ok(mismatches(otherDoc, SCHEMAS_MD).some((m) => m.startsWith('VERDICT.doc')))
  const droppedSection = mutated({ VERDICT: { ...VERDICT, sections: VERDICT.sections.slice(0, -1) } })
  assert.ok(mismatches(droppedSection, SCHEMAS_MD).some((m) => m.startsWith('sections')))
  const extraSection = mutated({ VERDICT: { ...VERDICT, sections: [...VERDICT.sections, '## Notes'] } })
  assert.ok(mismatches(extraSection, SCHEMAS_MD).some((m) => m.startsWith('sections')))
  const swappedSections = mutated({ VERDICT: { ...VERDICT, sections: [VERDICT.sections[1], VERDICT.sections[0], ...VERDICT.sections.slice(2)] } })
  assert.ok(mismatches(swappedSections, SCHEMAS_MD).some((m) => m.startsWith('sections')))

  const mdSeverity = SCHEMAS_MD.replace('severity: blocking|high|medium|low', 'severity: blocking|high|low')
  assert.ok(mismatches(schemas, mdSeverity).some((m) => m.startsWith('severities')))
  const mdKey = SCHEMAS_MD.replace('reran_gate: true ', 'reran: true ')
  assert.ok(mismatches(schemas, mdKey).some((m) => m.startsWith('keys')))
  const mdDroppedSection = SCHEMAS_MD.replace(', `## Evidence\ncheck` (what was re-run, verbatim result tail)', '')
  assert.notEqual(mdDroppedSection, SCHEMAS_MD)
  assert.ok(mismatches(schemas, mdDroppedSection).some((m) => m.startsWith('sections')))
})

test('I1 scripts/brigade-bundle --check passes', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brigade-bundle'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout.trim(), 'BUNDLE OK')
})
