// Checks the board picture: the rows the painter draws, turned into one SVG document the desktop
// app shows. The picture is read back with a small strict XML reader written here, so a broken
// tag, a stray ampersand or a character XML forbids fails the test instead of slipping through.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { pictureOf, spriteMarkup, CELL_W, CELL_H, SVG_MAX } from '../../hooks/board/lib/board-svg.mjs'
import { draw } from '../../hooks/board/lib/board-paint.mjs'
import { PALETTE, ART } from '../../hooks/board/lib/sprites.mjs'

const ALLOWED = new Set(['svg', 'style', 'rect', 'text', 'path'])
const SHAPES = new Set(['█', '▀', '▄', '▌', '▐', '▰', '▱'])
const HOSTILE = [
  '</text></svg><script>alert(1)</script>',
  '" onload="x',
  '&amp;',
  'lone \ud800 high',
  'lone \udc00 low',
  'not a char ￾ here',
  '<a href="x">url(javascript:y)</a>',
]

// --- a strict little XML reader -----------------------------------------------------------------

// Every character XML 1.0 allows; anything else in the source is an error.
const XML_CHAR = /^[\t\n\r -퟿-�\u{10000}-\u{10ffff}]*$/u
const NAME = /^[A-Za-z_:][\w.:-]*/

function decode(raw, where) {
  return raw.replace(/&([^;]*);?/g, (all, body) => {
    if (!all.endsWith(';')) throw new Error(`bare ampersand in ${where}`)
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    const m = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body)
    if (!m) throw new Error(`unknown entity &${body}; in ${where}`)
    const cp = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10)
    const ch = String.fromCodePoint(cp)
    if (!XML_CHAR.test(ch)) throw new Error(`entity for a forbidden character in ${where}`)
    return ch
  })
}

// Reads the whole document into { name, attrs, children } nodes, where a child is a node or a
// string of text. Throws on anything that is not well-formed.
function parseXml(src) {
  if (!XML_CHAR.test(src)) throw new Error('source holds a character XML forbids')
  let i = 0
  const stack = [{ name: '#doc', attrs: {}, children: [] }]
  while (i < src.length) {
    if (src[i] !== '<') {
      const end = src.indexOf('<', i)
      const raw = src.slice(i, end === -1 ? src.length : end)
      if (raw.includes(']]>')) throw new Error('text holds ]]>')
      const text = decode(raw, 'text')
      if (stack.length === 1) {
        if (text.trim() !== '') throw new Error('text outside the root')
      } else {
        stack.at(-1).children.push(text)
      }
      i += raw.length
      continue
    }
    if (src[i + 1] === '/') {
      const m = /^<\/([A-Za-z_:][\w.:-]*)\s*>/.exec(src.slice(i))
      if (!m) throw new Error(`bad end tag at ${i}`)
      const open = stack.pop()
      if (open.name !== m[1]) throw new Error(`</${m[1]}> closes <${open.name}>`)
      i += m[0].length
      continue
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') throw new Error(`unexpected markup declaration at ${i}`)
    i++
    const name = NAME.exec(src.slice(i))
    if (!name) throw new Error(`bad tag name at ${i}`)
    i += name[0].length
    const node = { name: name[0], attrs: {}, children: [] }
    for (;;) {
      const space = /^\s*/.exec(src.slice(i))[0]
      i += space.length
      if (src.startsWith('/>', i)) { i += 2; stack.at(-1).children.push(node); break }
      if (src[i] === '>') { i++; stack.at(-1).children.push(node); stack.push(node); break }
      if (space === '') throw new Error(`no space before attribute at ${i}`)
      const attr = /^([A-Za-z_:][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(src.slice(i))
      if (!attr) throw new Error(`bad attribute at ${i}: ${src.slice(i, i + 30)}`)
      if (Object.hasOwn(node.attrs, attr[1])) throw new Error(`duplicate attribute ${attr[1]}`)
      node.attrs[attr[1]] = decode(attr[3] ?? attr[4], `attribute ${attr[1]}`)
      i += attr[0].length
    }
    if (stack.length === 2 && stack[0].children.length > 1) throw new Error('more than one root')
  }
  if (stack.length !== 1) throw new Error(`<${stack.at(-1).name}> never closed`)
  const roots = stack[0].children.filter((c) => typeof c !== 'string')
  if (roots.length !== 1) throw new Error('expected one root element')
  return roots[0]
}

function* walk(node) {
  yield node
  for (const child of node.children) if (typeof child !== 'string') yield* walk(child)
}

function textOf(node) {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
}

function elements(root, name) {
  return [...walk(root)].filter((n) => n.name === name)
}

function kids(node) {
  return node.children.filter((c) => typeof c !== 'string')
}

// --- rows and boards ------------------------------------------------------------------------------

function run(text, extra = {}) {
  return { text, color: PALETTE.ink, backgroundColor: PALETTE.field, bold: false, ...extra }
}

// Pads a row out to `columns` cells with field-coloured spaces.
function padded(runs, columns) {
  let used = 0
  for (const r of runs) used += Array.from(r.text).length
  return used < columns ? [...runs, run(' '.repeat(columns - used))] : runs
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u

// The rows spread into cells, the way the picture should place them: a wide character takes its
// cell and leaves '' in the next.
function grid(rows) {
  return rows.map((runs) => {
    const line = []
    for (const r of runs) {
      for (const ch of r.text) {
        line.push({ ch, color: r.color, bg: r.backgroundColor, bold: r.bold })
        if (WIDE.test(ch)) line.push({ ch: '', color: r.color, bg: r.backgroundColor, bold: r.bold })
      }
    }
    return line
  })
}

// Every drawn character as { col, row, ch, fill, bold }, read from the text elements under `within`.
function placedChars(within) {
  const out = []
  for (const t of elements(within, 'text')) {
    const xs = t.attrs.x.split(' ')
    const chars = Array.from(textOf(t))
    assert.equal(xs.length, chars.length, `one x per character in ${JSON.stringify(textOf(t))}`)
    const row = (Number(t.attrs.y) - 13) / CELL_H
    assert.ok(Number.isInteger(row), `text y ${t.attrs.y} sits on a row`)
    chars.forEach((ch, k) => {
      const col = Number(xs[k]) / CELL_W
      assert.ok(Number.isInteger(col), `x ${xs[k]} sits on a cell`)
      out.push({ col, row, ch, fill: t.attrs.fill, bold: t.attrs.class === 'b' })
    })
  }
  return out
}

// The text a row shows, rebuilt from the picture by cell position, trailing blanks dropped.
function rowShown(root, row, columns) {
  const line = Array(columns).fill(' ')
  for (const c of placedChars(root)) if (c.row === row) line[c.col] = c.ch
  return line.join('').trimEnd()
}

function card(id, title, extra = {}) {
  return { id, title, phase: 'todo', tag: null, alert: false, ...extra }
}

function agent(id, extra = {}) {
  return {
    id, name: 'Miso', role: 'cook', model: 'claude-sonnet-4-5', state: 'working', dish: 'token-bucket',
    item: id, ticket: null, card: null, activity: 'editing src/limit.ts', tokens: 42000,
    startedAt: 100000, endedAt: null, ...extra,
  }
}

// An invented, busy board: every lane full, a crew, both panels, wide and hostile text on cards.
function snapshot(over = {}) {
  const many = (key, n, phase) => Array.from({ length: n }, (_, i) => card(`${key}-${i}`, `Item ${i} for ${key} 漢字`, { phase, tag: i % 2 ? 'attempt 2' : null }))
  return {
    project: { mode: 'dish', repo: 'storefront', branch: 'feat/rate-limit', title: 'Rate limit the public API', detail: 'token-bucket · 5 items · 2 cooking' },
    lanes: [
      { key: 'todo', title: 'To do', total: 9, cards: [card('docs-page', HOSTILE[0]), ...many('todo', 5, 'todo')] },
      { key: 'cooking', title: 'Cooking', total: 6, cards: [card('token-bucket', 'Token bucket per key', { phase: 'cooking' }), ...many('cook', 4, 'cooking')] },
      { key: 'review', title: 'In review', total: 4, cards: [card('limit-config', HOSTILE[1], { phase: 'review', tag: 'heavy' }), ...many('rev', 3, 'review')] },
      { key: 'rework', title: 'Rework', total: 3, cards: [card('quota-store', 'Quota store', { phase: 'rework', tag: 'attempt 2', alert: true })] },
      { key: 'done', title: 'Done', total: 7, cards: many('done', 6, 'done') },
    ],
    agents: [
      agent('cook-1', { name: 'Miso', card: 'token-bucket' }),
      agent('heavy-1', { name: 'Basil', role: 'heavy', card: 'cook-0', model: 'claude-opus-4-5', activity: 'running tests' }),
      agent('insp-1', { name: 'Sage', role: 'inspector', card: 'limit-config', model: 'claude-haiku-4-5', activity: HOSTILE[2] }),
      agent('plan-1', { name: 'Nori', role: 'planner', card: null, model: 'claude-fable-1', activity: 'watching the board' }),
      agent('cook-2', { name: 'Clove', card: null, model: 'claude-sonnet-4-5', activity: 'reading the packet' }),
    ],
    weather: { level: 2, label: 'SHOWERS', glyph: '☂', percent: 61 },
    messages: [
      { id: 'm1', at: 1000, from: 'Sage', to: 'Miso', item: 'token-bucket', text: 'Two findings, both small', file: null },
      { id: 'm2', at: 900, from: 'Basil', to: 'planner', item: 'cook-0', text: HOSTILE[0], file: null },
    ],
    learnings: { total: 3, lines: ['Run the bundle check before pushing', 'Keep fixtures invented'] },
    detail: null,
    now: 400000,
    ...over,
  }
}

function drawn(columns, frame = 0, over = {}) {
  return draw(snapshot(over), { positions: {}, frame, hovered: null, over: null }, columns)
}

// The same board with every sprite one cell right of its home. A sprite at home stands still, so
// only a walking board looks different on its two frames.
function walked(columns, frame = 0) {
  const homes = drawn(columns).regions.filter((r) => r.kind === 'agent')
  const positions = Object.fromEntries(homes.map((r) => [r.id, { x: r.x + 1, y: r.y }]))
  return draw(snapshot(), { positions, frame, hovered: null, over: null }, columns)
}

// A made-up frame of `height` rows: text in several colours and weights, background stretches,
// blocks and gauge cells, all changing along the row so nothing merges away.
const INKS = ['#e8e6d9', '#6b7089', '#8be9fd', '#ffd166', '#06d6a0']
const BACKS = [PALETTE.field, PALETTE.card, '#3a3f5c']
function generated(height, columns, salt = 0) {
  const rows = []
  for (let y = 0; y < height; y++) {
    const runs = []
    let used = 0
    for (let k = 0; used < columns; k++) {
      const n = Math.min(columns - used, 3 + ((y + k + salt) % 5))
      const pick = (y * 7 + k * 3 + salt) % 11
      const text = pick === 0 ? '█'.repeat(n) : pick === 1 ? '▰▱'.repeat(n).slice(0, n) : 'abcdefghij'.repeat(2).slice(k % 5, (k % 5) + n)
      runs.push(run(text, { color: INKS[(y + k + salt) % INKS.length], backgroundColor: BACKS[(k + y) % BACKS.length], bold: (k + salt) % 4 === 0 }))
      used += n
    }
    rows.push(runs)
  }
  return rows
}

// --- size and background -------------------------------------------------------------------------

test('a real board gives a well-formed picture of the stated size on a field-coloured background', () => {
  const out = drawn(124)
  const pic = pictureOf({ rows: out.rows, columns: 124 })
  assert.equal(pic.width, 124 * CELL_W)
  assert.equal(pic.height, out.rows.length * CELL_H)
  assert.equal(CELL_W, 9)
  assert.equal(CELL_H, 18)
  assert.equal(SVG_MAX, 131072)
  const root = parseXml(pic.source)
  assert.equal(root.name, 'svg')
  assert.equal(root.attrs.xmlns, 'http://www.w3.org/2000/svg')
  assert.equal(root.attrs.width, String(pic.width))
  assert.equal(root.attrs.height, String(pic.height))
  assert.equal(root.attrs.viewBox, `0 0 ${pic.width} ${pic.height}`)
  const first = kids(root)[0]
  assert.equal(first.name, 'rect')
  assert.deepEqual(
    [first.attrs.x ?? '0', first.attrs.y ?? '0', first.attrs.width, first.attrs.height, first.attrs.fill],
    ['0', '0', String(pic.width), String(pic.height), PALETTE.field],
  )
  assert.ok(pic.source.length <= SVG_MAX)
})

test('every character of a real board sits in its own cell, with its colour and weight', () => {
  const out = drawn(124)
  const root = parseXml(pictureOf({ rows: out.rows, columns: 124 }).source)
  const g = grid(out.rows)
  const seen = new Set()
  for (const c of placedChars(root)) {
    const cell = g[c.row][c.col]
    assert.equal(c.ch, cell.ch, `row ${c.row} col ${c.col}`)
    if (c.ch !== ' ') {
      assert.equal(c.fill, cell.color, `colour at row ${c.row} col ${c.col}`)
      assert.equal(c.bold, cell.bold, `weight at row ${c.row} col ${c.col}`)
    }
    const key = `${c.row}:${c.col}`
    assert.ok(!seen.has(key), `cell ${key} drawn twice`)
    seen.add(key)
  }
  // Every character that is not a blank, a wide character's spill or a shape is drawn as text.
  let count = 0
  g.forEach((line, row) => line.forEach((cell, col) => {
    if (cell.ch === '' || cell.ch === ' ' || SHAPES.has(cell.ch)) return
    count++
    assert.ok(seen.has(`${row}:${col}`), `character ${JSON.stringify(cell.ch)} at row ${row} col ${col} missing`)
  }))
  assert.ok(count > 500, `a busy board has plenty of text (${count})`)
})

test('one x per character, counted on a plain row', () => {
  const root = parseXml(pictureOf({ rows: [[run('In review now')]], columns: 13 }).source)
  const [t] = elements(root, 'text')
  assert.equal(textOf(t), 'In review now')
  assert.equal(t.attrs.x, '0 9 18 27 36 45 54 63 72 81 90 99 108')
  assert.equal(t.attrs.y, '13')
})

test('blocks and the gauge are rectangles, not text', () => {
  const ink = '#ff3b30'
  const rows = [[
    run('█', { color: ink }), run('▀▄', { color: '#06d6a0' }), run('▌▐', { color: '#8be9fd' }),
    run('▰▱', { color: '#ffd166' }), run('██', { color: '#b388ff' }),
  ]]
  const root = parseXml(pictureOf({ rows, columns: 9 }).source)
  assert.equal(elements(root, 'text').length, 0)
  const rects = elements(root, 'rect').slice(1).map((r) => [r.attrs.x, r.attrs.y, r.attrs.width, r.attrs.height, r.attrs.fill, r.attrs.stroke ?? null])
  assert.deepEqual(rects, [
    ['0', '0', '9', '18', ink, null],
    ['9', '0', '9', '9', '#06d6a0', null],
    ['18', '9', '9', '9', '#06d6a0', null],
    ['27', '0', '4.5', '18', '#8be9fd', null],
    ['40.5', '0', '4.5', '18', '#8be9fd', null],
    ['46', '1', '7', '16', '#ffd166', null],
    ['55.5', '1.5', '6', '15', 'none', '#ffd166'],
    // Two full blocks side by side in one colour are one rectangle.
    ['63', '0', '18', '18', '#b388ff', null],
  ])
})

test('neighbouring cells with the same background merge into one rectangle', () => {
  const rows = [[
    run('abc', { backgroundColor: '#1a1c2e' }), run('de', { backgroundColor: '#1a1c2e', bold: true }),
    run('fg', { backgroundColor: '#3a3f5c' }), run('h'), run('ij', { backgroundColor: '#3a3f5c' }),
  ], [run('xyz', { backgroundColor: '#1a1c2e' })]]
  const root = parseXml(pictureOf({ rows, columns: 10 }).source)
  const backs = elements(root, 'rect').slice(1).map((r) => [r.attrs.x, r.attrs.y, r.attrs.width, r.attrs.height, r.attrs.fill])
  assert.deepEqual(backs, [
    ['0', '0', '45', '18', '#1a1c2e'],
    ['45', '0', '18', '18', '#3a3f5c'],
    ['72', '0', '18', '18', '#3a3f5c'],
    ['0', '18', '27', '18', '#1a1c2e'],
  ])
})

test('a wide character takes its cell and the next', () => {
  const root = parseXml(pictureOf({ rows: [[run('a漢b'), run('c', { color: '#ffd166' })]], columns: 5 }).source)
  const [t, u] = elements(root, 'text')
  assert.equal(textOf(t), 'a漢b')
  assert.equal(t.attrs.x, '0 9 27')
  assert.equal(u.attrs.x, '36')
})

test('bold runs use one class, and the font is set once in the style block', () => {
  const root = parseXml(pictureOf({ rows: [[run('plain '), run('bold', { bold: true })]], columns: 10 }).source)
  const styles = elements(root, 'style')
  assert.equal(styles.length, 1)
  const css = textOf(styles[0])
  assert.ok(css.includes('14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'), css)
  assert.equal(css.split('ui-monospace').length, 2)
  assert.match(css, /\.b\{font-weight:700\}/)
  const [plain, bold] = elements(root, 'text')
  assert.equal(plain.attrs.class, undefined)
  assert.equal(bold.attrs.class, 'b')
  for (const t of elements(root, 'text')) assert.equal(t.attrs.style, undefined)
})

// --- outside text --------------------------------------------------------------------------------

// What a hostile string looks like once the characters XML forbids are gone.
function cleaned(text) {
  return text.replace(/[\ud800-\udfff￾￿]/g, '')
}

function assertSafe(source) {
  const root = parseXml(source)
  for (const n of walk(root)) {
    assert.ok(ALLOWED.has(n.name), `element <${n.name}> is not allowed`)
    for (const name of Object.keys(n.attrs)) {
      assert.ok(!/^on/i.test(name), `attribute ${name} on <${n.name}>`)
      assert.ok(!/href/i.test(name), `attribute ${name} on <${n.name}>`)
      assert.ok(!/url\(/i.test(n.attrs[name]), `url( in ${name} on <${n.name}>`)
    }
  }
  // The raw text too: no tag but the allowed ones, and none of the words a filter looks for.
  for (const m of source.matchAll(/<\/?\s*([^\s/>]+)/g)) assert.ok(ALLOWED.has(m[1]), `raw tag <${m[1]}>`)
  assert.ok(!/<script/i.test(source))
  assert.ok(!/href/i.test(source), 'raw href')
  assert.ok(!/url\(/i.test(source), 'raw url(')
  assert.ok(!/\son[a-z]*\s*=/i.test(source), 'raw on...= attribute')
  return root
}

test('hostile text in runs cannot add markup and reads back intact', () => {
  const columns = 60
  const rows = HOSTILE.map((text, i) => padded([run(text, { color: INKS[i % INKS.length], bold: i % 2 === 1 })], columns))
  const pic = pictureOf({ rows, columns })
  const root = assertSafe(pic.source)
  HOSTILE.forEach((text, i) => {
    // A forbidden character still holds its cell, as a blank, so everything after it stays put.
    const expected = Array.from(text, (ch) => (cleaned(ch) === '' ? ' ' : ch)).join('').trimEnd()
    assert.equal(rowShown(root, i, columns), expected, `row ${i}`)
  })
  assert.ok(!/[\ud800-\udfff]/.test(pic.source.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), 'no lone surrogate')
  assert.ok(!pic.source.includes('￾'))
})

test('control characters in runs never reach the source', () => {
  const nasty = 'a\u0000b\u0008c\u000bd\u000ce\u001ff￿g'
  const pic = pictureOf({ rows: [[run(nasty)]], columns: 13 })
  const root = assertSafe(pic.source)
  assert.equal(rowShown(root, 0, 13), 'a b c d e f g')
})

test('a hostile board from draw is safe, and its hostile card title reads back', () => {
  const out = drawn(160, 0)
  const pic = pictureOf({ rows: out.rows, columns: 160 })
  const root = assertSafe(pic.source)
  const shown = out.rows.map((_, y) => rowShown(root, y, 160)).join('\n')
  assert.ok(shown.includes('</text></svg>'), 'the hostile title shows as text')
})

test('a bad colour falls back to ink for text and the field for backgrounds', () => {
  const bad = ['red', 'url(#x)', '#12', '#1234', '#abcdeg', '" onload="x', '', null, undefined, 7, '#fff ']
  const rows = bad.map((color) => [run('x', { color, backgroundColor: color })])
  const pic = pictureOf({ rows, columns: 1 })
  const root = assertSafe(pic.source)
  for (const t of elements(root, 'text')) assert.equal(t.attrs.fill, PALETTE.ink)
  assert.equal(elements(root, 'rect').length, 1, 'no background but the field')
  const good = pictureOf({ rows: [[run('a', { color: '#abc', backgroundColor: '#A1B2C3' })]], columns: 1 })
  const g = parseXml(good.source)
  assert.equal(elements(g, 'text')[0].attrs.fill, '#abc')
  assert.equal(elements(g, 'rect')[1].attrs.fill, '#A1B2C3')
})

test('broken input still gives a well-formed picture', () => {
  for (const input of [
    { rows: null, columns: 10 },
    { rows: [null, 'row', [null, 5, { text: 7 }]], columns: 4 },
    { rows: [[run('abc')]], columns: -3 },
    { rows: [[run('abc')]], columns: NaN },
    { rows: [[run('abc')]], columns: 2.7 },
  ]) {
    const pic = pictureOf(input)
    assertSafe(pic.source)
    assert.ok(Number.isFinite(pic.width) && pic.width >= 0)
    assert.ok(Number.isFinite(pic.height) && pic.height >= 0)
  }
  const cut = parseXml(pictureOf({ rows: [[run('abcdef')]], columns: 3 }).source)
  assert.equal(textOf(elements(cut, 'text')[0]), 'abc', 'text past the last column is cut')
})

// --- the size cap --------------------------------------------------------------------------------

test('a crowded real board at 160 columns is drawn in full under the cap', () => {
  const pic = pictureOf({ rows: walked(160, 0).rows, columns: 160 })
  assert.ok(pic.source.length <= SVG_MAX, `${pic.source.length}`)
  assertSafe(pic.source)
  assert.ok(pic.source.includes('>Rate limit the public API<'))
})

// The crowded board stacked `times` over: real rows, as many as it takes to reach a size. Pass
// `walked` as the board to stack one whose sprites are walking.
function stacked(times, frame, board = drawn) {
  const rows = board(160, frame).rows
  return Array.from({ length: times }, () => rows).flat()
}

// How long one copy of the crowded board's picture is, so a test can pick a size near the cap.
function sizeOf(board = drawn) {
  return pictureOf({ rows: stacked(1, 0, board), columns: 160 }).source.length
}

test('a board just under the cap is drawn in full, at its own size', () => {
  const times = Math.floor((SVG_MAX - 4000) / sizeOf(walked))
  assert.ok(times >= 1)
  const pic = pictureOf({ rows: stacked(times, 0, walked), columns: 160 })
  assert.ok(pic.source.length <= SVG_MAX)
  assert.ok(!pic.source.includes('Board too large to draw'))
  assert.equal(pic.height, times * drawn(160, 0).rows.length * CELL_H)
})

test('a board too large to draw becomes a one-line picture of the same size', () => {
  const rows = generated(400, 200)
  const pic = pictureOf({ rows, columns: 200 })
  assert.equal(pic.width, 200 * CELL_W)
  assert.equal(pic.height, 400 * CELL_H)
  assert.ok(pic.source.length <= SVG_MAX)
  assert.ok(pic.source.length < 2000, `small: ${pic.source.length}`)
  const root = assertSafe(pic.source)
  assert.equal(root.attrs.width, String(pic.width))
  assert.equal(root.attrs.height, String(pic.height))
  assert.deepEqual(elements(root, 'text').map(textOf), ['Board too large to draw'])
})

test('the cap holds for a huge stack of the real board too', () => {
  const pic = pictureOf({ rows: stacked(12, 0), columns: 160 })
  assert.ok(pic.source.length <= SVG_MAX)
  assert.deepEqual(elements(parseXml(pic.source), 'text').map(textOf), ['Board too large to draw'])
})

// --- cost and determinism ------------------------------------------------------------------------

function bestOf(times, fn) {
  let best = Infinity
  for (let i = 0; i < times; i++) {
    const t0 = performance.now()
    fn()
    best = Math.min(best, performance.now() - t0)
  }
  return best
}

test('cost grows in step with the cells: 240 rows take at most 12 times as long as 30', () => {
  const small = generated(30, 160)
  const large = generated(240, 160)
  // Warm up both shapes first so the JIT is not part of the measurement.
  for (let i = 0; i < 3; i++) { pictureOf({ rows: small, columns: 160 }); pictureOf({ rows: large, columns: 160 }) }
  const a = bestOf(5, () => { for (let i = 0; i < 4; i++) pictureOf({ rows: small, columns: 160 }) })
  const b = bestOf(5, () => { for (let i = 0; i < 4; i++) pictureOf({ rows: large, columns: 160 }) })
  assert.ok(b <= a * 12, `160x240 took ${b.toFixed(2)} ms, 160x30 took ${a.toFixed(2)} ms, ratio ${(b / a).toFixed(1)}`)
})

test('the same input gives the same picture, with tidy numbers', () => {
  const out = drawn(124, 0)
  const input = { rows: out.rows, columns: 124, sprites: [{ x: 1, y: 2, w: 3, h: 1, size: 'xl', color: '#06d6a0', frame: 1 }] }
  const a = pictureOf(input).source
  const b = pictureOf(structuredClone(input)).source
  assert.equal(a, b)
  const root = parseXml(a)
  for (const n of walk(root)) {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (n.attrs[key] === undefined) continue
      for (const v of n.attrs[key].split(' ')) assert.match(v, /^-?\d+(\.\d)?$/, `<${n.name} ${key}="${n.attrs[key]}">`)
    }
  }
})

// --- sprites -------------------------------------------------------------------------------------

// A board of `height` rows, each `columns` field-coloured spaces.
function blank(height, columns) {
  return Array.from({ length: height }, () => [run(' '.repeat(columns))])
}

function pathsIn(source) {
  return source.match(/<path[^>]*\/>/g) ?? []
}

// One sub-path as the picture writes it: `M x y h len v p h -len z`. A number has at most two
// decimals and no trailing zero.
const N = '-?\\d+(?:\\.\\d?[1-9])?'
const SUB = new RegExp(`M(${N}) (${N})h(${N})v(${N})h-(${N})z`, 'y')

function subpaths(d) {
  const out = []
  SUB.lastIndex = 0
  while (SUB.lastIndex < d.length) {
    const at = SUB.lastIndex
    const m = SUB.exec(d)
    assert.ok(m, `sub-path at ${at} in ${d.slice(at, at + 40)}`)
    assert.equal(m[5], m[3], 'a sub-path goes back as far as it went')
    out.push({ x: Number(m[1]), y: Number(m[2]), len: Number(m[3]), p: Number(m[4]) })
  }
  return out
}

// The lit pixels a path draws, as 'row:col' keys, read back with the art's top left and pixel size.
function litOf(d, left, top, p) {
  const lit = new Set()
  const subs = subpaths(d)
  for (const s of subs) {
    const col = Math.round((s.x - left) / p)
    const row = Math.round((s.y - top) / p)
    const n = Math.round(s.len / p)
    assert.ok(Math.abs(s.x - (left + col * p)) <= 0.005 + 1e-9, `x ${s.x} on the pixel grid`)
    assert.ok(Math.abs(s.y - (top + row * p)) <= 0.005 + 1e-9, `y ${s.y} on the pixel grid`)
    assert.ok(Math.abs(s.p - p) <= 0.005 + 1e-9, `pixel ${s.p} is ${p}`)
    for (let k = 0; k < n; k++) lit.add(`${row}:${col + k}`)
  }
  return { lit, count: subs.length }
}

function litOfArt(bitmap) {
  const lit = new Set()
  let runs = 0
  bitmap.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== '#') continue
      if (col === 0 || line[col - 1] !== '#') runs++
      lit.add(`${row}:${col}`)
    }
  })
  return { lit, count: runs }
}

function dOf(source) {
  const [only] = elements(parseXml(source), 'path')
  return only.attrs.d
}

const SPRITE = { x: 10, y: 4, w: 3, h: 1, size: 'm', color: '#06d6a0', frame: 0 }

test('an m sprite in a 3 by 1 box draws its art at two picture pixels a dot', () => {
  const pic = pictureOf({ rows: blank(6, 20), columns: 20, sprites: [SPRITE] })
  const paths = pathsIn(pic.source)
  assert.equal(paths.length, 1)
  assert.ok(paths[0].startsWith('<path fill="#06d6a0" d="M94 73h2v2h-2z'), paths[0])
  assert.deepEqual(litOf(dOf(pic.source), 90, 73, 2), litOfArt(ART.m[0]))
})

test('an xl sprite in the same box draws at four thirds of a picture pixel, rounded only when written', () => {
  const pic = pictureOf({ rows: blank(6, 20), columns: 20, sprites: [{ ...SPRITE, size: 'xl' }] })
  const d = dOf(pic.source)
  assert.ok(d.startsWith('M95.33 73h1.33v1.33h-1.33z'), d)
  assert.deepEqual(litOf(d, 90, 73, 4 / 3), litOfArt(ART.xl[0]))
})

test('frame 1 draws the second bitmap; any other frame draws the first', () => {
  const draw1 = (frame) => dOf(pictureOf({ rows: blank(6, 20), columns: 20, sprites: [{ ...SPRITE, frame }] }).source)
  assert.deepEqual(litOf(draw1(1), 90, 73, 2), litOfArt(ART.m[1]))
  for (const frame of [0, 2, undefined, '1', true, -1, 1.5]) {
    assert.deepEqual(litOf(draw1(frame), 90, 73, 2), litOfArt(ART.m[0]), `frame ${String(frame)}`)
  }
  const { frame, ...noFrame } = SPRITE
  assert.equal(frame, 0)
  assert.equal(dOf(pictureOf({ rows: blank(6, 20), columns: 20, sprites: [noFrame] }).source), draw1(0))
})

test('every size draws its own bitmap, left in its box and centred top to bottom', () => {
  for (const size of ['s', 'm', 'l', 'xl']) {
    const art = ART[size][0]
    const p = Math.min(3 * CELL_W / art[0].length, (CELL_H - 2) / art.length)
    const top = 4 * CELL_H + (CELL_H - art.length * p) / 2
    const d = dOf(pictureOf({ rows: blank(6, 20), columns: 20, sprites: [{ ...SPRITE, size }] }).source)
    assert.deepEqual(litOf(d, 90, top, p), litOfArt(art), size)
  }
})

test('a cleared cell keeps its background rect and has no text, and blocks under a sprite go', () => {
  const rows = [
    [run('abcdefgh', { backgroundColor: '#1a1c2e' })],
    [run('ijklmnop')],
    [run('████████', { color: '#ff3b30' })],
  ]
  const sprites = [{ ...SPRITE, x: 2, y: 0 }, { ...SPRITE, x: 0, y: 2 }]
  const root = parseXml(pictureOf({ rows, columns: 8, sprites }).source)
  assert.equal(rowShown(root, 0, 8), 'ab   fgh')
  assert.equal(rowShown(root, 1, 8), 'ijklmnop')
  const rects = elements(root, 'rect').slice(1).map((r) => [r.attrs.x, r.attrs.y, r.attrs.width, r.attrs.height, r.attrs.fill])
  assert.deepEqual(rects, [
    ['0', '0', '72', '18', '#1a1c2e'],
    ['27', '36', '45', '18', '#ff3b30'],
  ])
})

test('a sprite half off the right edge clears only cells on the board and draws inside it', () => {
  const rows = [[run('abcde')], [run('vwxyz')]]
  const pic = pictureOf({ rows, columns: 5, sprites: [{ ...SPRITE, x: 3, y: 0, w: 4, h: 1 }] })
  const root = parseXml(pic.source)
  assert.equal(rowShown(root, 0, 5), 'abc')
  assert.equal(rowShown(root, 1, 5), 'vwxyz')
  const subs = subpaths(dOf(pic.source))
  assert.ok(subs.length > 0)
  for (const s of subs) {
    assert.ok(s.x >= 27 && s.x + s.len <= pic.width + 0.01, `x ${s.x} + ${s.len} inside the board`)
    assert.ok(s.y >= 0 && s.y + s.p <= CELL_H + 0.01, `y ${s.y} inside the sprite's row`)
  }
})

test('a sprite box that does not touch the board draws nothing', () => {
  const rows = [[run('abcde')], [run('vwxyz')]]
  const base = pictureOf({ rows, columns: 5 }).source
  for (const over of [
    { x: 1e300 }, { x: -1e300 }, { y: 1e300 }, { x: 5 }, { y: 2 }, { x: -3, w: 3 }, { y: -5, h: 2 },
    { w: 0.5 }, { h: 0.9 },
  ]) {
    const pic = pictureOf({ rows, columns: 5, sprites: [{ ...SPRITE, x: 1, y: 0, ...over }] })
    assert.equal(pic.source, base, JSON.stringify(over))
  }
})

test('a sprite adds exactly one path and no animation, after the rows', () => {
  const rows = [[run('same top')], [run('frame zero')], [run('same end')]]
  const still = pictureOf({ rows, columns: 10, sprites: [{ ...SPRITE, x: 0, y: 2 }] })
  assert.equal(still.source.split('<path').length - 1, 1)
  assert.ok(!still.source.includes('<animate'))
  const sprites = [{ ...SPRITE, x: 0, y: 2 }, { ...SPRITE, x: 5, y: 0, color: '#ff7ab6', size: 's' }]
  const root = parseXml(pictureOf({ rows, columns: 10, sprites }).source)
  const names = kids(root).map((k) => k.name)
  assert.deepEqual(names.slice(-2), ['path', 'path'])
  assert.ok(names.lastIndexOf('text') < names.indexOf('path'), 'paths after every row')
  assert.deepEqual(elements(root, 'path').map((p) => p.attrs.fill), ['#06d6a0', '#ff7ab6'])
})

test('blocks under a sprite are cleared before the row is drawn', () => {
  const rows = [[run('ab▀▀ef')]]
  const pic = pictureOf({ rows, columns: 6, sprites: [{ ...SPRITE, x: 2, y: 0, w: 2, h: 1 }] })
  assert.equal(rowShown(parseXml(pic.source), 0, 6), 'ab  ef')
  assert.equal(elements(parseXml(pic.source), 'rect').length, 1, 'no block left but the field')
})

test('a colour in capitals is written in lower case', () => {
  const pic = pictureOf({ rows: blank(6, 20), columns: 20, sprites: [{ ...SPRITE, color: '#06D6A0' }] })
  assert.ok(pathsIn(pic.source)[0].startsWith('<path fill="#06d6a0" d="M'), pathsIn(pic.source)[0])
})

test('every hostile sprite value is skipped and leaves no trace in the source', () => {
  const rows = [[run('abcdefghij')], [run('klmnopqrst')]]
  const base = pictureOf({ rows, columns: 10 }).source
  const ok = { x: 1, y: 0, w: 3, h: 1, size: 'm', color: '#06d6a0', frame: 0 }
  const hostile = [
    null, undefined, 7, 'm', ['m'],
    { ...ok, size: ['m'] }, { ...ok, size: '__proto__' }, { ...ok, size: 'constructor' },
    { ...ok, size: 'toString' }, { ...ok, size: 'hasOwnProperty' }, { ...ok, size: 'M' }, { ...ok, size: 'xxl' },
    { ...ok, size: null }, { ...ok, size: 2 }, { ...ok, size: { toString: () => 'm' } },
    { ...ok, color: '" onload="x' }, { ...ok, color: 'url(#x)' }, { ...ok, color: '#abc' }, { ...ok, color: '#06d6a0 ' },
    { ...ok, color: '#06d6a0"/><script>alert(1)</script>' }, { ...ok, color: 'red' }, { ...ok, color: null },
    { ...ok, color: ['#06d6a0'] }, { ...ok, color: '#06d6ag' },
    { ...ok, x: '5' }, { ...ok, x: '1' }, { ...ok, y: '0' }, { ...ok, w: '3' }, { ...ok, h: '1' },
    { ...ok, x: NaN }, { ...ok, y: Infinity }, { ...ok, w: -Infinity }, { ...ok, x: null }, { ...ok, x: [1] },
    { ...ok, w: 0 }, { ...ok, w: -3 }, { ...ok, h: 0 }, { ...ok, h: -1 }, { ...ok, x: undefined },
  ]
  for (const sprite of hostile) {
    const pic = pictureOf({ rows, columns: 10, sprites: [sprite] })
    assertSafe(pic.source)
    assert.equal(pic.source, base, `skipped: ${JSON.stringify(sprite)}`)
  }
  for (const sprites of [null, 'nope', 5, { 0: ok, length: 1 }]) {
    assert.equal(pictureOf({ rows, columns: 10, sprites }).source, base, `no list: ${String(sprites)}`)
  }
})

test('every path carries only fill and d', () => {
  const out = drawn(160, 0)
  const sprites = Array.from({ length: 12 }, (_, i) => ({ x: i * 12, y: i, w: 3, h: 1, size: ['s', 'm', 'l', 'xl'][i % 4], color: INKS[i % INKS.length], frame: i % 2 }))
  const root = assertSafe(pictureOf({ rows: out.rows, columns: 160, sprites }).source)
  const paths = elements(root, 'path')
  assert.equal(paths.length, 12)
  for (const p of paths) {
    assert.deepEqual(Object.keys(p.attrs).sort(), ['d', 'fill'])
    assert.match(p.attrs.fill, /^#[0-9a-f]{6}$/)
    assert.equal(kids(p).length, 0)
    subpaths(p.attrs.d)
  }
})

test('with no sprites the picture is exactly what it was before sprites existed', () => {
  const r = (text, extra = {}) => run(text, extra)
  const rows = [[r('Ab', { backgroundColor: '#1a1c2e', bold: true }), r('█▀', { color: '#06d6a0' })], [r('cd'), r('▰▱', { color: '#ffd166' })]]
  // Written down from the picture code as it stood before sprites were added.
  const pinned = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" fill="#0f1020"/><style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}.b{font-weight:700}</style><rect x="0" y="0" width="18" height="18" fill="#1a1c2e"/><rect x="18" y="0" width="9" height="18" fill="#06d6a0"/><rect x="27" y="0" width="9" height="9" fill="#06d6a0"/><text x="0 9" y="13" fill="#e8e6d9" class="b">Ab</text><rect x="19" y="19" width="7" height="16" fill="#ffd166"/><rect x="28.5" y="19.5" width="6" height="15" fill="none" stroke="#ffd166"/><text x="0 9" y="31" fill="#e8e6d9">cd</text></svg>'
  assert.equal(pictureOf({ rows, columns: 4 }).source, pinned)
  assert.equal(pictureOf({ rows, columns: 4, sprites: [] }).source, pinned)
  // A sprite on this board changes it, so the pin is not passing by accident.
  assert.notEqual(pictureOf({ rows, columns: 4, sprites: [{ ...SPRITE, x: 0, y: 1 }] }).source, pinned)
})

test('a small board with two sprites comes out exactly as pinned', () => {
  const rows = [
    [run('Ab', { backgroundColor: '#1a1c2e', bold: true }), run('█▀', { color: '#06d6a0' }), run('a<b&  ')],
    [run('cd'), run('▰▱', { color: '#ffd166' }), run('In review')],
  ]
  const sprites = [
    { x: 7, y: 0, w: 3, h: 1, size: 's', color: '#06d6a0', frame: 0 },
    { x: 0, y: 1, w: 2, h: 1, size: 'm', color: '#FF7AB6', frame: 1 },
  ]
  // Written down from the picture code as it stood with every input it ever took, so taking
  // inputs away can't change what today's caller gets.
  const pinned = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="36" viewBox="0 0 90 36"><rect width="90" height="36" fill="#0f1020"/><style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}.b{font-weight:700}</style><rect x="0" y="0" width="18" height="18" fill="#1a1c2e"/><rect x="18" y="0" width="9" height="18" fill="#06d6a0"/><rect x="27" y="0" width="9" height="9" fill="#06d6a0"/><text x="0 9" y="13" fill="#e8e6d9" class="b">Ab</text><text x="36 45 54" y="13" fill="#e8e6d9">a&lt;b</text><rect x="19" y="19" width="7" height="16" fill="#ffd166"/><rect x="28.5" y="19.5" width="6" height="15" fill="none" stroke="#ffd166"/><text x="36 45 54 63 72 81" y="31" fill="#e8e6d9">In rev</text><path fill="#06d6a0" d="M68.33 1h2.67v2.67h-2.67zM73.67 1h2.67v2.67h-2.67zM65.67 3.67h13.33v2.67h-13.33zM63 6.33h5.33v2.67h-5.33zM71 6.33h2.67v2.67h-2.67zM76.33 6.33h5.33v2.67h-5.33zM63 9h18.67v2.67h-18.67zM65.67 11.67h2.67v2.67h-2.67zM71 11.67h2.67v2.67h-2.67zM76.33 11.67h2.67v2.67h-2.67zM63 14.33h2.67v2.67h-2.67zM79 14.33h2.67v2.67h-2.67z"/><path fill="#ff7ab6" d="M4 19h2v2h-2zM12 19h2v2h-2zM0 21h2v2h-2zM6 21h2v2h-2zM10 21h2v2h-2zM16 21h2v2h-2zM0 23h2v2h-2zM4 23h10v2h-10zM16 23h2v2h-2zM0 25h6v2h-6zM8 25h2v2h-2zM12 25h6v2h-6zM0 27h18v2h-18zM2 29h14v2h-14zM2 31h2v2h-2zM14 31h2v2h-2zM0 33h2v2h-2zM16 33h2v2h-2z"/></svg>'
  assert.equal(pictureOf({ rows, columns: 10, sprites }).source, pinned)
})

test('sprites are drawn right up to the size cap, and only the stand-in drops them', () => {
  const sprites = [{ ...SPRITE, x: 0, y: 0 }]
  const times = Math.floor((SVG_MAX - 4000) / sizeOf(walked))
  assert.ok(times >= 1)
  const near = pictureOf({ rows: stacked(times, 0, walked), columns: 160, sprites })
  assert.ok(near.source.length <= SVG_MAX)
  assert.equal(pathsIn(near.source).length, 1)
  const stub = pictureOf({ rows: generated(400, 200), columns: 200, sprites })
  assert.ok(stub.source.length < 2000)
  assert.equal(pathsIn(stub.source).length, 0)
  assertSafe(stub.source)
})

test('thirty sprites add at most 20000 characters and cost little next to the board', () => {
  // A busy board small enough that the sprites are drawn rather than the one-line stand-in.
  const rows = generated(24, 160)
  const sizes4 = ['s', 'm', 'l', 'xl']
  const sprites = Array.from({ length: 30 }, (_, i) => ({
    x: 3 + (i % 6) * 26, y: 1 + Math.floor(i / 6) * 4, w: 3, h: 1, size: sizes4[i % 4], color: INKS[i % INKS.length], frame: i % 2,
  }))
  const pic = pictureOf({ rows, columns: 160, sprites })
  const paths = pathsIn(pic.source)
  assert.equal(paths.length, 30)
  const added = paths.join('').length
  assert.ok(added <= 20000, `sprites added ${added} characters`)
  for (let i = 0; i < 3; i++) { pictureOf({ rows, columns: 160 }); pictureOf({ rows, columns: 160, sprites }) }
  const without = bestOf(5, () => { for (let i = 0; i < 4; i++) pictureOf({ rows, columns: 160 }) })
  const withSprites = bestOf(5, () => { for (let i = 0; i < 4; i++) pictureOf({ rows, columns: 160, sprites }) })
  assert.ok(withSprites <= without * 2, `with sprites ${withSprites.toFixed(2)} ms, without ${without.toFixed(2)} ms`)
})

// A second small board with two sprites, l and xl this time, so the pin covers the sizes whose
// pixels fall on fractions.
const PINNED_ROWS = [
  [run('Hi ', { bold: true }), run('▄▄', { color: '#4cc9f0' }), run('  ok')],
  [run('to do', { backgroundColor: '#1a1c2e' }), run('     ')],
]
const PINNED_SPRITES = [
  { x: 1, y: 0, w: 3, h: 1, size: 'l', color: '#ffd166', frame: 1 },
  { x: 6, y: 1, w: 3, h: 1, size: 'xl', color: '#4cc9f0', frame: 0 },
]

test('a board with an l and an xl sprite comes out exactly as pinned', () => {
  // Written down from the picture code before the sprite drawing was shared with the demo.
  const pinned = '<svg xmlns="http://www.w3.org/2000/svg" width="81" height="36" viewBox="0 0 81 36"><rect width="81" height="36" fill="#0f1020"/><style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}.b{font-weight:700}</style><rect x="36" y="9" width="9" height="9" fill="#4cc9f0"/><text x="0" y="13" fill="#e8e6d9" class="b">H</text><text x="63 72" y="13" fill="#e8e6d9">ok</text><rect x="0" y="18" width="45" height="18" fill="#1a1c2e"/><text x="0 9 18 27 36" y="31" fill="#e8e6d9">to do</text><path fill="#ffd166" d="M13.8 1h1.6v1.6h-1.6zM20.2 1h1.6v1.6h-1.6zM9 2.6h1.6v1.6h-1.6zM15.4 2.6h1.6v1.6h-1.6zM18.6 2.6h1.6v1.6h-1.6zM25 2.6h1.6v1.6h-1.6zM9 4.2h1.6v1.6h-1.6zM12.2 4.2h11.2v1.6h-11.2zM25 4.2h1.6v1.6h-1.6zM9 5.8h17.6v1.6h-17.6zM9 7.4h4.8v1.6h-4.8zM17 7.4h1.6v1.6h-1.6zM21.8 7.4h4.8v1.6h-4.8zM9 9h17.6v1.6h-17.6zM10.6 10.6h14.4v1.6h-14.4zM12.2 12.2h3.2v1.6h-3.2zM20.2 12.2h3.2v1.6h-3.2zM10.6 13.8h1.6v1.6h-1.6zM15.4 13.8h4.8v1.6h-4.8zM23.4 13.8h1.6v1.6h-1.6zM12.2 15.4h1.6v1.6h-1.6zM21.8 15.4h1.6v1.6h-1.6z"/><path fill="#4cc9f0" d="M59.33 19h1.33v1.33h-1.33zM64.67 19h1.33v1.33h-1.33zM60.67 20.33h1.33v1.33h-1.33zM63.33 20.33h1.33v1.33h-1.33zM58 21.67h9.33v1.33h-9.33zM56.67 23h12v1.33h-12zM55.33 24.33h4v1.33h-4zM60.67 24.33h4v1.33h-4zM66 24.33h4v1.33h-4zM54 25.67h17.33v1.33h-17.33zM54 27h17.33v1.33h-17.33zM54 28.33h4v1.33h-4zM59.33 28.33h6.67v1.33h-6.67zM67.33 28.33h4v1.33h-4zM56.67 29.67h4v1.33h-4zM64.67 29.67h4v1.33h-4zM55.33 31h2.67v1.33h-2.67zM60.67 31h4v1.33h-4zM67.33 31h2.67v1.33h-2.67zM54 32.33h2.67v1.33h-2.67zM68.67 32.33h2.67v1.33h-2.67zM55.33 33.67h1.33v1.33h-1.33zM68.67 33.67h1.33v1.33h-1.33z"/></svg>'
  assert.equal(pictureOf({ rows: PINNED_ROWS, columns: 9, sprites: PINNED_SPRITES }).source, pinned)
})

// --- one sprite on its own, as the demo draws it --------------------------------------------------

test('spriteMarkup draws an m sprite exactly where and as the picture does', () => {
  const one = spriteMarkup(SPRITE)
  assert.ok(one.startsWith('<path fill="'), one)
  assert.ok(one.startsWith('<path fill="#06d6a0" d="M94 73h2v2h-2z'), one)
  assert.equal(one, pathsIn(pictureOf({ rows: blank(6, 20), columns: 20, sprites: [SPRITE] }).source)[0])
  assert.deepEqual(litOf(dOf(one), 90, 73, 2), litOfArt(ART.m[0]))
})

test('spriteMarkup at cell 0, 0 draws the same art from the top left corner', () => {
  const d = dOf(spriteMarkup({ ...SPRITE, x: 0, y: 0 }))
  assert.ok(d.startsWith('M4 1h2v2h-2z'), d)
  assert.deepEqual(litOf(d, 0, 1, 2), litOfArt(ART.m[0]))
})

test('spriteMarkup draws the second bitmap on frame 1 and the first on any other', () => {
  assert.deepEqual(litOf(dOf(spriteMarkup({ ...SPRITE, frame: 1 })), 90, 73, 2), litOfArt(ART.m[1]))
  for (const frame of [0, 2, undefined, '1', true]) {
    assert.deepEqual(litOf(dOf(spriteMarkup({ ...SPRITE, frame })), 90, 73, 2), litOfArt(ART.m[0]), `frame ${String(frame)}`)
  }
})

test('spriteMarkup gives an empty string for a bad size, a bad colour or a string position', () => {
  for (const bad of [
    null, undefined, 'm', 7,
    { ...SPRITE, size: 'xxl' }, { ...SPRITE, size: '__proto__' }, { ...SPRITE, size: null },
    { ...SPRITE, color: 'red' }, { ...SPRITE, color: '#abc' }, { ...SPRITE, color: '#06d6a0"/><script>' },
    { ...SPRITE, x: '10' }, { ...SPRITE, y: '4' }, { ...SPRITE, x: NaN }, { ...SPRITE, w: 0 }, { ...SPRITE, h: -1 },
    { ...SPRITE, w: 0.5 },
  ]) {
    assert.equal(spriteMarkup(bad), '', JSON.stringify(bad))
  }
})

test('spriteMarkup has no board to clamp to, and matches each sprite the picture pins', () => {
  // Past the right edge of any small board, the art is still drawn in full.
  const far = spriteMarkup({ ...SPRITE, x: 500 })
  assert.ok(far.startsWith('<path fill="#06d6a0" d="M4504 73h2v2h-2z'), far)
  const paths = pathsIn(pictureOf({ rows: PINNED_ROWS, columns: 9, sprites: PINNED_SPRITES }).source)
  assert.deepEqual(paths, PINNED_SPRITES.map(spriteMarkup))
})
