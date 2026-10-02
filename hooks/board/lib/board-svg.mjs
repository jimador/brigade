// Turns one drawn board (the painter's rows of coloured text runs) into an SVG picture. The
// desktop app can't load the board's drawing region and prints plain text in a proportional font,
// so a picture is how the board shows there. Every character is pinned to its own cell, so the
// grid lines up whatever font the reader has.
//
// Card titles, agent names and messages come from files and tool calls, and the picture ends up
// in a browser frame, so every piece of text is escaped, characters XML refuses are dropped, and
// colours are only used when they are plain hex. The markup uses only svg, style, rect, g, text,
// title and animate; nothing here ever writes a script, an event handler, a link or a url().

import { PALETTE } from './sprites.mjs'
import { cellWidth } from './canvas.mjs'

export const CELL_W = 9
export const CELL_H = 18
// The app refuses a picture whose source is longer than this.
export const SVG_MAX = 131072

const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
// Where the text baseline sits inside a cell, from the cell's top.
const BASELINE = 13
const TOO_LARGE = 'Board too large to draw'

// Block characters as rectangles inside a cell: [x, y, w, h] in pixels.
const BLOCKS = {
  '█': [0, 0, CELL_W, CELL_H],
  '▀': [0, 0, CELL_W, CELL_H / 2],
  '▄': [0, CELL_H / 2, CELL_W, CELL_H / 2],
  '▌': [0, 0, CELL_W / 2, CELL_H],
  '▐': [CELL_W / 2, 0, CELL_W / 2, CELL_H],
}
const GAUGE = new Set(['▰', '▱'])

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// Characters XML 1.0 refuses outright: most C0 controls, U+FFFE, U+FFFF, and half of a surrogate
// pair with no other half. Without the u flag this works on UTF-16 units, which is what finds a
// lone surrogate.
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
// A character that takes a cell but must not be drawn as text: every control character (as the
// canvas treats them) plus everything XML refuses.
const BLANK = /^(?:[\u0000-\u001f\u007f-\u009f￾￿]|[\ud800-\udfff])$/

// Numbers print as whole numbers or with one decimal, so output never depends on float noise.
function num(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function colorOr(value, fallback) {
  return typeof value === 'string' && COLOR.test(value) ? value : fallback
}

// Text made safe to put inside an element or an attribute. The four markup characters become
// entities. On top of that, the few spots where plain text could look like a script hook to a
// filter that scans the raw source (an `on...=` pair, the word href, a `url(`) get one character
// written as a character reference. A reader of the picture sees exactly the same text.
function esc(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/(on[a-z0-9_-]*\s*)=/gi, '$1&#61;')
    .replace(/h(ref)/gi, (all, rest) => `&#${all.charCodeAt(0)};${rest}`)
    .replace(/(url\s*)\(/gi, '$1&#40;')
}

// A whole number of cells, or 0 when the value is not a number at all.
function count(n) {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? v : 0
}

// Spreads a row of runs out into one entry per cell, cut at `columns`. A wide character takes its
// cell and leaves '' in the next, the same as the canvas does; one that would hang over the right
// edge ends the row. A control character or one XML refuses keeps its cell as a blank, so
// everything after it stays where the canvas put it.
function cellsOf(runs, columns) {
  const cells = []
  if (!Array.isArray(runs)) return cells
  for (const run of runs) {
    if (run === null || typeof run !== 'object') continue
    const text = typeof run.text === 'string' ? run.text : String(run.text ?? '')
    const color = colorOr(run.color, PALETTE.ink)
    const bg = colorOr(run.backgroundColor, PALETTE.field)
    const bold = run.bold === true
    for (const raw of text) {
      const ch = BLANK.test(raw) ? ' ' : raw
      const w = cellWidth(ch)
      // Zero-width marks take no cell on the canvas, so they take none here.
      if (w === 0) continue
      if (cells.length + w > columns) return cells
      cells.push({ ch, color, bg, bold })
      for (let k = 1; k < w; k++) cells.push({ ch: '', color, bg, bold })
    }
  }
  return cells
}

function isText(ch) {
  return ch !== '' && ch !== ' ' && !Object.hasOwn(BLOCKS, ch) && !GAUGE.has(ch)
}

function rect(x, y, w, h, fill) {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${fill}"/>`
}

// One row of cells as SVG, its top at pixel `top`. Backgrounds go first, then blocks, then text.
// The field colour is left to the picture's own background. Each pass walks the row once.
function rowSvg(cells, top) {
  const out = []

  // Backgrounds, merged across neighbouring cells of the same colour.
  for (let x = 0; x < cells.length; x++) {
    const c = cells[x]
    if (c.bg === PALETTE.field) continue
    let end = x
    while (end + 1 < cells.length && cells[end + 1].bg === c.bg) end++
    out.push(rect(x * CELL_W, top, (end - x + 1) * CELL_W, CELL_H, c.bg))
    x = end
  }

  // Blocks, with a rectangle that touches the last one of the same colour and shape merged in.
  // `last` remembers the newest rectangle for each colour and shape, so the lookup stays constant.
  const blocks = []
  const last = new Map()
  cells.forEach((c, x) => {
    const shape = Object.hasOwn(BLOCKS, c.ch) ? BLOCKS[c.ch] : null
    if (shape) {
      const [dx, dy, w, h] = shape
      const left = x * CELL_W + dx
      const key = `${c.color} ${dy} ${h}`
      const prev = last.get(key)
      if (prev && prev.x + prev.w === left) {
        prev.w += w
      } else {
        const b = { x: left, y: dy, w, h, fill: c.color }
        blocks.push(b)
        last.set(key, b)
      }
    } else if (c.ch === '▰') {
      blocks.push({ x: x * CELL_W + 1, y: 1, w: CELL_W - 2, h: CELL_H - 2, fill: c.color })
    } else if (c.ch === '▱') {
      blocks.push({ x: x * CELL_W + 1, y: 1, w: CELL_W - 2, h: CELL_H - 2, stroke: c.color })
    }
  })
  for (const b of blocks) {
    if (b.stroke) {
      // An outline stays inside its box: the stroke is centred on the edge, so pull in by half.
      out.push(`<rect x="${num(b.x + 0.5)}" y="${num(top + b.y + 0.5)}" width="${num(b.w - 1)}" height="${num(b.h - 1)}" fill="none" stroke="${b.stroke}"/>`)
    } else {
      out.push(rect(b.x, top + b.y, b.w, b.h, b.fill))
    }
  }

  // Text: each stretch of same-style characters is one <text>, and every character gets its own
  // x so it sits in its cell whatever font the reader has. A single space between two words of
  // the same style stays inside the stretch, so a phrase like "In review" reads as one. A wider
  // gap ends it, because some renderers squeeze runs of spaces into one and would then hand the
  // x positions to the wrong characters.
  const textAt = (x) => x < cells.length && isText(cells[x].ch)
  const y = num(top + BASELINE)
  for (let x = 0; x < cells.length; x++) {
    if (!textAt(x)) continue
    const c = cells[x]
    const xs = []
    let text = ''
    let end = x
    while (end < cells.length) {
      const d = cells[end]
      if (d.ch === '') { end++; continue }
      if (d.ch === ' ') {
        const next = end + 1
        if (!textAt(next) || cells[next].color !== c.color || cells[next].bold !== c.bold) break
        xs.push(num(end * CELL_W))
        text += ' '
        end = next
        continue
      }
      if (!isText(d.ch) || d.color !== c.color || d.bold !== c.bold) break
      xs.push(num(end * CELL_W))
      text += d.ch
      end++
    }
    out.push(`<text x="${xs.join(' ')}" y="${y}" fill="${c.color}"${c.bold ? ' class="b"' : ''}>${esc(text)}</text>`)
    x = end - 1
  }
  return out.join('')
}

// A tooltip box: a see-through rectangle over the cells, holding the text as its title. Boxes
// are pulled inside the picture; one with no area left, or with a size that isn't a number, is
// dropped.
function titleSvg(box, columns, height) {
  if (box === null || typeof box !== 'object') return ''
  const nums = [box.x, box.y, box.w, box.h].map(Number)
  if (!nums.every(Number.isFinite)) return ''
  const [bx, by, bw, bh] = nums.map(Math.floor)
  const x = Math.min(Math.max(bx, 0), columns)
  const y = Math.min(Math.max(by, 0), height)
  const w = Math.min(bx + bw, columns) - x
  const h = Math.min(by + bh, height) - y
  if (w <= 0 || h <= 0) return ''
  const text = String(box.text ?? '').replace(FORBIDDEN, '')
  return `<rect x="${num(x * CELL_W)}" y="${num(y * CELL_H)}" width="${num(w * CELL_W)}" height="${num(h * CELL_H)}" fill="#000" fill-opacity="0"><title>${esc(text)}</title></rect>`
}

function head(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
    `<rect width="${num(width)}" height="${num(height)}" fill="${PALETTE.field}"/>` +
    `<style>text{font:14px ${FONT};white-space:pre}.b{font-weight:700}</style>`
}

// Two groups that take turns: frame 0 shows for half a second, then frame 1, forever. Frame 1
// starts hidden, so a reader with no animation still sees a whole board.
function walking(zero, one) {
  const swap = (values) => `<animate attributeName="visibility" values="${values}" dur="1s" calcMode="discrete" repeatCount="indefinite"/>`
  return `<g>${swap('visible;hidden')}${zero.join('')}</g><g visibility="hidden">${swap('hidden;visible')}${one.join('')}</g>`
}

// The stand-in when even the plain board is too long: same size, one line of text.
function tooLarge(width, height) {
  const xs = Array.from(TOO_LARGE, (_, i) => num((i + 1) * CELL_W)).join(' ')
  return `${head(width, height)}<text x="${xs}" y="${BASELINE}" fill="${PALETTE.ink}">${TOO_LARGE}</text></svg>`
}

/**
 * Draws one board frame as an SVG picture.
 * @param rows the painter's rows for walking frame 0, each a list of { text, color, backgroundColor, bold }
 * @param altRows the rows for walking frame 1, or null for a still picture
 * @param columns how many cells across
 * @param titles boxes in cells, { x, y, w, h, text }, that show `text` as a tooltip on hover
 * @return { source, width, height }: the SVG document and its size in CSS pixels. The source is
 *   never longer than SVG_MAX: the walk goes first, then the titles, then the board itself.
 */
export function pictureOf({ rows, altRows = null, columns, titles = [] } = {}) {
  const cols = count(columns)
  const list = Array.isArray(rows) ? rows : []
  const alt = Array.isArray(altRows) ? altRows : null
  const width = cols * CELL_W
  const height = list.length * CELL_H

  // Each row is drawn once per frame. A row that comes out the same in both frames is still.
  const still = []
  const zero = []
  const one = []
  const flat = []
  list.forEach((runs, y) => {
    const a = rowSvg(cellsOf(runs, cols), y * CELL_H)
    flat.push(a)
    if (alt !== null && Array.isArray(alt[y])) {
      const b = rowSvg(cellsOf(alt[y], cols), y * CELL_H)
      if (b !== a) {
        zero.push(a)
        one.push(b)
        return
      }
    }
    still.push(a)
  })
  const boxes = (Array.isArray(titles) ? titles : []).map((box) => titleSvg(box, cols, list.length)).join('')

  const build = (animate, withTitles) => {
    const body = animate && zero.length > 0 ? still.join('') + walking(zero, one) : flat.join('')
    return `${head(width, height)}${body}${withTitles ? boxes : ''}</svg>`
  }
  let source = build(true, true)
  if (source.length > SVG_MAX && zero.length > 0) source = build(false, true)
  if (source.length > SVG_MAX && boxes !== '') source = build(false, false)
  if (source.length > SVG_MAX) source = tooLarge(width, height)
  return { source, width, height }
}
