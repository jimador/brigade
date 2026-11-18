// Tests for the `text` map in `brigade-config prompts --json`. The workflows read that map
// to append operator prompt overrides, so it has to hold the same fragments `prompt <name>`
// applies. One test per guarantee:
//   E1  text[name] is the ordered list of fragments `prompt <name>` prints
//   E2  text has a key for every key of overrides, and no other
//   I1  overrides entries still carry layer, file and lines; text mode is unchanged
// Plus an adversarial case: override text that looks like JSON comes through as a plain string.
// Each test builds a throwaway repo under the system temp folder and runs the real script.
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

const GLOBAL_COOK = 'Global cook rule.\nSecond line.'
const TEAM_COOK = '{"cook": 1}'
const INSPECTOR_APPEND = 'Inspector inline rule.'

// A repo with a global override for cook, a team override for cook, and an inline
// `prompts.inspector.append` in the team JSON layer.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-config-prompts-'))
  const files = {
    'home/overrides/prompts/cook.md': `${GLOBAL_COOK}\n`,
    '.brigade-overrides/prompts/cook.md': `${TEAM_COOK}\n`,
    'brigade.config.json': JSON.stringify({ prompts: { inspector: { append: [INSPECTOR_APPEND] } } }),
  }
  fs.mkdirSync(path.join(dir, '.brigade'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

function run(dir, ...args) {
  const result = spawnSync(CONFIG, args, {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, BRIGADE_HOME: path.join(dir, 'home') },
  })
  assert.equal(result.status, 0, `brigade-config ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

// Split `prompt <name>` output back into its fragments: each one follows a
// `<!-- brigade override: ... -->` marker and ends with a blank line.
function promptFragments(out) {
  return out
    .split(/^<!-- brigade override: .* -->\n/m)
    .slice(1)
    .map((chunk) => chunk.replace(/\n\n$/, ''))
}

test('E1: text[name] is the ordered fragments that prompt <name> applies', (t) => {
  const dir = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = JSON.parse(run(dir, 'prompts', '--json'))
  assert.deepEqual(out.text.cook, promptFragments(run(dir, 'prompt', 'cook')))
  assert.deepEqual(out.text.cook, [GLOBAL_COOK, TEAM_COOK])
  assert.deepEqual(out.text.inspector, promptFragments(run(dir, 'prompt', 'inspector')))
  assert.deepEqual(out.text.inspector, [INSPECTOR_APPEND])
})

test('E2: text has exactly the keys of overrides', (t) => {
  const dir = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = JSON.parse(run(dir, 'prompts', '--json'))
  assert.deepEqual(Object.keys(out.text).sort(), Object.keys(out.overrides).sort())
  assert.deepEqual(Object.keys(out.text).sort(), ['cook', 'inspector'])
})

test('I1: overrides entries keep layer, file and lines, and text mode is unchanged', (t) => {
  const dir = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = JSON.parse(run(dir, 'prompts', '--json'))
  assert.deepEqual(Object.keys(out).sort(), ['overrides', 'text'])
  assert.deepEqual(out.overrides.cook, [
    { layer: 'global', file: path.join(dir, 'home', 'overrides', 'prompts', 'cook.md'), lines: 2 },
    { layer: 'team', file: path.join(dir, '.brigade-overrides', 'prompts', 'cook.md'), lines: 1 },
  ])
  assert.deepEqual(out.overrides.inspector, [{ layer: 'config', file: null, lines: 1 }])
  const plain = run(dir, 'prompts')
  assert.match(plain, /^## prompt overrides \(applied in this order/)
  assert.ok(!plain.includes(GLOBAL_COOK), 'text mode must not print override text')
})

test('adversarial: override text that looks like JSON stays a literal string', (t) => {
  const dir = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = JSON.parse(run(dir, 'prompts', '--json'))
  assert.equal(typeof out.text.cook[1], 'string')
  assert.equal(out.text.cook[1], '{"cook": 1}')
})
