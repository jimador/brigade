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

// The text a frame shows: its own text plus the text of everything it points at, followed down
// through every <use>.
function frameText(text, frameId) {
  const group = text.match(new RegExp(`<g class="f" id="${frameId}">(.*?)</g>`))
  assert.ok(group, `no frame ${frameId}`)
  const defs = new Map([...text.matchAll(/<g id="([^"]+)">(.*?)<\/g>/g)].map((m) => [m[1], m[2]]))
  const textOf = (body) => [
    ...[...body.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]),
    ...[...body.matchAll(/<use href="#([^"]+)"/g)].map((m) => {
      assert.ok(defs.has(m[1]), `missing #${m[1]}`)
      return textOf(defs.get(m[1]))
    }),
  ].join('\n')
  return textOf(group[1])
}

test('the committed demo is exactly what the script draws', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, `--check failed: ${run.stdout}${run.stderr}`)
})

test('the demo stays small enough for a README', () => {
  assert.ok(fs.statSync(SVG).size <= 600 * 1024, `${fs.statSync(SVG).size} bytes`)
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

test('it has at most 180 frames and loops in 30 seconds or less', () => {
  const text = svg()
  const frames = (text.match(/<g class="f"/g) ?? []).length
  assert.ok(frames >= 20 && frames <= 180, `${frames} frames`)
  const loop = text.match(/\.f\{[^}]*animation:(\d+)ms/)
  assert.ok(loop, 'no loop length')
  assert.ok(Number(loop[1]) <= 30_000, `${loop[1]} ms`)
})

test('it shows the task board: header, lanes, pills, panels, legend and the cast', () => {
  const text = svg()
  const words = [
    'Context', 'To do', 'Cooking', 'In review', 'Rework', 'Done', 'sent back · 2 findings', 'second pass',
    'Messages', 'Learnings in play', 'Color:', 'Basil', 'Sage', 'Miso', 'Nori', 'Clove',
  ]
  for (const word of words) assert.ok(text.includes(word), `missing ${word}`)
})

test('the old board is gone: no weather words and no bench', () => {
  const text = svg()
  for (const word of ['CLEAR', 'CLOUDY', 'SHOWERS', 'STORM', 'BENCH']) {
    assert.ok(!text.includes(word), `found ${word}`)
  }
})

test('under reduced motion the one frame left standing is the hover card on Miso', () => {
  const text = svg()
  const still = text.match(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}#(f\d+)\{visibility:visible\}\}/)
  assert.ok(still, 'no reduced-motion frame')
  const shown = frameText(text, still[1])
  assert.match(shown, /Miso · cook/)
  assert.match(shown, /item token-bucket/)
})

test('block characters are drawn as shapes, never as text', () => {
  const text = svg()
  for (const ch of '█▀▄▌▐▰▱') assert.ok(!text.includes(ch), `found ${ch} as text`)
})
