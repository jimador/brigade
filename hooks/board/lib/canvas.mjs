// A grid of character cells the board draws into. Text and pixel sprites go in cell by cell,
// and toRuns reads the grid back as coloured stretches of text, one list per row.
// No imports on purpose: this has to load anywhere the board does.

// Turns a size into a whole number of at least 1, so a bad size still gives a usable grid.
function size(n) {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v >= 1 ? v : 1
}

// Turns a coordinate into a whole number, or null when it is not a number at all.
function coord(n) {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) ? v : null
}

// Control characters would move the cursor or recolour the terminal, so they become a space.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// Zero-width characters and combining marks take no cell of their own, so they are dropped.
const INVISIBLE = /[\u0300-\u036f\u200b-\u200f\u2060\ufe00-\ufe0f\ufeff]/g

// Code point ranges a terminal draws two cells wide: CJK, Hangul, fullwidth forms and emoji.
const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

function isWide(ch) {
  const cp = ch.codePointAt(0)
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi)
}

// How many cells one character of safe text takes.
function cellsOf(ch) {
  return isWide(ch) ? 2 : 1
}

// Text made safe to draw: control characters become a space and invisible marks are dropped,
// so every character left takes one or two whole cells.
export function safeText(text) {
  return String(text ?? '').replace(INVISIBLE, '').replace(CONTROL, ' ')
}

// How many cells the safe form of `text` takes on screen.
export function cellWidth(text) {
  let n = 0
  for (const ch of safeText(text)) n += cellsOf(ch)
  return n
}

// The longest start of the safe form of `text` that fits in `cells` cells.
export function clip(text, cells) {
  let out = ''
  let used = 0
  for (const ch of safeText(text)) {
    const w = cellsOf(ch)
    if (used + w > cells) break
    out += ch
    used += w
  }
  return out
}

function blank(bg) {
  return { ch: ' ', color: bg, backgroundColor: bg, bold: false }
}

// Makes a fresh grid where every cell is a space painted in the background colour.
export function createCanvas(columns, rows, bg) {
  const w = size(columns)
  const h = size(rows)
  const cells = []
  for (let y = 0; y < h; y++) {
    const row = []
    for (let x = 0; x < w; x++) row.push(blank(bg))
    cells.push(row)
  }
  return { columns: w, rows: h, bg, cells }
}

// A wide character fills its own cell and leaves the next one holding '' so the row's text still
// adds up to the right number of cells. Before a cell is overwritten, any wide character it is
// half of gets its other half blanked, so no orphan half is left behind.
function claim(row, col) {
  const cell = row[col]
  if (cell.ch === '' && col > 0) row[col - 1].ch = ' '
  if (cell.ch !== '' && isWide(cell.ch) && col + 1 < row.length && row[col + 1].ch === '') row[col + 1].ch = ' '
}

function paintCell(cell, ch, s) {
  cell.ch = ch
  cell.color = s.color
  if (s.backgroundColor !== undefined) cell.backgroundColor = s.backgroundColor
  cell.bold = Boolean(s.bold)
}

// Writes the safe form of the text starting at (x, y), one or two cells per character. Anything
// that lands off the grid is dropped, a wide character that would hang over either edge is not
// drawn, and nothing wraps onto the next row.
export function putText(canvas, x, y, text, style = {}) {
  const cx = coord(x)
  const cy = coord(y)
  if (cx === null || cy === null || cy < 0 || cy >= canvas.rows) return
  const row = canvas.cells[cy]
  const s = style || {}
  let col = cx
  for (const ch of safeText(text)) {
    const w = cellsOf(ch)
    if (col + w > canvas.columns) break
    if (col >= 0) {
      claim(row, col)
      if (w === 2) claim(row, col + 1)
      paintCell(row[col], ch, s)
      if (w === 2) paintCell(row[col + 1], '', s)
    }
    col += w
  }
}

// Draws a little bitmap where '#' is a lit pixel. Each cell holds two pixels stacked on top of
// each other, using half-block characters, so a bitmap N pixels tall takes ceil(N / 2) rows.
// Cells with no lit pixel are left exactly as they were.
export function putSprite(canvas, x, y, bitmap, color) {
  const cx = coord(x)
  const cy = coord(y)
  if (cx === null || cy === null || !Array.isArray(bitmap)) return
  const lines = bitmap.map((line) => Array.from(String(line ?? '')))
  for (let p = 0; p < lines.length; p += 2) {
    const row = cy + p / 2
    if (row < 0 || row >= canvas.rows) continue
    const upper = lines[p]
    const lower = p + 1 < lines.length ? lines[p + 1] : []
    const width = Math.max(upper.length, lower.length)
    for (let i = 0; i < width; i++) {
      const col = cx + i
      if (col < 0 || col >= canvas.columns) continue
      const top = upper[i] === '#'
      const bottom = lower[i] === '#'
      if (!top && !bottom) continue
      claim(canvas.cells[row], col)
      const cell = canvas.cells[row][col]
      cell.ch = top && bottom ? '█' : top ? '▀' : '▄'
      cell.color = color
      cell.bold = false
    }
  }
}

// Reads the grid back row by row, merging neighbouring cells that look the same into one run.
// Every row's run texts take exactly `columns` cells: a wide character counts two, and the cell
// it spills into adds no text.
export function toRuns(canvas) {
  return canvas.cells.map((row) => {
    const runs = []
    let run = null
    for (const cell of row) {
      if (
        run &&
        run.color === cell.color &&
        run.backgroundColor === cell.backgroundColor &&
        run.bold === cell.bold
      ) {
        run.text += cell.ch
      } else {
        run = {
          text: cell.ch,
          color: cell.color,
          backgroundColor: cell.backgroundColor,
          bold: cell.bold,
        }
        runs.push(run)
      }
    }
    return runs
  })
}
