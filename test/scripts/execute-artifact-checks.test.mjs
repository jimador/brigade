// Tests for the landing steward's artifact check and teardown in the execute workflow. Each test
// runs the generated workflows/brigade-execute.js with an agent() stub, the same way
// execute-verdict-postcondition.test.mjs does, and reads the prompts the stewards are given.
// One test per guarantee:
//   E1  every schema example in workflows/config.js and SCHEMAS.md is bare --- frontmatter with no
//       yaml fence, and, filled in, validates with a clean ok line and no warning
//   E2  the land prompt runs brigade-validate on the verdict and the report and treats anything
//       but an ok line as invalid, handled like a missing file
//   E2  brigade-validate really prints no ok line for a placeholder model (exit 0) or a fenced
//       frontmatter, so reading the line is what catches them
//   E2  the report reconstruction the steward writes passes brigade-validate itself
//   E2  the verdict probe reads the ok line too, and a transcribed verdict lands in reconstructed
//   E3  teardown reads the worktree's status first and refuses with the exact line when it is dirty
// Run with `node --test test/scripts/*.test.mjs`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'workflows', 'brigade-execute.js'), 'utf8')
  .replace('export const meta', 'const meta')
const VALIDATE = path.join(ROOT, 'scripts', 'brigade-validate')

const REPO = '/path/to/repo'
const DISH = '/path/to/dish'
const VERDICT_PATH = `${DISH}/reports/a-verdict.md`
const REPORT_PATH = `${DISH}/reports/a-cook.md`
const WORKTREE = `${REPO}/.brigade/worktrees/d--a`
const BRANCH = 'wip/d/a'
const REFUSAL = `teardown refused: ${BRANCH} landed but ${WORKTREE} still has uncommitted changes`

const scratch = []
after(() => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }) })

const VERDICT_DOC = [
  '---', 'doc: verdict', 'schema: 1', 'dish: dish', 'item: a', 'role: inspector', 'model: m',
  'created: 2026-01-01T00:00:00Z', 'verdict: PASS', 'attempt_reviewed: 1', 'reran_gate: true',
  'findings: []', 'trivial_only: false', '---', '', '## Verdict', 'PASS', '', '## Findings', 'None.', '',
  '## Evidence check', 'Reran the gate.', '',
].join('\n')
const pass = (extra = {}) => ({ verdict: 'PASS', verdictPath: VERDICT_PATH, trivialOnly: false, findings: [], ...extra })
const hit = { exists: true, valid: true, detail: 'ok' }
const miss = { exists: true, valid: false, detail: 'warn placeholder model' }

// Runs the workflow for one item. `script` maps a label prefix to answers handed out in order;
// the last answer repeats. Every agent call and every log line is recorded.
async function run(script = {}) {
  const calls = []
  const logs = []
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const answer = (prefix, fallback) => {
    const q = queues[prefix]
    if (!q || !q.length) return fallback
    return q.length > 1 ? q.shift() : q[0]
  }
  const agent = async (prompt, opts) => {
    const label = opts.label
    calls.push({ label, prompt })
    if (label.startsWith('steward-create:')) return { ok: true, detail: 'created' }
    if (label.startsWith('steward-land:')) return answer('steward-land:', { ok: true, detail: 'landed', landedRange: 'a..b', reconstructed: [] })
    if (label.startsWith('cook:')) return { status: 'done', attempt: 1, branch: BRANCH, reportPath: REPORT_PATH, filesChanged: ['x.js'], summary: 's' }
    for (const prefix of ['inspect:', 'probe:', 'transcribe:']) {
      if (label.startsWith(prefix)) {
        const a = answer(prefix)
        if (a === undefined) throw new Error(`no scripted answer for ${label}`)
        return a
      }
    }
    if (label.startsWith('steward')) return { ok: true, detail: 'ok' }
    throw new Error(`unexpected agent call ${label}`)
  }
  const args = {
    dishDir: DISH, repoRoot: REPO, now: '2026-01-01T00:00:00Z', tier: 'two-star',
    deliverySlug: 'd', deliveryBranch: 'feat/d', gate: ['true'], maxParallel: 1, overrides: {}, promptOverrides: {},
    items: [{ slug: 'a', status: 'todo', dependsOn: [], heavy: false, packet: 'P' }],
  }
  const fn = new Function('args', 'phase', 'log', 'agent', 'parallel', 'pipeline', 'workflow', SRC)
  const ledger = await fn(args, () => {}, (line) => logs.push(line), agent, async (t) => Promise.all(t.map((f) => f())), undefined, undefined)
  const prompt = (re) => (calls.find((c) => re.test(c.label)) || {}).prompt
  return { item: ledger.items[0], calls, logs, prompt }
}

const flat = (s) => s.replace(/\s+/g, ' ')

// A temp repo with one dish, where brigade-validate can check a file as it would in a real run.
function tempDish() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'execute-artifact-checks-'))
  scratch.push(dir)
  fs.mkdirSync(path.join(dir, '.brigade', 'dishes', 'dish', 'reports'), { recursive: true })
  return dir
}
function validate(dir, name, text) {
  const file = path.join(dir, '.brigade', 'dishes', 'dish', 'reports', name)
  fs.writeFileSync(file, text)
  const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
  return { status: r.status, out: r.stdout + r.stderr }
}

test('E2: the land prompt validates the verdict and the report and reads the ok line', async () => {
  const { prompt } = await run({ 'inspect:': [pass()], 'probe:': [hit] })
  const land = prompt(/^steward-land:/)
  assert.ok(land, 'no steward-land call')
  assert.ok(land.includes(`Artifact check — run: head -3 ${VERDICT_PATH}`))
  assert.ok(land.includes(`\${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate '${VERDICT_PATH}'`))
  assert.ok(land.includes(`\${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate '${REPORT_PATH}'`))
  const text = flat(land)
  assert.match(text, /passes only when the validator prints a line starting ok that names it and ends \(verdict\), and no FAIL or warn line/)
  assert.match(text, /The same goes for the report with \(report\)/)
  assert.match(text, /handle an invalid artifact exactly like a missing one/)
  assert.match(text, /Verdict missing or invalid: do NOT land, and do NOT write a verdict/)
  assert.match(text, /Report missing or invalid: if the file exists but is invalid, first copy it to \S+a-cook\.md\.invalid/)
  assert.match(text, /If CLAUDE_PLUGIN_ROOT is empty in your shell/)
  assert.match(text, /never judge the file by eye/)
  // The validate calls come in step 1b, before anything is rebased or landed.
  assert.ok(land.indexOf('brigade-validate') < land.indexOf('1c. Prove there is something to land'))
})

test('E2: brigade-validate prints no ok line for a placeholder model or a fenced frontmatter', () => {
  const dir = tempDish()
  const good = validate(dir, 'a-verdict.md', VERDICT_DOC)
  assert.equal(good.status, 0, good.out)
  assert.match(good.out, /^ok\s+\S*a-verdict\.md \(verdict\)$/m)

  // A model copied from the schema example warns but still exits 0: only the line tells.
  const placeholder = validate(dir, 'b-verdict.md', VERDICT_DOC.replace('item: a', 'item: b').replace('model: m', 'model: haiku'))
  assert.equal(placeholder.status, 0, placeholder.out)
  assert.doesNotMatch(placeholder.out, /^ok/m)
  assert.match(placeholder.out, /^warn .*schema placeholder/m)

  const fenced = validate(dir, 'c-verdict.md', `\`\`\`yaml\n${VERDICT_DOC.replace('item: a', 'item: c')}\`\`\`\n`)
  assert.doesNotMatch(fenced.out, /^ok/m)
  assert.match(fenced.out, /^FAIL/m)
})

test('E2: the report reconstruction the steward writes passes brigade-validate', async () => {
  const { prompt } = await run({ 'inspect:': [pass()], 'probe:': [hit] })
  const land = prompt(/^steward-land:/)
  const start = land.indexOf('REPORT RECONSTRUCTION:\n')
  assert.ok(start >= 0, 'land prompt carries no report reconstruction')
  const block = land.slice(start + 'REPORT RECONSTRUCTION:\n'.length, land.indexOf('\n   If either check already passed'))
  // The steward adds the recovered marker inside the frontmatter, as the prompt tells it to.
  const written = block.replace(/^---\n/, '---\nreconstructed_by: steward\n')
  assert.notEqual(written, block)
  const r = validate(tempDish(), 'a-cook.md', written)
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /^ok\s+\S*a-cook\.md \(report\)$/m, r.out)
})

test('E2: the verdict probe reads the ok line, and a transcribed verdict is recorded in reconstructed', async () => {
  const direct = await run({ 'inspect:': [pass()], 'probe:': [hit] })
  const probe = flat(direct.prompt(/^probe:/))
  assert.match(probe, /passes only when the validator prints a line starting ok that names it and ends \(verdict\), and no FAIL or warn line/)
  assert.match(probe, /Anything else, a warning included, is false/)
  assert.match(probe, /If CLAUDE_PLUGIN_ROOT is empty in your shell/)
  assert.deepEqual(direct.item.reconstructed, [])

  // An invalid file (the probe's miss) with a usable returned text is transcribed, then lands.
  const healed = await run({ 'inspect:': [pass({ verdictDoc: VERDICT_DOC })], 'probe:': [miss, hit], 'transcribe:': [{ ok: true, detail: 'written' }] })
  assert.equal(healed.item.status, 'done')
  assert.deepEqual(healed.item.reconstructed, [VERDICT_PATH])

  // The steward's own report reconstruction and the transcription are both kept, once each.
  const both = await run({
    'inspect:': [pass({ verdictDoc: VERDICT_DOC })], 'probe:': [miss, hit], 'transcribe:': [{ ok: true, detail: 'written' }],
    'steward-land:': [{ ok: true, detail: 'landed', landedRange: 'a..b', reconstructed: [REPORT_PATH, VERDICT_PATH] }],
  })
  assert.deepEqual(both.item.reconstructed, [REPORT_PATH, VERDICT_PATH])
})

test('E3: teardown reads the worktree status first and refuses with the exact line when dirty', async () => {
  const { prompt } = await run({ 'inspect:': [pass()], 'probe:': [hit] })
  const land = prompt(/^steward-land:/)
  const step6 = land.slice(land.indexOf('6. Clean up'), land.indexOf('7. Re-run the porcelain check'))
  assert.ok(step6.length > 0, 'no step 6 in the land prompt')
  const status = step6.indexOf(`git -C ${WORKTREE} status --porcelain`)
  const ancestor = step6.indexOf('merge-base --is-ancestor')
  const remove = step6.indexOf(`worktree remove ${WORKTREE}`)
  const refusal = step6.indexOf(REFUSAL)
  assert.ok(ancestor >= 0 && status > ancestor, 'the status read must follow the ancestor check')
  assert.ok(refusal > status && remove > refusal, 'the refusal must come after the status read and before any removal')
  assert.match(flat(step6), /Refuse the teardown: remove nothing, delete no branch, and leave both the branch and the worktree in place/)
  assert.match(flat(step6), /Only when it prints nothing, tear down/)
})

test('E3: a landing whose teardown was refused still counts as landed and the refusal is logged', async () => {
  const { item, logs } = await run({
    'inspect:': [pass()], 'probe:': [hit],
    'steward-land:': [{ ok: true, detail: `${REFUSAL}\nstatus: M x.js`, landedRange: 'a..b', reconstructed: [] }],
  })
  assert.equal(item.status, 'done')
  assert.equal(item.landedRange, 'a..b')
  assert.ok(logs.some((line) => line.includes(REFUSAL)), logs.join('\n'))
})

// Every schema example that carries frontmatter: the prompt blocks in workflows/config.js and the
// type sections of SCHEMAS.md. The common envelope is listed apart: it shows only the keys every
// type shares, so it is not a whole artifact on its own.
function schemaExamples() {
  const config = fs.readFileSync(path.join(ROOT, 'workflows', 'config.js'), 'utf8')
  const blocks = new Function(config + '; return MD_SCHEMA_BLOCKS')()
  const md = fs.readFileSync(path.join(ROOT, 'skills', 'brigade', 'SCHEMAS.md'), 'utf8')
  const examples = Object.entries(blocks).map(([type, text]) => ({ from: `config.js ${type}`, text }))
  for (const section of md.split(/\n(?=### `)/).slice(1)) {
    const type = section.match(/^### `([a-z_]+)`/)[1]
    // Roadmap types live outside a dish; brigade-validate-roadmap.test.mjs checks their examples.
    if (type.startsWith('roadmap')) continue
    if (/^doc: /m.test(section)) examples.push({ from: `SCHEMAS.md ${type}`, text: section })
  }
  const envelope = md.slice(md.indexOf('## The common envelope'), md.indexOf('## Type registry'))
  return { examples, envelope }
}

// Turns an example's frontmatter into a filled-in file the way an agent would: comments dropped,
// <placeholders> filled, a documented `a|b|c` choice resolved to its first value.
function instantiate(yaml) {
  return yaml.split('\n').map((l) => l.replace(/\s+#.*$/, '')).filter((l) => l.trim()).join('\n')
    .replace(/<[^>]*>/g, 'sample')
    .replace(/(:\s*)([A-Za-z][\w-]*(?:\|[A-Za-z][\w-]*)+)/g, (_m, lead, alts) => lead + alts.split('|')[0])
}

// Where each type lives in a dish, and the body it needs to pass.
const PLACES = {
  brief: 'briefs/1-sample.md', report: 'reports/sample-cook.md', verdict: 'reports/sample-verdict.md',
  ledger: 'state/sample.md', plan: 'PLAN.md', research: 'research/sample.md', plan_check: 'reports/plan-check-1.md',
  analyst: 'analyst.md', design_swag: 'DESIGN.md', review_report: '../../reviews/sample/report.md',
  red_team: 'reports/red-team-0123abc.md',
}
function bodyFor(type, text) {
  if (type === 'ledger') return '## Canon\n\nC1. Sample.\n\n## World state\n\nW1. [RELIABLE] Sample.\n'
  const prose = text.replace(/\s+/g, ' ')
  const at = prose.indexOf('Body sections')
  const named = at < 0 ? [] : [...prose.slice(at).matchAll(/`(## [^`<]+)`/g)].map((m) => m[1])
  const sections = [...new Set(named)]
  if (type === 'plan') sections.push('## Packet: sample')
  return sections.map((s) => `${s}\n\nSample.\n`).join('\n')
}

test('E1: every schema example is bare --- frontmatter and validates with a clean ok line', () => {
  const { examples, envelope } = schemaExamples()
  const seen = new Set()
  for (const { from, text } of examples) {
    assert.doesNotMatch(text, /^```yaml$/m, `${from} still wraps its example in a yaml fence`)
    const fm = text.match(/^---\n([\s\S]*?)\n---$/m)
    assert.ok(fm, `${from} has no bare --- frontmatter`)
    let yaml = instantiate(fm[1])
    const type = yaml.match(/^doc: (\S+)/m)[1]
    seen.add(type)
    // The plan example lists every choice for an item at once; one real item depends on nothing
    // and gives a reason only on an escalation, and its packet section follows.
    if (type === 'plan') yaml = yaml.replace('[sample...]', '[]').replace(/,\s*reason: \w+/, '')
    assert.ok(PLACES[type], `${from}: no place known for type ${type}`)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'execute-artifact-checks-e1-'))
    scratch.push(dir)
    const file = path.join(dir, '.brigade', 'dishes', 'sample', PLACES[type])
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `---\n${yaml}\n---\n\n${bodyFor(type, text)}`)
    const r = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
    const out = r.stdout + r.stderr
    assert.equal(r.status, 0, `${from}:\n${out}`)
    assert.doesNotMatch(out, /^(FAIL|warn)/m, `${from}:\n${out}`)
    assert.match(out, new RegExp(`^ok\\s+\\S+ \\(${type}\\)$`, 'm'), `${from}:\n${out}`)
  }
  for (const type of ['brief', 'report', 'verdict', 'ledger', 'review_report', 'plan', 'research', 'plan_check', 'analyst', 'design_swag', 'red_team']) {
    assert.ok(seen.has(type), `no ${type} example was checked`)
  }

  // The common envelope is bare too, and its model is not one the validator calls a placeholder.
  assert.doesNotMatch(envelope, /^```yaml$/m, 'the common envelope still sits in a yaml fence')
  const head = envelope.match(/^---\n([\s\S]*?)\n---$/m)
  assert.ok(head, 'the common envelope has no bare --- frontmatter')
  const model = instantiate(head[1]).match(/^model: (.*)$/m)[1]
  assert.ok(!['haiku', '<model>'].includes(model), `envelope model ${model}`)
})
