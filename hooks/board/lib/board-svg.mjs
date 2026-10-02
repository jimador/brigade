// Turns one drawn board (the painter's rows of coloured text runs) into an SVG picture. The
// desktop app can't load the board's drawing region and prints plain text in a proportional font,
// so a picture is how the board shows there. Every character is pinned to its own cell, so the
// grid lines up whatever font the reader has.
//
// Card titles, agent names and messages come from files and tool calls, and the picture ends up
// in a browser frame, so every piece of text is escaped, characters XML refuses are drawn as
// blanks, and colours are only used when they are plain hex. The markup uses only svg, rect,
// style, text and path; nothing here ever writes a script, an event handler, a link or a url().

import { PALETTE, ART } from './sprites.mjs'
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
// A character that takes a cell but must not be drawn as text: every control character (as the
// canvas treats them) plus everything XML refuses, which includes U+FFFE, U+FFFF and half of a
// surrogate pair.
const BLANK = /^(?:[\u0000-\u001f\u007f-\u009f￾￿]|[\ud800-\udfff])$/

// Numbers print as whole numbers or with one decimal, so output never depends on float noise.
function num(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// Numbers in a sprite's path, which fall on fractions of a pixel: at most two decimals, with
// trailing zeros dropped, so 4/3 prints as 1.33 and 2 prints as 2.
function fine(n) {
  return String(Math.round(n * 100) / 100)
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

const SPRITE_COLOR = /^#[0-9a-f]{6}$/i

// A sprite the caller placed, checked and pulled onto the board. Every value comes from outside,
// so each is read once and anything of the wrong type gives null: a size that isn't one of ART's
// own keys, a colour that isn't six-digit hex, a position or size that isn't a finite number (a
// numeric string included), a width or height that isn't positive. The box is floored to whole
// cells and clamped to the board; one that doesn't touch the board gives null too.
function spriteOf(sprite, columns, height) {
  if (sprite === null || typeof sprite !== 'object') return null
  const { x, y, w, h, size, color, frame } = sprite
  if (typeof size !== 'string' || !Object.hasOwn(ART, size)) return null
  if (typeof color !== 'string' || !SPRITE_COLOR.test(color)) return null
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
  const [bx, by, bw, bh] = [x, y, w, h].map(Math.floor)
  const left = Math.min(Math.max(bx, 0), columns)
  const top = Math.min(Math.max(by, 0), height)
  const right = Math.min(bx + bw, columns)
  const bottom = Math.min(by + bh, height)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, bitmap: ART[size][frame === 1 ? 1 : 0], fill: color.toLowerCase() }
}

// A sprite as one path in real pixels. A pixel is as big as fits the box across, and down with a
// pixel of room above and below; the art sits at the box's left, centred top to bottom. Each run
// of lit pixels in a bitmap row is one little rectangle. Positions are worked out exactly and only
// rounded as they're written, so rounding never piles up along a row.
function spritePath({ left, top, right, bottom, bitmap, fill }) {
  const across = bitmap[0].length
  const down = bitmap.length
  const boxH = (bottom - top) * CELL_H
  const p = Math.min((right - left) * CELL_W / across, (boxH - 2) / down)
  const x0 = left * CELL_W
  const y0 = top * CELL_H + (boxH - down * p) / 2
  const d = []
  bitmap.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== '#') continue
      let end = col
      while (end + 1 < line.length && line[end + 1] === '#') end++
      const len = (end - col + 1) * p
      d.push(`M${fine(x0 + col * p)} ${fine(y0 + row * p)}h${fine(len)}v${fine(p)}h${fine(-len)}z`)
      col = end
    }
  })
  return `<path fill="${fill}" d="${d.join('')}"/>`
}

// Blanks the characters of the cells a sprite covers, keeping their backgrounds, so the terminal's
// blocks for that sprite don't show underneath the drawing. `spans` is a list of [from, to) columns.
function clear(cells, spans) {
  if (spans === undefined) return cells
  for (const [from, to] of spans) {
    for (let x = from; x < Math.min(to, cells.length); x++) cells[x].ch = ' '
  }
  return cells
}

function head(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">` +
    `<rect width="${num(width)}" height="${num(height)}" fill="${PALETTE.field}"/>` +
    `<style>text{font:14px ${FONT};white-space:pre}.b{font-weight:700}</style>`
}

// The stand-in when even the plain board is too long: same size, one line of text.
function tooLarge(width, height) {
  const xs = Array.from(TOO_LARGE, (_, i) => num((i + 1) * CELL_W)).join(' ')
  return `${head(width, height)}<text x="${xs}" y="${BASELINE}" fill="${PALETTE.ink}">${TOO_LARGE}</text></svg>`
}

/**
 * Draws one board as a still SVG picture.
 * @param rows the painter's rows, each a list of { text, color, backgroundColor, bold }
 * @param columns how many cells across
 * @param sprites agents to draw in real pixels, { x, y, w, h, size, color, frame }: a box in
 *   cells, an ART size, a '#rrggbb' colour and frame 0 or 1. Each is a still drawing of the frame
 *   it was given, over its box's cells with their characters cleared; the caller redraws the
 *   picture with the other frame when a sprite walks. A sprite with a bad value is skipped.
 * @return { source, width, height }: the SVG document and its size in CSS pixels. The source is
 *   never longer than SVG_MAX: a board too long for that becomes a one-line stand-in of the same
 *   size, which drops the sprites along with everything else.
 */
export function pictureOf({ rows, columns, sprites = [] } = {}) {
  const cols = count(columns)
  const list = Array.isArray(rows) ? rows : []
  const width = cols * CELL_W
  const height = list.length * CELL_H

  // The columns each row loses to sprites, so their cells are cleared before the row is drawn.
  const placed = (Array.isArray(sprites) ? sprites : []).map((s) => spriteOf(s, cols, list.length)).filter((s) => s !== null)
  const spans = new Map()
  for (const s of placed) {
    for (let y = s.top; y < s.bottom; y++) {
      if (!spans.has(y)) spans.set(y, [])
      spans.get(y).push([s.left, s.right])
    }
  }
  const art = placed.map(spritePath).join('')
  const body = list.map((runs, y) => rowSvg(clear(cellsOf(runs, cols), spans.get(y)), y * CELL_H)).join('')

  let source = `${head(width, height)}${body}${art}</svg>`
  if (source.length > SVG_MAX) source = tooLarge(width, height)
  return { source, width, height }
}
