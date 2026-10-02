import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, putText, putSprite, toRuns, safeText, cellWidth, clip } from '../../hooks/board/lib/canvas.mjs'

const BG = '#000000'

function rowText(canvas, y) {
  return toRuns(canvas)[y].map((r) => r.text).join('')
}

function charCount(s) {
  return Array.from(s).length
}

test('a fresh 5x2 canvas gives two rows of one blank run each', () => {
  const c = createCanvas(5, 2, BG)
  const runs = toRuns(c)
  assert.equal(runs.length, 2)
  for (const row of runs) {
    assert.equal(row.length, 1)
    assert.deepEqual(row[0], { text: '     ', color: BG, backgroundColor: BG, bold: false })
  }
})

test('sizes are floored and clamped to at least 1', () => {
  const c = createCanvas(3.9, 0, BG)
  assert.equal(c.columns, 3)
  assert.equal(c.rows, 1)
  assert.equal(createCanvas(-4, -1, BG).columns, 1)
})

test('putText past the right edge keeps only what fits', () => {
  const c = createCanvas(5, 1, BG)
  putText(c, 3, 0, 'hello', { color: 'red' })
  assert.equal(rowText(c, 0), '   he')
})

test('putText at a negative x drops the characters left of the grid', () => {
  const c = createCanvas(5, 1, BG)
  putText(c, -2, 0, 'hello', { color: 'red' })
  assert.equal(rowText(c, 0), 'llo  ')
})

test('putText on a row outside the grid changes nothing', () => {
  const c = createCanvas(5, 2, BG)
  const before = JSON.stringify(toRuns(c))
  putText(c, 0, 9, 'hello', { color: 'red' })
  putText(c, 0, -1, 'hello', { color: 'red' })
  assert.equal(JSON.stringify(toRuns(c)), before)
})

test('putText keeps the cell background when the style has none', () => {
  const c = createCanvas(3, 1, BG)
  putText(c, 0, 0, 'a', { color: 'red', bold: true })
  putText(c, 1, 0, 'b', { color: 'red', backgroundColor: 'blue' })
  assert.deepEqual(c.cells[0][0], { ch: 'a', color: 'red', backgroundColor: BG, bold: true })
  assert.deepEqual(c.cells[0][1], { ch: 'b', color: 'red', backgroundColor: 'blue', bold: false })
})

test('putSprite packs two pixel rows into one cell row', () => {
  const c = createCanvas(4, 2, BG)
  putSprite(c, 0, 0, ['#.', '##'], 'green')
  assert.equal(c.cells[0][0].ch, '█')
  assert.equal(c.cells[0][1].ch, '▄')
  assert.equal(c.cells[0][0].color, 'green')
  assert.equal(c.cells[0][0].backgroundColor, BG)
  assert.equal(c.cells[0][2].ch, ' ')
  assert.equal(c.cells[1][0].ch, ' ')
})

test('an odd last pixel row draws as the upper half', () => {
  const c = createCanvas(2, 1, BG)
  putSprite(c, 0, 0, ['#'], 'green')
  assert.equal(c.cells[0][0].ch, '▀')
})

test('unlit sprite cells are left untouched', () => {
  const c = createCanvas(2, 1, BG)
  putText(c, 0, 0, 'xy', { color: 'red', backgroundColor: 'blue' })
  putSprite(c, 0, 0, ['.#', '..'], 'green')
  assert.deepEqual(c.cells[0][0], { ch: 'x', color: 'red', backgroundColor: 'blue', bold: false })
  assert.equal(c.cells[0][1].ch, '▀')
  assert.equal(c.cells[0][1].backgroundColor, 'blue')
})

test('a sprite at the last column is clipped without throwing', () => {
  const c = createCanvas(4, 2, BG)
  assert.doesNotThrow(() => putSprite(c, c.columns - 1, 0, ['###', '###', '###', '###', '#'], 'green'))
  assert.equal(c.cells[0][3].ch, '█')
  assert.equal(c.cells[1][3].ch, '█')
  assert.doesNotThrow(() => putSprite(c, -1, -1, ['##', '##', '##'], 'green'))
  // Pixel rows 0-1 sit above the grid; row 2 lands on cell row 0 as an upper half.
  assert.equal(c.cells[0][0].ch, '▀')
})

test('every row of toRuns joins to exactly columns characters after mixed writes', () => {
  const c = createCanvas(7, 3, BG)
  putText(c, -3, 0, 'abcdefghijk', { color: 'red' })
  putText(c, 2, 1, 'hi', { color: 'blue', backgroundColor: 'white', bold: true })
  putSprite(c, 5, 1, ['###', '#.#', '.##'], 'green')
  putText(c, 6, 2, 'zz', { color: 'red' })
  putSprite(c, -2, 2, ['####', '####'], 'yellow')
  for (const row of toRuns(c)) {
    assert.equal(charCount(row.map((r) => r.text).join('')), c.columns)
  }
})

test('adjacent cells merge only when their colours match', () => {
  const same = createCanvas(2, 1, BG)
  putText(same, 0, 0, 'ab', { color: 'red' })
  assert.equal(toRuns(same)[0].length, 1)
  assert.equal(toRuns(same)[0][0].text, 'ab')

  const diff = createCanvas(2, 1, BG)
  putText(diff, 0, 0, 'a', { color: 'red' })
  putText(diff, 1, 0, 'b', { color: 'blue' })
  const runs = toRuns(diff)[0]
  assert.equal(runs.length, 2)
  assert.deepEqual(runs.map((r) => r.text), ['a', 'b'])
})

// Any C0 or C1 control character; a frame must never carry one to the terminal.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

test('safeText turns control characters into spaces', () => {
  const out = safeText('a\nb\u001b[31m')
  assert.ok(!CONTROL.test(out), JSON.stringify(out))
  assert.equal(out, 'a b [31m')
})

test('safeText drops zero-width and combining marks', () => {
  assert.equal(safeText('e\u0301'), 'e')
  assert.equal(safeText('a\u200bb\ufeffc\u2060d\ufe0f'), 'abcd')
})

test('safeText drops line separators and the marks that reorder text', () => {
  assert.equal(safeText('a\u202eb\u2028c\u2066d'), 'abcd')
  const all = '\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'
  assert.equal(safeText(`x${all}y`), 'xy')
  assert.equal(cellWidth(`ab\u202e`), 2)
})

test('cellWidth counts wide characters as two cells', () => {
  assert.equal(cellWidth('日本'), 4)
  assert.equal(cellWidth('e\u0301'), 1)
  assert.equal(cellWidth('ab'), 2)
  assert.equal(cellWidth('한'), 2)
  assert.equal(cellWidth('\u{1F600}'), 2)
  assert.equal(cellWidth(''), 0)
})

test('clip keeps the longest prefix that fits', () => {
  assert.equal(clip('日本語', 5), '日本')
  assert.equal(clip('日本語', 6), '日本語')
  assert.equal(clip('abc', 2), 'ab')
  assert.equal(clip('a\nb', 3), 'a b')
  assert.equal(clip('abc', 0), '')
})

test('a wide character that would straddle the right edge is not drawn', () => {
  const c = createCanvas(10, 1, BG)
  putText(c, 7, 0, '日本語')
  const row = toRuns(c)[0].map((r) => r.text).join('')
  assert.equal(cellWidth(row), 10)
  assert.equal(row, '       日 ')
})

test('control characters never reach a run', () => {
  const c = createCanvas(12, 1, BG)
  putText(c, 0, 0, 'x\u001b[2J\r\n\u0085y')
  const row = toRuns(c)[0].map((r) => r.text).join('')
  assert.ok(!CONTROL.test(row), JSON.stringify(row))
  assert.equal(cellWidth(row), 12)
})

test('writing over half of a wide character blanks the other half', () => {
  const c = createCanvas(6, 1, BG)
  putText(c, 0, 0, '日本語')
  putText(c, 1, 0, 'a')
  putText(c, 4, 0, 'b')
  const row = toRuns(c)[0].map((r) => r.text).join('')
  assert.equal(row, ' a本b ')
  assert.equal(cellWidth(row), 6)
  putSprite(c, 3, 0, ['#'], 'green')
  const after = toRuns(c)[0].map((r) => r.text).join('')
  assert.equal(cellWidth(after), 6)
})
