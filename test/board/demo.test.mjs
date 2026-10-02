import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'board-demo')
const SVG = path.join(ROOT, 'docs', 'assets', 'svg', 'board-demo.svg')

// Read lazily so a missing file fails each test on its own instead of the whole file.
function svg() {
  return fs.readFileSync(SVG, 'utf8')
}

test('the committed demo is exactly what the script draws', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, `--check failed: ${run.stdout}${run.stderr}`)
})

test('the demo stays small enough for a README', () => {
  assert.ok(fs.statSync(SVG).size <= 350 * 1024, `${fs.statSync(SVG).size} bytes`)
})

test('it animates with CSS, honours reduced motion, and says what it is', () => {
  const text = svg()
  assert.match(text, /@keyframes/)
  assert.match(text, /prefers-reduced-motion/)
  assert.match(text, /<title[^>]*>[^<]+<\/title>/)
})

test('nothing in it runs code or loads from elsewhere', () => {
  const text = svg()
  for (const banned of ['<script', 'foreignObject', '<image', 'href="http']) {
    assert.ok(!text.includes(banned), `found ${banned}`)
  }
})

test('the only control character is the newline', () => {
  assert.doesNotMatch(svg(), /[\u0000-\u0009\u000b-\u001f\u007f]/)
})

test('every <use> points at something defined in the file', () => {
  const text = svg()
  const ids = new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  const refs = [...text.matchAll(/<use[^>]*\shref="#([^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length > 0, 'no <use> at all')
  for (const ref of refs) assert.ok(ids.has(ref), `missing #${ref}`)
})

test('it has between 30 and 110 frames', () => {
  const frames = (svg().match(/<g class="f"/g) ?? []).length
  assert.ok(frames >= 30 && frames <= 110, `${frames} frames`)
})

test('the cast and every weather word show up', () => {
  const text = svg()
  for (const word of ['Basil', 'Sage', 'Miso', 'Nori', 'Clove', 'CLEAR', 'CLOUDY', 'SHOWERS', 'STORM']) {
    assert.ok(text.includes(word), `missing ${word}`)
  }
})

test('block characters are drawn as shapes, never as text', () => {
  const text = svg()
  for (const ch of '█▀▄▌▐▰▱') assert.ok(!text.includes(ch), `found ${ch} as text`)
})
