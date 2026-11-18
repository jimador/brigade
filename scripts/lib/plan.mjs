// Reads a brigade PLAN.md into plain data. Pure ESM, no imports, never throws: malformed input
// lands in `errors` and whatever parsed cleanly is still returned. Handles inline items
// (`- { slug: a, ... }`, possibly wrapped over lines) and block items (`- slug: a` with indented
// keys); both styles yield identical structures. Absent string fields are '' and absent lists [].
// Each item and attempt also carries a non-enumerable `raw`: every key it was written with, mapped
// to its value as text (a scalar unquoted, a list or mapping in flow style), so a caller can see
// `contract: maybe` behind `contract: false`, or tell a missing key from an empty one.
// Reports, never guesses: a frontmatter line no key or list entry owns, text after a flow
// collection, an unclosed one and an attempt that is not a mapping are errors that name the
// frontmatter line.
//
// parsePlan(text) -> {
//   frontmatter: { [key]: string },   // top-level scalar keys, unquoted
//   items: [{ slug, status, depends_on, files, heavy, contract,
//             attempts: [{ model, trigger, result, cause, reason }] }],
//   parked: [{ id, question, reopensAt, raised }],
//   packets: [slug],                  // every `## Packet: <slug>` heading
//   errors: [string],
// }

// Walks YAML text and returns { depth, text }: `depth` is the net count of open flow brackets
// outside quotes and comments, `text` the input with each comment cut to its line's end and
// newlines turned into spaces. A quote opens a quoted scalar only where a value can start: at the
// start, or after `[`, `{`, `,` or `: ` and optional spaces (`flow`), or at the start alone (block
// value); elsewhere it is plain text, as in `note: the cook's branch`. Inside quotes, `''` escapes
// a single quote and a backslash escapes the next character of a double-quoted scalar. A `#`
// opens a comment only at the start or after whitespace.
function scan(s, flow) {
  let depth = 0
  let quote = ''
  let start = true // a value may start here (only spaces since the last indicator)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      out += ch === '\n' ? ' ' : ch
      if (quote === "'" && ch === "'") {
        if (s[i + 1] === "'") out += s[++i]
        else quote = ''
      } else if (quote === '"' && ch === '\\') {
        if (i + 1 < s.length) out += s[++i]
      } else if (quote === '"' && ch === '"') quote = ''
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++
      continue
    }
    if (ch === '\n') { out += ' '; continue }
    out += ch
    if (/\s/.test(ch)) continue
    if (start && (ch === '"' || ch === "'")) { quote = ch; start = false; continue }
    if (flow && (ch === '{' || ch === '[')) depth++
    else if (flow && (ch === '}' || ch === ']')) depth--
    start = flow && ('{[,'.includes(ch) || (ch === ':' && /\s/.test(s[i + 1] || ' ')))
  }
  return { depth, text: out, open: Boolean(quote) }
}

// A value's text without its trailing ` # comment`; a flow value starts with `{` or `[`.
const uncomment = (s) => scan(s, /^\s*[{[]/.test(s)).text.trimEnd()

// A quoted scalar's text, escapes resolved; anything else unchanged.
function unquote(s) {
  const t = s.trim()
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'")
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1')
  return t
}

// Flow collections: { k: v, k: [a, b], k: [{...}] }. Tolerant: a bare word in a mapping is
// skipped, a missing closer ends the collection at end of input.
function parseFlow(s, errors, n) {
  let i = 0
  const err = (msg) => { if (errors) errors.push(`frontmatter line ${n}: ${msg}`) }
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const scalar = (stops) => {
    skip()
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++]
      let out = ''
      while (i < s.length) {
        if (s[i] === q && q === "'" && s[i + 1] === "'") { out += q; i += 2; continue }
        if (s[i] === q) break
        if (q === '"' && s[i] === '\\' && i + 1 < s.length) i++
        out += s[i++]
      }
      i++
      return out
    }
    let out = ''
    while (i < s.length && !stops.includes(s[i])) out += s[i++]
    return out.trim()
  }
  const value = () => {
    skip()
    if (s[i] === '{') return map()
    if (s[i] === '[') return list()
    return scalar(',}]')
  }
  const list = () => {
    i++
    const out = []
    for (;;) {
      skip()
      if (i >= s.length) { err('unclosed [ list'); return out }
      if (s[i] === ']') { i++; return out }
      if (s[i] === ',') { i++; continue }
      const v = value()
      if (v !== '') out.push(v)
    }
  }
  const map = () => {
    i++
    const out = {}
    for (;;) {
      skip()
      if (i >= s.length) { err('unclosed { mapping'); return out }
      if (s[i] === '}') { i++; return out }
      if (s[i] === ',') { i++; continue }
      const key = scalar(':,}')
      if (s[i] === ':') {
        i++
        out[key] = value()
      } // a bare word is a key with no value (valid YAML); it carries no field, so it is skipped
    }
  }
  const out = value()
  skip()
  if (i < s.length && s[i] !== '#') err(`unexpected text after the flow collection: ${s.slice(i)}`)
  return out
}

// A parsed value as text: scalars as they are, lists and mappings in flow style.
function flowText(v) {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return `[${v.map(flowText).join(', ')}]`
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${flowText(x)}`).join(', ')} }`
  return ''
}

// Block YAML subset over lines of { indent, text }.
// `first` is the file line number of raw[0]; each line keeps its own number in `n`.
function prepLines(raw, first) {
  const out = []
  raw.forEach((line, k) => {
    if (!line.trim() || line.trim().startsWith('#')) return
    out.push({ indent: line.length - line.trimStart().length, text: line.trim(), n: first + k })
  })
  return out
}

const isSeqLine = (l) => l.text.startsWith('- ') || l.text === '-'

function parseNode(lines, pos, indent, errors) {
  if (pos.i >= lines.length) return null
  return isSeqLine(lines[pos.i]) ? parseSeq(lines, pos, indent, errors) : parseMap(lines, pos, indent, errors)
}

// Joins following lines onto a flow value that has not closed yet; each line's comment ends at
// its own line end, so it is cut before the join. A line at or left of `indent` (the column of
// the entry or key that opened the collection) is a sibling, never a continuation: the join
// stops there and the collection is reported unclosed on its own line.
function takeFlow(lines, pos, first, indent) {
  let text = first
  while (scan(text, true).depth > 0 && pos.i < lines.length && lines[pos.i].indent > indent) {
    text += '\n' + lines[pos.i++].text
  }
  return scan(text, true).text
}

// A line that starts a mapping entry (`key:` or `key: value`).
const isKeyLine = (l) => /^[^\s:"'{[][^:]*?\s*:(\s|$)/.test(l.text)

// A scalar continued on the more-indented lines that follow (`summary: a long` / `  plain one`):
// folded into one line, as YAML does, each line's comment cut first. A quoted scalar runs on until its quote closes; a plain one
// stops at a `- ` entry or a `key:` line, which stay unowned and are reported.
function takeScalar(lines, pos, indent, first) {
  let text = first
  const quoted = /^["']/.test(first)
  while (pos.i < lines.length && lines[pos.i].indent > indent) {
    const next = lines[pos.i]
    if (quoted ? !scan(text, false).open : isSeqLine(next) || isKeyLine(next)) break
    text += '\n' + next.text
    pos.i++
  }
  return uncomment(text)
}

// A flow value starting on `line`, wrapped lines included, parsed with errors naming `line`.
// When it stays unclosed and its first line had a ` #` comment cut, the error says so: in YAML
// that `#` starts a comment, which takes any closing bracket after it with it.
function flowAt(lines, pos, line, first, indent, errors) {
  const own = []
  const value = parseFlow(takeFlow(lines, pos, first, indent), own, line.n)
  const cut = /\s#/.test(first) && scan(first, true).text.trimEnd() !== first.trimEnd()
  for (const e of own) {
    errors.push(cut && /unclosed/.test(e) ? `${e} (the text after " #" on that line is a YAML comment)` : e)
  }
  return value
}

// True when the value after a block item's first key ends on its own line, so a deeper `key:`
// line after it can only be the item's next key: a non-empty plain scalar, a closed quote or a
// closed flow collection. An empty value, a block scalar header, an open quote or an open flow
// collection owns the lines that follow.
function endsOnLine(value) {
  const v = uncomment(value).trim()
  if (v === '' || /^[|>]/.test(v)) return false
  if (v[0] === '{' || v[0] === '[') return scan(v, true).depth <= 0
  if (v[0] === '"' || v[0] === "'") return !scan(v, false).open
  return true
}

// Each entry's file line number is kept in the list's non-enumerable `lines`.
function parseSeq(lines, pos, indent, errors) {
  const out = []
  const at = []
  Object.defineProperty(out, 'lines', { value: at, enumerable: false })
  while (pos.i < lines.length && lines[pos.i].indent === indent && isSeqLine(lines[pos.i])) {
    const line = lines[pos.i]
    const rest = line.text.slice(1).trim()
    at.push(line.n)
    if (!rest) {
      pos.i++
      out.push(pos.i < lines.length && lines[pos.i].indent > indent ? parseNode(lines, pos, lines[pos.i].indent, errors) : '')
    } else if (rest[0] === '{' || rest[0] === '[') {
      pos.i++
      out.push(flowAt(lines, pos, line, rest, indent, errors))
    } else if (/^[^\s"'{[][^:]*:(\s|$)/.test(rest)) {
      // A block mapping starting on the marker line: seat it two columns past the dash, or at
      // the indent of the next line when that line is a deeper `key:` line the first value
      // cannot own (`- slug: a` with `status:` four columns in). A first value that wraps (an
      // open flow list, a folded plain or quoted scalar) keeps the seat two columns in.
      const next = lines[pos.i + 1]
      const first = /^[^:]*?:\s+(.*)$/.exec(rest)
      const seat = first && endsOnLine(first[1]) && next && next.indent > indent && !isSeqLine(next) && isKeyLine(next)
        ? next.indent
        : indent + 2
      line.indent = seat
      line.text = rest
      out.push(parseMap(lines, pos, seat, errors))
    } else {
      pos.i++
      out.push(unquote(takeScalar(lines, pos, indent, uncomment(rest))))
    }
  }
  return out
}

function parseMap(lines, pos, indent, errors) {
  const out = {}
  while (pos.i < lines.length && lines[pos.i].indent === indent && !isSeqLine(lines[pos.i])) {
    const line = lines[pos.i]
    const m = /^([^\s:"'{[][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line.text)
    pos.i++
    if (!m) {
      errors.push(`unreadable frontmatter line ${line.n}: ${line.text}`)
      continue
    }
    const key = m[1]
    const rest = uncomment(m[2] || '').trim()
    if (rest === '') {
      const next = lines[pos.i]
      if (next && (next.indent > indent || (next.indent === indent && isSeqLine(next)))) {
        out[key] = parseNode(lines, pos, next.indent, errors)
      } else out[key] = ''
    } else if (rest[0] === '{' || rest[0] === '[') {
      out[key] = flowAt(lines, pos, line, rest, indent, errors)
    } else if (/^[|>](?:[1-9][-+]?|[-+][1-9]?)?$/.test(rest)) {
      // A block scalar: the deeper lines that follow are its text.
      const text = []
      while (pos.i < lines.length && lines[pos.i].indent > indent) text.push(lines[pos.i++].text)
      out[key] = text.join(rest[0] === '|' ? '\n' : ' ')
    } else out[key] = unquote(takeScalar(lines, pos, indent, rest))
  }
  return out
}

const str = (v) => (typeof v === 'string' ? v : '')
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : typeof v === 'string' && v !== '' ? [v] : [])
const bool = (v) => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')

const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const withRaw = (record, source) => {
  const raw = {}
  for (const [k, v] of Object.entries(source)) raw[k] = flowText(v)
  return Object.defineProperty(record, 'raw', { value: raw, enumerable: false })
}
const lineOf = (list, k) => (list && list.lines && list.lines[k] ? ` (frontmatter line ${list.lines[k]})` : '')

function normaliseAttempt(a, errors, where) {
  if (!isMap(a)) errors.push(`${where} is not a mapping`)
  const o = isMap(a) ? a : {}
  return withRaw({ model: str(o.model), trigger: str(o.trigger), result: str(o.result), cause: str(o.cause), reason: str(o.reason) }, o)
}

function normaliseItem(raw, errors, n, at) {
  if (!isMap(raw)) {
    errors.push(`items[${n}] is not a mapping${at}`)
    return null
  }
  const slug = str(raw.slug)
  if (!slug) {
    errors.push(`items[${n}] has no slug${at}`)
    return null
  }
  const attempts = Array.isArray(raw.attempts)
    ? raw.attempts.map((a, k) => normaliseAttempt(a, errors, `items[${n}] attempts[${k}]${lineOf(raw.attempts, k)}`))
    : []
  return withRaw({
    slug,
    status: str(raw.status),
    depends_on: strList(raw.depends_on),
    files: strList(raw.files),
    heavy: bool(raw.heavy),
    contract: bool(raw.contract),
    attempts,
  }, raw)
}

// Rows of the `## Parked` table; header and separator rows are skipped.
function parseParked(body) {
  const rows = []
  let inSection = false
  for (const line of body) {
    if (/^##\s/.test(line)) {
      inSection = /^##\s+Parked\s*$/.test(line)
      continue
    }
    if (!inSection) continue
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) continue
    if (cells[0].toLowerCase() === 'id') continue
    rows.push({ id: cells[0] || '', question: cells[1] || '', reopensAt: cells[2] || '', raised: cells[3] || '' })
  }
  return rows
}

export function parsePlan(text) {
  const result = { frontmatter: {}, items: [], parked: [], packets: [], errors: [] }
  try {
    if (typeof text !== 'string') {
      result.errors.push('plan text is not a string')
      return result
    }
    const all = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
    let body = []
    // The frontmatter opens and closes at lines that are exactly `---`, as brigade-validate
    // reads it: an indented `---` inside a block scalar is text, not the end.
    if (all[0] !== '---') {
      result.errors.push('plan has no frontmatter: first line is not ---')
    } else {
      const end = all.indexOf('---', 1)
      if (end === -1) {
        result.errors.push('frontmatter is not closed: no second --- line')
      } else {
        body = all.slice(end + 1)
        const lines = prepLines(all.slice(1, end), 2)
        const pos = { i: 0 }
        const top = {}
        const base = lines.length > 0 ? lines[0].indent : 0
        while (pos.i < lines.length) {
          const line = lines[pos.i]
          if (line.indent !== base || isSeqLine(line)) {
            // No key owns this line (an item indented unlike its siblings, a stray entry):
            // report it and skip the lines nested under it rather than guess their parent.
            result.errors.push(`frontmatter line ${line.n} is not under any key at its indent: ${line.text}`)
            pos.i++
            while (pos.i < lines.length && (lines[pos.i].indent > base || isSeqLine(lines[pos.i]))) pos.i++
            continue
          }
          Object.assign(top, parseMap(lines, pos, base, result.errors))
        }
        for (const [k, v] of Object.entries(top)) if (typeof v === 'string' && v !== '') result.frontmatter[k] = v
        if (top.items !== undefined && top.items !== '') {
          if (!Array.isArray(top.items)) result.errors.push('items is not a list')
          else {
            top.items.forEach((raw, n) => {
              const item = normaliseItem(raw, result.errors, n, lineOf(top.items, n))
              if (item) result.items.push(item)
            })
          }
        }
      }
    }
    let fenced = false
    const outside = []
    for (const line of body) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        continue
      }
      if (fenced) continue
      outside.push(line)
      const m = /^##\s+Packet:\s*(\S+)/.exec(line)
      if (m) result.packets.push(m[1])
    }
    result.parked = parseParked(outside)
  } catch (err) {
    result.errors.push(`unexpected parse failure: ${err && err.message ? err.message : String(err)}`)
  }
  return result
}
