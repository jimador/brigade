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

// Writes text one character per cell, starting at (x, y). Anything that lands off the grid is
// simply dropped, and nothing wraps onto the next row.
export function putText(canvas, x, y, text, style = {}) {
  const cx = coord(x)
  const cy = coord(y)
  if (cx === null || cy === null || cy < 0 || cy >= canvas.rows) return
  const row = canvas.cells[cy]
  const chars = Array.from(String(text ?? ''))
  const s = style || {}
  for (let i = 0; i < chars.length; i++) {
    const col = cx + i
    if (col < 0) continue
    if (col >= canvas.columns) break
    const cell = row[col]
    cell.ch = chars[i]
    cell.color = s.color
    if (s.backgroundColor !== undefined) cell.backgroundColor = s.backgroundColor
    cell.bold = Boolean(s.bold)
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
      const cell = canvas.cells[row][col]
      cell.ch = top && bottom ? '█' : top ? '▀' : '▄'
      cell.color = color
      cell.bold = false
    }
  }
}

// Reads the grid back row by row, merging neighbouring cells that look the same into one run.
// Every row's run texts add up to exactly `columns` characters.
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
