// Reads a roadmap directory into plain data and answers graph questions about it. This is the
// shared engine behind `brigade-roadmap` and `brigade-roadmap-view`. Like plan.mjs it never
// throws: a malformed file lands in `errors` and everything that parsed cleanly is still
// returned. Only the Node standard library is used, and only `parseRoadmap` touches the disk;
// `parseRoadmapFiles` and every graph question are pure.
//
// A roadmap directory holds:
//   ROADMAP.md         doc: roadmap — frontmatter mode, focus, max_depth, next_ids; body tables
//                      (Systems, Inventory, Requirements), Decisions and Open questions lists
//   nodes/<id>.md      doc: roadmap_node — one epic, feature, story or task per file
//   batches/<n>.md     doc: roadmap_batch — one drill round's operations and receipts
//
// parseRoadmap(dir) / parseRoadmapFiles({ 'ROADMAP.md': text, 'nodes/E-1.md': text, ... }) -> {
//   roadmap: { frontmatter, mode, focus, max_depth, next_ids, sections },
//   systems, inventory, requirements: [row],  // one object per table row, keys from the header
//   questions: [{ name, type, mode, text, blocked_by, nodes, line }],
//   decisions: [{ name, text, line }],
//   nodes: { [id]: { id, file, level, parent, title, drill, satisfies, covers, depends_on, repo,
//                    ticket, status, size_swag, sources, sections, goal, criteria, frontmatter } },
//   batches: [{ file, n, state, frontmatter }],
//   errors: [string],
// }

import fs from 'node:fs'
import path from 'node:path'

const DRILLS = new Set(['open', 'split', 'leaf', 'parked'])
const BATCH_STATES = new Set(['proposed', 'approved', 'applied'])
const LEAF_SIZES = new Set(['XS', 'S', 'M'])
// Board statuses that mean nobody has started the work yet; anything else counts as started.
const NOT_STARTED = new Set(['', 'backlog', 'scoping', 'design', 'todo'])
// Node ids are a level letter and a counter: E-1, F-12, S-3, T-40.
const NODE_ID = /^[EFST]-\d+$/
const NODE_REF = /\b[EFST]-\d+\b/g
// A key we are willing to use on a plain object: no `__proto__` and friends.
const SAFE_KEY = /^[A-Za-z0-9][\w.-]*$/
// Past this many dependency cycles we stop looking; a roadmap with that many is already broken.
const MAX_CYCLES = 1000

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)
const str = (v) => (typeof v === 'string' ? v : '')
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : typeof v === 'string' && v !== '' ? [v] : [])
// Placeholder cells that mean "nothing here" in a table.
const isBlank = (s) => /^(|-+|—|–|none|n\/a)$/i.test(str(s).trim())
// A table cell holding ids: split on commas and spaces, placeholders dropped.
const cellIds = (s) => str(s).split(/[\s,]+/).filter((x) => !isBlank(x))
const statusOf = (s) => str(s).trim().toLowerCase().replace(/[\s-]+/g, '_')

// Sorts ids by level letter, then counter, then as plain text, so E-2 comes before E-10.
export function compareIds(a, b) {
  const ra = /^([A-Za-z]+)-(\d+)$/.exec(a)
  const rb = /^([A-Za-z]+)-(\d+)$/.exec(b)
  if (ra && rb) {
    const order = 'EFST'
    const pa = order.indexOf(ra[1]), pb = order.indexOf(rb[1])
    if (ra[1] !== rb[1]) return pa !== pb ? pa - pb : ra[1] < rb[1] ? -1 : 1
    return Number(ra[2]) - Number(rb[2])
  }
  if (ra) return -1
  if (rb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------------------------------------
// Frontmatter: the flat subset roadmap files use. Each key holds a plain or quoted scalar, a flow
// list (`[a, "b c"]`, possibly wrapped over lines) or a block list (`- a` lines under an empty
// key). Anything else is reported with its line number and skipped.

function unquote(s) {
  const t = s.trim()
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'")
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1')
  return t
}

// Cuts a ` # comment` off a plain value; a quoted value keeps its `#`.
function plain(s) {
  const t = s.trim()
  if (t[0] === '"' || t[0] === "'") {
    const close = t.indexOf(t[0], 1)
    return close === -1 ? t : t.slice(0, close + 1)
  }
  return t.replace(/(^|\s)#.*$/, '').trim()
}

// Splits the inside of a flow list on commas outside quotes. Returns null when the list is not
// closed or holds a nested collection, which this reader does not take.
function flowList(s) {
  const out = []
  let cur = ''
  let quote = ''
  let i = 1
  for (; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if ((ch === '"' || ch === "'") && cur.trim() === '') { quote = ch; cur += ch; continue }
    if (ch === '#' && /\s/.test(s[i - 1])) { while (i < s.length && s[i] !== '\n') i++; continue }
    if (ch === '[' || ch === '{') return null
    if (ch === ']') break
    if (ch === ',') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (i >= s.length) return null
  out.push(cur)
  const rest = s.slice(i + 1).trim()
  if (rest && !rest.startsWith('#')) return null
  return out.map(unquote).filter((x) => x !== '')
}

// Returns { frontmatter, body, bodyLine } where body is the lines after the closing `---` and
// bodyLine the file line number of body[0].
function splitFrontmatter(text, where, errors) {
  const all = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const fm = {}
  if (all[0] !== '---') {
    errors.push(`${where}: no frontmatter (first line is not ---)`)
    return { frontmatter: fm, body: all, bodyLine: 1 }
  }
  const end = all.indexOf('---', 1)
  if (end === -1) {
    errors.push(`${where}: frontmatter is not closed (no second --- line)`)
    return { frontmatter: fm, body: [], bodyLine: all.length + 1 }
  }
  const lines = all.slice(1, end)
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    const n = k + 2
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*)|\s*)$/.exec(line)
    if (!m) {
      errors.push(`${where}: frontmatter line ${n} is not under any key: ${line.trim()}`)
      continue
    }
    const key = m[1]
    if (own(fm, key)) errors.push(`${where}: frontmatter line ${n} repeats key ${key}`)
    let value = plain(m[2] || '')
    if (value === '') {
      // A block list: the `- x` lines that follow.
      const items = []
      while (k + 1 < lines.length && /^\s*-(\s|$)/.test(lines[k + 1])) {
        k++
        const item = unquote(plain(lines[k].replace(/^\s*-/, '')))
        if (item !== '') items.push(item)
      }
      fm[key] = items.length ? items : ''
    } else if (value[0] === '[') {
      let raw = (m[2] || '').trim()
      const start = n
      while (flowList(raw) === null && k + 1 < lines.length && /^\s+\S/.test(lines[k + 1]) && !/[\]]\s*(#.*)?$/.test(raw)) {
        raw += '\n' + lines[++k]
      }
      const parsed = flowList(raw)
      if (parsed === null) {
        errors.push(`${where}: frontmatter line ${start}: ${key} is not a closed flat [ ] list`)
        fm[key] = []
      } else fm[key] = parsed
    } else if (value[0] === '{') {
      errors.push(`${where}: frontmatter line ${n}: ${key} is a mapping, which roadmap files do not use`)
    } else {
      const q = value[0]
      if ((q === '"' || q === "'") && (value.length < 2 || value[value.length - 1] !== q)) {
        errors.push(`${where}: frontmatter line ${n}: ${key} has an unclosed quote`)
        value = value.slice(1)
      }
      fm[key] = unquote(value)
    }
  }
  return { frontmatter: fm, body: all.slice(end + 1), bodyLine: end + 2 }
}

// Splits body lines into `## ` sections, skipping fenced code. Returns [{ name, lines, line }].
function sectionsOf(body, bodyLine) {
  const out = []
  let cur = null
  let fenced = false
  body.forEach((text, k) => {
    if (/^\s*(```|~~~)/.test(text)) fenced = !fenced
    const m = !fenced && /^##\s+(.+?)\s*#*\s*$/.exec(text)
    if (m && !/^###/.test(text)) {
      cur = { name: m[1], lines: [], line: bodyLine + k }
      out.push(cur)
    } else if (cur) cur.lines.push({ text, n: bodyLine + k })
  })
  return out
}

const findSection = (sections, name) => sections.find((s) => s.name.toLowerCase() === name.toLowerCase())

// Splits a table row into cells; `\|` stays inside a cell.
function cells(row) {
  const t = row.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1')
  const out = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue }
    if (t[i] === '|') { out.push(cur.trim()); cur = ''; continue }
    cur += t[i]
  }
  out.push(cur.trim())
  return out
}

const headerKey = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

// Reads the first markdown table in a section into row objects keyed by the header.
function parseTable(section, where, errors) {
  if (!section) return []
  const rows = section.lines.filter((l) => l.text.trim().startsWith('|'))
  if (rows.length === 0) return []
  const header = cells(rows[0].text).map(headerKey)
  const out = []
  const seen = new Set()
  for (const row of rows.slice(1)) {
    const c = cells(row.text)
    if (c.every((x) => x === '' || /^:?-{2,}:?$/.test(x))) continue
    if (c.length !== header.length) {
      errors.push(`${where} line ${row.n}: ## ${section.name} row has ${c.length} cells, the header has ${header.length}`)
    }
    const record = {}
    header.forEach((key, i) => { if (key && SAFE_KEY.test(key)) record[key] = c[i] || '' })
    if (!record.id) errors.push(`${where} line ${row.n}: ## ${section.name} row has no id`)
    else if (seen.has(record.id)) errors.push(`${where} line ${row.n}: ## ${section.name} repeats id ${record.id}`)
    seen.add(record.id)
    out.push(record)
  }
  return out
}

// The top-level `- ` bullets of a section, each with its indented continuation lines joined on.
function bullets(section) {
  if (!section) return []
  const out = []
  for (const l of section.lines) {
    if (/^-\s+/.test(l.text)) out.push({ text: l.text.replace(/^-\s+/, '').trim(), n: l.n })
    else if (out.length && /^\s+\S/.test(l.text)) out[out.length - 1].text += ' ' + l.text.trim()
  }
  return out
}

// `- **<name>** — `type` · AFK|HITL — <question>. Blocked by: <name>|none`; the node ids the line
// names are the question's scope. Every line in Open questions is open: answered ones move to
// Decisions.
function parseQuestions(section, errors) {
  return bullets(section).map(({ text, n }) => {
    const m = /^\*\*(.+?)\*\*\s*[—–-]+\s*`?([\w-]+)`?\s*·\s*(AFK|HITL)\s*[—–-]+\s*(.*)$/.exec(text)
    if (!m) errors.push(`ROADMAP.md line ${n}: open question does not follow the question line format: ${text}`)
    const blocked = /Blocked by:\s*(.+?)\s*\.?$/i.exec(text)
    const named = m ? m[1] : (/^\*\*(.+?)\*\*/.exec(text) || [])[1] || ''
    return {
      name: named,
      type: m ? m[2] : '',
      mode: m ? m[3] : '',
      text: (m ? m[4] : text).replace(/\s*Blocked by:.*$/i, ''),
      blocked_by: blocked && !isBlank(blocked[1]) ? blocked[1] : '',
      nodes: [...new Set(text.match(NODE_REF) || [])],
      line: n,
    }
  })
}

// `- **<name>**: <gist> — <pointer>`.
function parseDecisions(section) {
  return bullets(section).map(({ text, n }) => {
    const m = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(text)
    return { name: m ? m[1].replace(/:$/, '') : '', text: m ? m[2] : text, line: n }
  })
}

function parseNodeFile(file, text, errors) {
  const { frontmatter: fm, body, bodyLine } = splitFrontmatter(text, file, errors)
  const sections = sectionsOf(body, bodyLine)
  if (fm.doc !== 'roadmap_node') errors.push(`${file}: doc is ${JSON.stringify(str(fm.doc))}, expected roadmap_node`)
  const id = str(fm.id).trim()
  const goal = findSection(sections, 'Goal')
  const criteria = findSection(sections, 'Acceptance criteria')
  const node = {
    id,
    file,
    level: str(fm.level),
    parent: str(fm.parent).trim(),
    title: str(fm.title),
    drill: str(fm.drill).trim(),
    satisfies: list(fm.satisfies),
    covers: list(fm.covers),
    depends_on: list(fm.depends_on),
    repo: Array.isArray(fm.repo) ? list(fm.repo) : str(fm.repo).trim(),
    ticket: str(fm.ticket),
    status: str(fm.status),
    size_swag: str(fm.size_swag).trim(),
    sources: list(fm.sources),
    sections: sections.map((s) => s.name),
    goal: Boolean(goal && goal.lines.some((l) => l.text.trim() !== '')),
    criteria: criteria ? criteria.lines.filter((l) => /^\s*[-*]\s+\[[ xX]\]\s+\S/.test(l.text)).length : 0,
    frontmatter: fm,
  }
  if (node.drill && !DRILLS.has(node.drill)) errors.push(`${file}: drill is ${JSON.stringify(node.drill)}, expected open|split|leaf|parked`)
  for (const key of ['satisfies', 'covers', 'depends_on', 'sources']) {
    if (own(fm, key) && fm[key] !== '' && !Array.isArray(fm[key])) errors.push(`${file}: ${key} is not a list`)
  }
  return node
}

// Reads a roadmap from a map of relative paths (forward slashes) to file text. Pure.
export function parseRoadmapFiles(files) {
  const result = {
    roadmap: { frontmatter: {}, mode: '', focus: '', max_depth: '', next_ids: [], sections: [] },
    systems: [],
    inventory: [],
    requirements: [],
    questions: [],
    decisions: [],
    nodes: {},
    batches: [],
    errors: [],
  }
  const errors = result.errors
  try {
    const all = files && typeof files === 'object' ? files : {}
    const text = all['ROADMAP.md']
    if (typeof text !== 'string') errors.push('ROADMAP.md is missing')
    else {
      const { frontmatter: fm, body, bodyLine } = splitFrontmatter(text, 'ROADMAP.md', errors)
      const sections = sectionsOf(body, bodyLine)
      if (fm.doc !== 'roadmap') errors.push(`ROADMAP.md: doc is ${JSON.stringify(str(fm.doc))}, expected roadmap`)
      const mode = str(fm.mode).trim()
      if (mode && mode !== 'bfs' && mode !== 'dfs') errors.push(`ROADMAP.md: mode is ${JSON.stringify(mode)}, expected bfs|dfs`)
      result.roadmap = {
        frontmatter: fm,
        mode,
        focus: str(fm.focus).trim(),
        max_depth: str(fm.max_depth).trim(),
        next_ids: list(fm.next_ids),
        sections: sections.map((s) => s.name),
      }
      result.systems = parseTable(findSection(sections, 'Systems'), 'ROADMAP.md', errors)
      result.inventory = parseTable(findSection(sections, 'Inventory'), 'ROADMAP.md', errors)
      result.requirements = parseTable(findSection(sections, 'Requirements'), 'ROADMAP.md', errors)
      result.questions = parseQuestions(findSection(sections, 'Open questions'), errors)
      result.decisions = parseDecisions(findSection(sections, 'Decisions'))
    }

    const nodeFiles = Object.keys(all).filter((p) => /^nodes\/[^/]+\.md$/.test(p))
    const parsed = []
    for (const file of nodeFiles) {
      if (typeof all[file] !== 'string') { errors.push(`${file}: not readable text`); continue }
      const node = parseNodeFile(file, all[file], errors)
      if (!node.id) { errors.push(`${file}: no id`); continue }
      if (!SAFE_KEY.test(node.id)) { errors.push(`${file}: id ${JSON.stringify(node.id)} is not usable`); continue }
      if (!NODE_ID.test(node.id)) errors.push(`${file}: id ${node.id} is not a level letter E|F|S|T and a counter`)
      if (path.posix.basename(file, '.md') !== node.id) errors.push(`${file}: id ${node.id} does not match the file name`)
      parsed.push(node)
    }
    parsed.sort((a, b) => compareIds(a.id, b.id) || (a.file < b.file ? -1 : 1))
    for (const node of parsed) {
      if (own(result.nodes, node.id)) errors.push(`${node.file}: duplicate id ${node.id} (also in ${result.nodes[node.id].file})`)
      else result.nodes[node.id] = node
    }

    const batchFiles = Object.keys(all).filter((p) => /^batches\/[^/]+\.md$/.test(p))
    for (const file of batchFiles) {
      if (typeof all[file] !== 'string') { errors.push(`${file}: not readable text`); continue }
      const { frontmatter: fm } = splitFrontmatter(all[file], file, errors)
      if (fm.doc !== 'roadmap_batch') errors.push(`${file}: doc is ${JSON.stringify(str(fm.doc))}, expected roadmap_batch`)
      const state = str(fm.state).trim()
      if (!BATCH_STATES.has(state)) errors.push(`${file}: state is ${JSON.stringify(state)}, expected proposed|approved|applied`)
      const num = /^(\d+)/.exec(path.posix.basename(file))
      result.batches.push({ file, n: num ? Number(num[1]) : null, state, frontmatter: fm })
    }
    result.batches.sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || (a.file < b.file ? -1 : 1))
  } catch (err) {
    errors.push(`unexpected parse failure: ${err && err.message ? err.message : String(err)}`)
  }
  return result
}

// Reads ROADMAP.md, nodes/*.md and batches/*.md under `dir`, then parses them. A file that cannot
// be read is an error; missing nodes/ or batches/ folders just mean none yet.
export function parseRoadmap(dir) {
  const files = {}
  const io = []
  const read = (rel) => {
    try {
      files[rel] = fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8')
    } catch (err) {
      if (rel === 'ROADMAP.md' && err && err.code === 'ENOENT') return
      io.push(`${rel}: cannot read (${err && err.code ? err.code : err && err.message})`)
    }
  }
  try {
    if (typeof dir !== 'string' || dir === '') {
      const empty = parseRoadmapFiles({})
      empty.errors.unshift('roadmap directory is not a path')
      return empty
    }
    read('ROADMAP.md')
    for (const sub of ['nodes', 'batches']) {
      let names = []
      try {
        names = fs.readdirSync(path.join(dir, sub))
      } catch (err) {
        if (!err || err.code !== 'ENOENT') io.push(`${sub}/: cannot list (${err && err.code ? err.code : err && err.message})`)
      }
      for (const name of names.filter((x) => x.endsWith('.md')).sort()) read(`${sub}/${name}`)
    }
  } catch (err) {
    io.push(`unexpected read failure: ${err && err.message ? err.message : String(err)}`)
  }
  const model = parseRoadmapFiles(files)
  model.errors.push(...io)
  return model
}

// ---------------------------------------------------------------------------------------------
// Graph questions. Each takes the model parseRoadmap returned and tolerates a broken one.

const nodesOf = (m) => (m && m.nodes && typeof m.nodes === 'object' ? m.nodes : {})
const idsOf = (m) => Object.keys(nodesOf(m)).sort(compareIds)
const nodeOf = (m, id) => (own(nodesOf(m), id) ? nodesOf(m)[id] : null)
const rows = (m, key) => (m && Array.isArray(m[key]) ? m[key].filter((r) => r && typeof r === 'object') : [])

// The ids whose parent is `id`, in id order.
export function children(model, id) {
  try {
    return idsOf(model).filter((c) => nodeOf(model, c).parent === id)
  } catch {
    return []
  }
}

// The parent chain of `id`, nearest first. Stops at an unknown parent or where a cycle repeats.
export function ancestors(model, id) {
  const out = []
  try {
    const seen = new Set([id])
    let cur = nodeOf(model, id) ? nodeOf(model, id).parent : ''
    while (nodeOf(model, cur) && !seen.has(cur)) {
      out.push(cur)
      seen.add(cur)
      cur = nodeOf(model, cur).parent
    }
  } catch { /* keep what we have */ }
  return out
}

// How far below a root `id` sits: an epic is 0. An unknown id is -1.
export function depth(model, id) {
  return nodeOf(model, id) ? ancestors(model, id).length : -1
}

// Every node under `id`, at any depth, in breadth-first then id order.
export function descendants(model, id) {
  const out = []
  try {
    const seen = new Set([id])
    const queue = [id]
    while (queue.length) {
      for (const c of children(model, queue.shift())) {
        if (seen.has(c)) continue
        seen.add(c)
        out.push(c)
        queue.push(c)
      }
    }
  } catch { /* keep what we have */ }
  return out
}

// Turns a cycle so its smallest id comes first, then closes it: [b, c, a] -> [a, b, c, a].
function closeCycle(cycle) {
  let at = 0
  cycle.forEach((x, i) => { if (compareIds(x, cycle[at]) < 0) at = i })
  const turned = [...cycle.slice(at), ...cycle.slice(0, at)]
  return [...turned, turned[0]]
}

// Every parent cycle and every depends_on cycle as { kind: 'parent'|'depends_on', path }, where
// path starts at the cycle's smallest id and ends where it started: ['T-1', 'T-2', 'T-1'].
// Dependency cycles are all the elementary cycles, each once; the search stops after MAX_CYCLES.
export function findCycles(model) {
  const out = []
  try {
    const ids = idsOf(model)
    // Parent: each node has at most one parent, so walking up from every node finds every loop.
    const done = new Set()
    for (const start of ids) {
      const pathIds = []
      const at = new Map()
      let cur = start
      while (nodeOf(model, cur) && !done.has(cur) && !at.has(cur)) {
        at.set(cur, pathIds.length)
        pathIds.push(cur)
        cur = nodeOf(model, cur).parent
      }
      if (at.has(cur)) out.push({ kind: 'parent', path: closeCycle(pathIds.slice(at.get(cur))) })
      for (const x of pathIds) done.add(x)
    }
    // depends_on: from each start, search only through later ids, so each cycle is found once,
    // from its smallest id.
    const index = new Map(ids.map((x, i) => [x, i]))
    const next = new Map(ids.map((x) => [x, [...new Set(nodeOf(model, x).depends_on)].filter((d) => index.has(d)).sort(compareIds)]))
    let found = 0
    for (let s = 0; s < ids.length && found < MAX_CYCLES; s++) {
      const start = ids[s]
      const stack = [{ id: start, k: 0 }]
      const onPath = new Set([start])
      while (stack.length && found < MAX_CYCLES) {
        const top = stack[stack.length - 1]
        const outs = next.get(top.id)
        if (top.k >= outs.length) {
          onPath.delete(top.id)
          stack.pop()
          continue
        }
        const d = outs[top.k++]
        if (d === start) {
          out.push({ kind: 'depends_on', path: [...stack.map((f) => f.id), start] })
          found++
        } else if (index.get(d) > s && !onPath.has(d)) {
          onPath.add(d)
          stack.push({ id: d, k: 0 })
        }
      }
    }
  } catch { /* keep what we have */ }
  return out
}

// Every reference to an id that does not exist, as { node, field, ref }: parent and depends_on
// must name nodes, satisfies a requirement row, covers an inventory row.
export function danglingRefs(model) {
  const out = []
  try {
    const reqs = new Set(rows(model, 'requirements').map((r) => r.id))
    const inv = new Set(rows(model, 'inventory').map((r) => r.id))
    for (const id of idsOf(model)) {
      const n = nodeOf(model, id)
      if (n.parent && !nodeOf(model, n.parent)) out.push({ node: id, field: 'parent', ref: n.parent })
      for (const d of n.depends_on) if (!nodeOf(model, d)) out.push({ node: id, field: 'depends_on', ref: d })
      for (const r of n.satisfies) if (!reqs.has(r)) out.push({ node: id, field: 'satisfies', ref: r })
      for (const c of n.covers) if (!inv.has(c)) out.push({ node: id, field: 'covers', ref: c })
    }
  } catch { /* keep what we have */ }
  return out
}

// The open questions whose line names `id` or one of its ancestors.
export function openQuestionsFor(model, id) {
  try {
    const scope = new Set([id, ...ancestors(model, id)])
    return rows(model, 'questions').filter((q) => Array.isArray(q.nodes) && q.nodes.some((x) => scope.has(x)))
  } catch {
    return []
  }
}

// What still keeps `id` from being a ready leaf, as [{ rule, message }]; empty means ready.
// Rules: goal, criteria, repo, trace, size, question, brief.
export function leafReadiness(model, id) {
  const n = nodeOf(model, id)
  if (!n) return [{ rule: 'node', message: `unknown node ${id}` }]
  const out = []
  try {
    if (!n.goal) out.push({ rule: 'goal', message: 'no ## Goal with text' })
    if (!(n.criteria >= 1)) out.push({ rule: 'criteria', message: 'no acceptance checkbox under ## Acceptance criteria' })
    const repos = Array.isArray(n.repo) ? n.repo : str(n.repo).split(/[\s,]+/).filter(Boolean)
    if (repos.length !== 1) out.push({ rule: 'repo', message: repos.length ? `${repos.length} repos, needs exactly one` : 'no repo' })
    if (list(n.satisfies).length === 0 && list(n.covers).length === 0) out.push({ rule: 'trace', message: 'satisfies and covers are both empty' })
    if (!LEAF_SIZES.has(str(n.size_swag))) out.push({ rule: 'size', message: `size_swag is ${JSON.stringify(str(n.size_swag))}, needs XS|S|M` })
    const qs = openQuestionsFor(model, id)
    if (qs.length) out.push({ rule: 'question', message: `open question on it or an ancestor: ${qs.map((q) => q.name || `line ${q.line}`).join(', ')}` })
    if (list(n.sources).length === 0) out.push({ rule: 'brief', message: 'no source brief' })
  } catch { /* keep what we have */ }
  return out
}

// The next drill batch. bfs: the `drill: open` nodes at the shallowest depth that has any, in id
// order. dfs: the `drill: open` nodes under `focus` (focus included; no focus means every node),
// deepest first. At most `limit` nodes. Mode and focus default to the ones saved in ROADMAP.md.
// Open nodes with an open question on them or an ancestor, and nodes marked `drill: parked`, are
// never drilled; they come back in `parked`, in id order and unlimited.
// Returns { mode, focus, nodes, parked, errors }.
export function frontier(model, opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const saved = model && model.roadmap ? model.roadmap : {}
  const mode = str(o.mode) || str(saved.mode) || 'bfs'
  const focus = o.focus !== undefined ? str(o.focus) : str(saved.focus)
  const limit = Number.isInteger(o.limit) && o.limit > 0 ? o.limit : 7
  const result = { mode, focus, nodes: [], parked: [], errors: [] }
  try {
    if (mode !== 'bfs' && mode !== 'dfs') {
      result.errors.push(`unknown mode ${JSON.stringify(mode)}, expected bfs|dfs`)
      return result
    }
    let scope = idsOf(model)
    if (mode === 'dfs' && focus) {
      if (!nodeOf(model, focus)) {
        result.errors.push(`unknown focus ${focus}`)
        return result
      }
      const under = new Set([focus, ...descendants(model, focus)])
      scope = scope.filter((x) => under.has(x))
    }
    const ready = []
    for (const id of scope) {
      const n = nodeOf(model, id)
      if (n.drill === 'parked') result.parked.push(id)
      else if (n.drill === 'open') {
        if (openQuestionsFor(model, id).length) result.parked.push(id)
        else ready.push({ id, d: depth(model, id) })
      }
    }
    if (mode === 'bfs') {
      const shallowest = Math.min(...ready.map((r) => r.d))
      result.nodes = ready.filter((r) => r.d === shallowest).map((r) => r.id)
    } else {
      result.nodes = ready.sort((a, b) => b.d - a.d || compareIds(a.id, b.id)).map((r) => r.id)
    }
    result.nodes = result.nodes.slice(0, limit)
  } catch (err) {
    result.errors.push(`unexpected failure: ${err && err.message ? err.message : String(err)}`)
  }
  return result
}

// Traceability gaps and derived status:
//   uncoveredInventory       inventory ids no node covers (covers, or the row's covered by
//                            column naming a real node) and no exclusion names
//   unsatisfiedRequirements  accepted requirement ids no `drill: leaf` node satisfies
//   untracedLeaves           leaf ids with neither satisfies nor covers
//   parentStatus             { id: status } for every node with children: all children done ->
//                            done; any blocked -> blocked; any started -> in_progress; else backlog.
//                            A child with children of its own counts with its derived status.
//   requirementStatus        { id: 'met'|'unmet' }: met when it has satisfying leaves and every
//                            one is done
export function coverage(model) {
  const result = { uncoveredInventory: [], unsatisfiedRequirements: [], untracedLeaves: [], parentStatus: {}, requirementStatus: {} }
  try {
    const ids = idsOf(model)
    const leaves = ids.filter((id) => nodeOf(model, id).drill === 'leaf')
    const covered = new Set(ids.flatMap((id) => nodeOf(model, id).covers))
    for (const row of rows(model, 'inventory')) {
      if (!row.id) continue
      const byColumn = cellIds(row.covered_by).some((x) => nodeOf(model, x))
      const gap = !covered.has(row.id) && !byColumn && isBlank(row.excluded_by)
      if (gap && !result.uncoveredInventory.includes(row.id)) result.uncoveredInventory.push(row.id)
    }
    for (const req of rows(model, 'requirements')) {
      if (!req.id || !SAFE_KEY.test(req.id)) continue
      const by = leaves.filter((id) => nodeOf(model, id).satisfies.includes(req.id))
      if (by.length === 0 && statusOf(req.status) === 'accepted') result.unsatisfiedRequirements.push(req.id)
      result.requirementStatus[req.id] = by.length > 0 && by.every((id) => statusOf(nodeOf(model, id).status) === 'done') ? 'met' : 'unmet'
    }
    result.untracedLeaves = leaves.filter((id) => nodeOf(model, id).satisfies.length === 0 && nodeOf(model, id).covers.length === 0)

    const memo = new Map()
    const visiting = new Set()
    const effective = (id) => {
      const kids = children(model, id)
      if (kids.length === 0 || visiting.has(id)) return statusOf(nodeOf(model, id).status)
      if (memo.has(id)) return memo.get(id)
      visiting.add(id)
      const st = kids.map(effective)
      visiting.delete(id)
      const derived = st.every((s) => s === 'done') ? 'done'
        : st.some((s) => s === 'blocked') ? 'blocked'
          : st.some((s) => !NOT_STARTED.has(s)) ? 'in_progress'
            : 'backlog'
      memo.set(id, derived)
      return derived
    }
    for (const id of ids) if (children(model, id).length) result.parentStatus[id] = effective(id)
  } catch { /* keep what we have */ }
  return result
}
