// Tests for resolvePromptExtras in workflows/config.js: the workflows take prompt overrides
// either as a plain `{ <role>: [text…] }` map or as the whole `brigade-config prompts --json`
// output, and warn when a value was passed but no role got any text. One test per guarantee:
//   E1  a value with a `text` object gives extras = raw.text
//   E2  a plain role map of strings or string lists comes back as is
//   E3  `overrides` with no `text` (an older brigade-config) gives {} and dropped
//   E4  any other non-empty value with no text is dropped; undefined, null and {} are not
//   I1  withPromptOverrides behaves exactly as before
// Plus an end-to-end case through the real `brigade-config prompts --json`, and a check that
// each workflow reads its overrides through resolvePromptExtras and nothing else.
// config.js has no exports, so it is loaded the way test/regression.sh loads it.
// Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = path.join(ROOT, 'scripts', 'brigade-config')
const SRC = fs.readFileSync(path.join(ROOT, 'workflows', 'config.js'), 'utf8')
const { resolvePromptExtras, withPromptOverrides } = new Function(
  `${SRC}; return { resolvePromptExtras, withPromptOverrides }`,
)()

test('E1: the prompts --json shape gives extras = raw.text', () => {
  const raw = {
    overrides: { cook: [{ layer: 'team', file: '/path/to/repo/.brigade-overrides/prompts/cook.md', lines: 1 }] },
    text: { cook: ['Cook rule.'] },
  }
  const out = resolvePromptExtras(raw)
  assert.equal(out.extras, raw.text)
  assert.equal(out.dropped, false)
  // A repo with no overrides at all is not worth a warning.
  assert.deepEqual(resolvePromptExtras({ overrides: {}, text: {} }), { extras: {}, dropped: false })
  // Override entries whose text is all blank are.
  assert.equal(resolvePromptExtras({ overrides: { cook: [{}] }, text: { cook: ['  '] } }).dropped, true)
})

test('E2: a plain role map of strings or string lists comes back as is', () => {
  const raw = { cook: ['Cook rule.', 'Second.'], inspector: 'Inspector rule.' }
  const out = resolvePromptExtras(raw)
  assert.equal(out.extras, raw)
  assert.equal(out.dropped, false)
})

test('E3: overrides with no text gives empty extras and dropped', () => {
  const raw = { overrides: { cook: [{ layer: 'team', file: '/path/to/repo/x.md', lines: 1 }] } }
  assert.deepEqual(resolvePromptExtras(raw), { extras: {}, dropped: true })
})

test('E4: other non-empty values with no text are dropped; empty ones are not', () => {
  for (const raw of [{ cook: 42 }, { cook: [1, 2] }, { cook: [''] }, 'cook rule', ['cook rule'], 7, true]) {
    assert.deepEqual(resolvePromptExtras(raw), { extras: {}, dropped: true }, JSON.stringify(raw))
  }
  for (const raw of [undefined, null, {}]) {
    assert.deepEqual(resolvePromptExtras(raw), { extras: {}, dropped: false }, String(raw))
  }
})

test('I1: withPromptOverrides is unchanged', () => {
  const header = "ADDITIONAL INSTRUCTIONS (from this operator's brigade configuration — they add to, never remove, the rules above):"
  assert.equal(withPromptOverrides('BASE', ['a', 'b']), `BASE\n\n${header}\n\na\n\nb\n`)
  assert.equal(withPromptOverrides('BASE', 'a'), `BASE\n\n${header}\n\na\n`)
  assert.equal(withPromptOverrides('BASE', ['a', '  ', 3, null]), `BASE\n\n${header}\n\na\n`)
  for (const fragments of [undefined, null, [], [''], {}, 5]) {
    assert.equal(withPromptOverrides('BASE', fragments), 'BASE')
  }
})

test('end to end: real prompts --json output reaches the cook prompt', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-prompt-extras-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, '.brigade'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.brigade-overrides', 'prompts'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.brigade-overrides', 'prompts', 'cook.md'), 'Always run the linter first.\n')
  const result = spawnSync(CONFIG, ['prompts', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, BRIGADE_HOME: path.join(dir, 'home') },
  })
  assert.equal(result.status, 0, `brigade-config prompts --json failed: ${result.stderr}`)
  const { extras, dropped } = resolvePromptExtras(JSON.parse(result.stdout))
  assert.equal(dropped, false)
  const prompt = withPromptOverrides('BASE', extras.cook)
  assert.ok(prompt.startsWith('BASE\n'))
  assert.ok(prompt.includes('Always run the linter first.'), prompt)
})

test('each workflow reads its overrides only through resolvePromptExtras, and warns once', () => {
  for (const name of ['brigade-execute', 'brigade-review', 'brigade-research']) {
    const text = fs.readFileSync(path.join(ROOT, 'workflows', 'src', `${name}.js`), 'utf8')
    assert.equal(text.match(/A\.promptOverrides/g).length, 1, name)
    assert.equal(text.match(/resolvePromptExtras\(A\.promptOverrides\)/g).length, 1, name)
    assert.equal(text.match(/prompt overrides were passed but carried no text/g).length, 1, name)
  }
})
