// Tests for the `.brigade/config.md` layer in brigade-config. That layer sits just above the
// built-in defaults and below every JSON layer, and reads only `tier` and `verification_gate`.
// One test per guarantee:
//   R1  only the `## Repo` section is read, up to the next `## ` heading
//   E1  `- tier: <value>` sets tier, trailing ` # comment` dropped, an empty value sets nothing
//   E2  `- verification_gate:` plus indented `- <command>` lines set gate in order, `#` kept,
//       `<placeholder>` commands skipped
//   E3  provenance says `config.md` for what it set; a JSON layer setting the same key wins
//   E4  `layers` lists config.md between defaults and global, present when the file exists
//   I1  with no config.md, resolve gives what it always did
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

// A fresh repo folder with an empty personal home, plus whatever files the test asks for.
function fixture(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-config-md-'))
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true })
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

const resolve = (dir) => JSON.parse(run(dir, 'resolve', '--json'))

const configMd = (repoLines, before = '') =>
  `# Brigade config\n\n${before}## Repo\n\n${repoLines.join('\n')}\n\n## Local conventions\n\n- tier: one-star\n`

test('E1: a tier bullet sets tier with its trailing comment removed', (t) => {
  const dir = fixture({ '.brigade/config.md': configMd(['- main_branch: main', '- tier: three-star           # comment']) })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = resolve(dir)
  assert.equal(out.config.tier, 'three-star')
  assert.equal(out.provenance.tier, 'config.md')

  const empty = fixture({ '.brigade/config.md': configMd(['- tier:           # three-star | two-star']) })
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }))
  const fallback = resolve(empty)
  assert.equal(fallback.config.tier, 'two-star')
  assert.equal(fallback.provenance.tier, 'defaults')
})

test('E2: gate commands keep their order and any #, and placeholders are skipped', (t) => {
  const dir = fixture({
    '.brigade/config.md': configMd([
      '- verification_gate:        # exact commands a Cook must run',
      '  - <e.g. bun run types>',
      '  - npm test',
      '  - echo "# not a comment"',
      '- test_convention: one line',
      '  - after the list ended',
    ]),
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = resolve(dir)
  assert.deepEqual(out.config.gate, ['npm test', 'echo "# not a comment"'])
  assert.equal(out.provenance.gate, 'config.md')

  const onlyPlaceholders = fixture({
    '.brigade/config.md': configMd(['- verification_gate:', '  - <e.g. bun run types>', '  - <e.g. bun run test>']),
  })
  t.after(() => fs.rmSync(onlyPlaceholders, { recursive: true, force: true }))
  const fallback = resolve(onlyPlaceholders)
  assert.deepEqual(fallback.config.gate, [])
  assert.equal(fallback.provenance.gate, 'defaults')
})

test('E3: a JSON layer setting the same key wins, the other key stays from config.md', (t) => {
  const dir = fixture({
    '.brigade/config.md': configMd(['- tier: three-star', '- verification_gate:', '  - npm test']),
    'brigade.config.json': JSON.stringify({ tier: 'one-star' }),
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = resolve(dir)
  assert.equal(out.config.tier, 'one-star')
  assert.equal(out.provenance.tier, 'team')
  assert.deepEqual(out.config.gate, ['npm test'])
  assert.equal(out.provenance.gate, 'config.md')
})

test('E4: layers lists config.md between defaults and global', (t) => {
  const dir = fixture({ '.brigade/config.md': configMd(['- tier: three-star']) })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { layers } = JSON.parse(run(dir, 'layers', '--json'))
  assert.deepEqual(layers.map((l) => l.layer), ['defaults', 'config.md', 'global', 'team', 'local'])
  const md = layers[1]
  assert.equal(md.present, true)
  assert.equal(md.file, path.join(dir, '.brigade', 'config.md'))

  const text = run(dir, 'layers').split('\n').filter((line) => /^ {2}\S/.test(line)).map((line) => line.trim().split(/\s+/)[0])
  assert.deepEqual(text, ['defaults', 'config.md', 'global', 'team', 'local'])

  const missing = fixture()
  t.after(() => fs.rmSync(missing, { recursive: true, force: true }))
  const absent = JSON.parse(run(missing, 'layers', '--json')).layers
  assert.equal(absent[1].layer, 'config.md')
  assert.equal(absent[1].present, false)
})

test('R1: a tier bullet outside the ## Repo section is ignored', (t) => {
  const dir = fixture({
    '.brigade/config.md': configMd(['- main_branch: main'], '## Source\n\n- tier: one-star\n- verification_gate:\n  - rm -rf nothing\n\n'),
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = resolve(dir)
  assert.equal(out.config.tier, 'two-star')
  assert.equal(out.provenance.tier, 'defaults')
  assert.deepEqual(out.config.gate, [])
})

test('I1: with no config.md, resolve reports the defaults and lists only the JSON layers', (t) => {
  const dir = fixture()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = resolve(dir)
  assert.equal(out.config.tier, 'two-star')
  assert.equal(out.provenance.tier, 'defaults')
  assert.deepEqual(out.config.gate, [])
  assert.deepEqual(out.layers.map((l) => l.layer), ['defaults', 'global', 'team', 'local'])
})
