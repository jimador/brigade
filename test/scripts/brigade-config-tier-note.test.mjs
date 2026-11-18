// Tests for the three-star note in `brigade-config doctor`. Field data showed three-star buys
// no first-attempt quality over two-star, so doctor says so when a repo's resolved tier is
// three-star. It is advice: the exit code never changes because of it.
//   N1  three-star from the team JSON layer prints the note, naming that layer, and exits 0
//   N2  two-star (the default) prints no note
//   N3  `--json` carries a `notes` array: the note for three-star, empty for two-star
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

const NOTE =
  'note: tier is three-star (set by team); three-star showed no first-attempt quality gain over two-star in field data — prefer it per dish (TIERS.md)'

// A fresh repo folder with an empty personal home, plus whatever files the test asks for.
function fixture(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-config-tier-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.brigade'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

function doctor(dir, ...args) {
  return spawnSync(CONFIG, ['doctor', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, BRIGADE_HOME: path.join(dir, 'home') },
  })
}

const threeStarTeam = { 'brigade.config.json': JSON.stringify({ tier: 'three-star' }) }

test('N1: three-star from the team layer prints the note and still exits 0', (t) => {
  const dir = fixture(t, threeStarTeam)
  const result = doctor(dir)
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split('\n')
  assert.ok(lines.includes('brigade-config: all layers valid'), result.stdout)
  assert.ok(lines.includes(NOTE), result.stdout)
})

test('N2: two-star prints no note', (t) => {
  const dir = fixture(t)
  const result = doctor(dir)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'brigade-config: all layers valid')
  assert.doesNotMatch(result.stdout + result.stderr, /note:/)
})

test('N3: --json carries a notes array', (t) => {
  const three = fixture(t, threeStarTeam)
  const threeResult = doctor(three, '--json')
  assert.equal(threeResult.status, 0, threeResult.stderr)
  const threeOut = JSON.parse(threeResult.stdout)
  assert.equal(threeOut.ok, true)
  assert.deepEqual(threeOut.notes, [NOTE.slice('note: '.length)])

  const two = fixture(t)
  const twoResult = doctor(two, '--json')
  assert.equal(twoResult.status, 0, twoResult.stderr)
  assert.deepEqual(JSON.parse(twoResult.stdout).notes, [])
})
