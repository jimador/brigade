// Reads a brigade PLAN.md into plain data. Pure ESM, no imports, never throws: malformed input
// lands in `errors` and whatever parsed cleanly is still returned. Handles inline items
// (`- { slug: a, ... }`, possibly wrapped over lines) and block items (`- slug: a` with indented
// keys); both styles yield identical structures. Absent string fields are '' and absent lists [].
//
// parsePlan(text) -> {
//   frontmatter: { [key]: string },   // top-level scalar keys, unquoted
//   items: [{ slug, status, depends_on, files, heavy, contract,
//             attempts: [{ model, trigger, result, cause, reason }] }],
//   parked: [{ id, question, reopensAt, raised }],
//   packets: [slug],                  // every `## Packet: <slug>` heading
//   errors: [string],
// }

function unquote(s) {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1)
  }
  return t
}

// Net open brackets in a string, ignoring quoted text.
function depthOf(s) {
  let depth = 0
  let quote = ''
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
  }
  return depth
}

// Flow collections: { k: v, k: [a, b], k: [{...}] }. Tolerant: a bare word in a mapping is
// skipped, a missing closer ends the collection at end of input.
function parseFlow(s) {
  let i = 0
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const scalar = (stops) => {
    skip()
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++]
      let out = ''
      while (i < s.length && s[i] !== q) out += s[i++]
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
      if (i >= s.length) return out
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
      if (i >= s.length) return out
      if (s[i] === '}') { i++; return out }
      if (s[i] === ',') { i++; continue }
      const key = scalar(':,}')
      if (s[i] === ':') {
        i++
        out[key] = value()
      }
    }
  }
  return value()
}

// Block YAML subset over lines of { indent, text }.
function prepLines(raw) {
  const out = []
  for (const line of raw) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    out.push({ indent: line.length - line.trimStart().length, text: line.trim() })
  }
  return out
}

const isSeqLine = (l) => l.text.startsWith('- ') || l.text === '-'

function parseNode(lines, pos, indent, errors) {
  if (pos.i >= lines.length) return null
  return isSeqLine(lines[pos.i]) ? parseSeq(lines, pos, indent, errors) : parseMap(lines, pos, indent, errors)
}

// Joins following lines onto a flow value that has not closed yet.
function takeFlow(lines, pos, first) {
  let text = first
  while (depthOf(text) > 0 && pos.i < lines.length) text += ' ' + lines[pos.i++].text
  return text
}

function parseSeq(lines, pos, indent, errors) {
  const out = []
  while (pos.i < lines.length && lines[pos.i].indent === indent && isSeqLine(lines[pos.i])) {
    const line = lines[pos.i]
    const rest = line.text.slice(1).trim()
    if (!rest) {
      pos.i++
      out.push(pos.i < lines.length && lines[pos.i].indent > indent ? parseNode(lines, pos, lines[pos.i].indent, errors) : '')
    } else if (rest[0] === '{' || rest[0] === '[') {
      pos.i++
      out.push(parseFlow(takeFlow(lines, pos, rest)))
    } else if (/^[^\s"'{[][^:]*:(\s|$)/.test(rest)) {
      // A block mapping starting on the marker line: re-seat it two columns in.
      line.indent = indent + 2
      line.text = rest
      out.push(parseMap(lines, pos, indent + 2, errors))
    } else {
      pos.i++
      out.push(unquote(rest))
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
      errors.push(`unreadable frontmatter line: ${line.text}`)
      continue
    }
    const key = m[1]
    const rest = (m[2] || '').trim()
    if (rest === '') {
      const next = lines[pos.i]
      if (next && (next.indent > indent || (next.indent === indent && isSeqLine(next)))) {
        out[key] = parseNode(lines, pos, next.indent, errors)
      } else out[key] = ''
    } else if (rest[0] === '{' || rest[0] === '[') {
      out[key] = parseFlow(takeFlow(lines, pos, rest))
    } else out[key] = unquote(rest)
  }
  return out
}

const str = (v) => (typeof v === 'string' ? v : '')
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : typeof v === 'string' && v !== '' ? [v] : [])
const bool = (v) => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')

function normaliseAttempt(a) {
  const o = a && typeof a === 'object' && !Array.isArray(a) ? a : {}
  return { model: str(o.model), trigger: str(o.trigger), result: str(o.result), cause: str(o.cause), reason: str(o.reason) }
}

function normaliseItem(raw, errors, n) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`items[${n}] is not a mapping`)
    return null
  }
  const slug = str(raw.slug)
  if (!slug) {
    errors.push(`items[${n}] has no slug`)
    return null
  }
  return {
    slug,
    status: str(raw.status),
    depends_on: strList(raw.depends_on),
    files: strList(raw.files),
    heavy: bool(raw.heavy),
    contract: bool(raw.contract),
    attempts: Array.isArray(raw.attempts) ? raw.attempts.map(normaliseAttempt) : [],
  }
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
    if (all[0].trim() !== '---') {
      result.errors.push('plan has no frontmatter: first line is not ---')
    } else {
      const end = all.findIndex((l, i) => i > 0 && l.trim() === '---')
      if (end === -1) {
        result.errors.push('frontmatter is not closed: no second --- line')
      } else {
        body = all.slice(end + 1)
        const lines = prepLines(all.slice(1, end))
        const pos = { i: 0 }
        const top = {}
        while (pos.i < lines.length) {
          const before = pos.i
          Object.assign(top, parseMap(lines, pos, lines[pos.i].indent, result.errors))
          if (pos.i === before) pos.i++
        }
        for (const [k, v] of Object.entries(top)) if (typeof v === 'string' && v !== '') result.frontmatter[k] = v
        if (top.items !== undefined && top.items !== '') {
          if (!Array.isArray(top.items)) result.errors.push('items is not a list')
          else {
            top.items.forEach((raw, n) => {
              const item = normaliseItem(raw, result.errors, n)
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
