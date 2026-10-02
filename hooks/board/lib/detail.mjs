// The words on the board's header and in the detail box that opens when you
// click a card, an agent or a message. Pure functions: plain data in, plain
// data out, so the live board and the README demo always say the same thing.
//
// Every value here comes from files or tool calls, so nothing is trusted: any
// field can be missing or the wrong type, and every line is cleaned and cut
// before it leaves.

import { safeText } from './canvas.mjs'
import { kTokens, elapsed } from './stage.mjs'

const MAX_LINES = 40
const MAX_CHARS = 200
const MAX_FILES = 6
const MAX_MEMORY = 8
const MAX_BODY = 12

// A plain object to read fields from, or an empty one when it isn't.
function obj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

// A list to walk, or an empty one when it isn't.
function list(v) {
  return Array.isArray(v) ? v : []
}

// Text from a field: strings as they are, real numbers written out, anything else empty.
function str(v) {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

// A count that can be shown: a whole number zero or above, else zero.
function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// One safe line: control characters become spaces, invisible marks go, and it
// stops at 200 characters without splitting an emoji in half.
function clean(v) {
  const text = safeText(str(v))
  if (text.length <= MAX_CHARS) return text
  let out = ''
  for (const ch of text) {
    if (out.length + ch.length > MAX_CHARS) break
    out += ch
  }
  return out
}

// The finished detail: every line cleaned and cut, and a long list ends with '…'.
function finish(kind, id, title, lines) {
  let out = lines.map(clean)
  if (out.length > MAX_LINES) out = [...out.slice(0, MAX_LINES - 1), '…']
  return { kind, id: clean(id), title: clean(title), lines: out }
}

// 'F1 (blocking) Refill uses wall-clock time', leaving out whatever is missing.
// A finding with nothing to say gives no line at all.
function findingLines(findings) {
  const out = []
  for (const raw of list(findings)) {
    const f = obj(raw)
    const severity = str(f.severity).toLowerCase()
    const parts = [str(f.id), severity && `(${severity})`, str(f.summary)].filter(Boolean)
    if (parts.length) out.push(parts.join(' '))
  }
  return out
}

// 'done, attempt 2' for a report or verdict note.
function noteGist(note) {
  const gist = str(note.gist) || 'filed'
  return isNum(note.attempt) ? `${gist}, attempt ${note.attempt}` : gist
}

// Non-empty strings only, for lists of names and paths.
function names(v) {
  return list(v).map(str).filter(Boolean)
}

// Stars for each service tier. The header shows these instead of the tier's name.
const EFFORT = { 'one-star': '★', 'two-star': '★★', 'three-star': '★★★' }

// 'Effort: ★★' for a known tier, or nothing for anything else.
function effortOf(tier) {
  const stars = Object.hasOwn(EFFORT, tier) ? EFFORT[tier] : ''
  return stars && `Effort: ${stars}`
}

// The header's project line. Anything other than a dish reads as the ticket board.
export function projectOf(input) {
  const src = obj(input)
  const repo = clean(src.repo)
  if (src.mode !== 'dish') {
    const n = count(src.count)
    return { mode: 'tickets', repo, branch: null, title: 'Ticket board', detail: `${n} ${n === 1 ? 'ticket' : 'tickets'}` }
  }
  const plan = obj(src.plan)
  const ticket = obj(src.ticket)
  const progress = isNum(src.total) ? `${count(src.done)} of ${count(src.total)} done` : ''
  const detail = [str(plan.ticket), str(ticket.kind) || str(plan.kind), progress, effortOf(plan.tier)]
    .filter(Boolean)
    .join(' · ')
  return {
    mode: 'dish',
    repo,
    branch: clean(plan.branch) || null,
    title: clean(str(ticket.title) || str(plan.ticket) || 'Untitled'),
    detail: clean(detail),
  }
}

// A work item's detail: what it is for, what it touches, how it has gone so far, and who has it.
export function cardDetail(input) {
  const src = obj(input)
  const item = obj(src.item)
  const slug = str(item.slug)
  const title = [slug, str(src.phaseTitle)].filter(Boolean).join(' · ') || 'Work item'
  const lines = [str(item.goal) || 'No description.']

  const files = names(item.files)
  if (files.length) {
    const shown = files.slice(0, MAX_FILES)
    if (files.length > MAX_FILES) shown.push(`+${files.length - MAX_FILES} more`)
    lines.push(`Files: ${shown.join(', ')}`)
  }
  const deps = names(item.dependsOn)
  if (deps.length) lines.push(`Depends on: ${deps.join(', ')}`)
  lines.push(`Attempts: ${count(item.attempts)}`)

  if (src.report != null && typeof src.report === 'object') lines.push(`Cook report: ${noteGist(src.report)}`)
  if (src.verdict != null && typeof src.verdict === 'object') {
    lines.push(`Review: ${noteGist(src.verdict)}`, ...findingLines(src.findings))
  }

  for (const raw of list(src.agents)) {
    const a = obj(raw)
    const parts = [str(a.name), str(a.role), str(a.activity) || str(a.state)].filter(Boolean)
    if (parts.length) lines.push(`Working it: ${parts.join(' · ')}`)
  }
  return finish('card', slug, title, lines)
}

// A board ticket's detail, for when no dish is running and the lanes hold tickets.
export function ticketDetail(input) {
  const src = obj(input)
  const t = obj(src.ticket)
  const id = str(t.id)
  const title = [id, str(t.status)].filter(Boolean).join(' · ') || 'Ticket'
  const lines = [str(t.title) || 'No title.']
  if (str(t.kind)) lines.push(`Kind: ${str(t.kind)}`)
  if (str(t.assignee)) lines.push(`Assignee: ${str(t.assignee)}`)
  if (str(src.goal)) lines.push(str(src.goal))
  return finish('card', id, title, lines)
}

// An agent's detail. The clock stops at endedAt once it's finished, and an
// agent with no start time reads 0s rather than the age of the epoch.
export function agentDetail(input) {
  const src = obj(input)
  const a = obj(src.agent)
  const name = str(a.name)
  const role = str(src.roleLabel) || str(a.role)
  const title = [name, role].filter(Boolean).join(' · ') || 'Agent'
  const end = isNum(a.endedAt) ? a.endedAt : src.now
  const running = isNum(a.startedAt) && isNum(end) ? elapsed(end - a.startedAt) : '0s'
  const lines = [
    `Model: ${str(a.model) || 'unknown'}`,
    `Working: ${str(a.item) || str(a.ticket) || 'nothing yet'}`,
    `Now: ${str(a.activity) || str(a.state) || 'unknown'}`,
    `Tokens: ${kTokens(a.tokens)}`,
    `Running: ${running}`,
  ]
  // Memory is the tail of the agent's ledger, newest last, so the last lines are the ones to keep.
  const memory = list(src.memory).filter((l) => typeof l === 'string')
  if (memory.length) lines.push('', 'Working memory', ...memory.slice(-MAX_MEMORY))
  return finish('agent', a.id, title, lines)
}

// A message's detail: what it says, what it is about, and the start of the file it came from.
export function messageDetail(input) {
  const src = obj(input)
  const m = obj(src.message)
  const title = `${str(m.from) || '?'} → ${str(m.to) || '?'}`
  const lines = [str(m.text) || 'No text.']
  if (str(m.item)) lines.push(`About: ${str(m.item)}`)
  if (str(m.file)) lines.push(`From file: ${str(m.file)}`)
  lines.push(...findingLines(src.findings))
  // Blank lines in the file are kept: they are part of how it reads.
  const body = list(src.body).filter((l) => typeof l === 'string')
  if (body.length) lines.push('', ...body.slice(0, MAX_BODY))
  return finish('message', m.id, title, lines)
}
