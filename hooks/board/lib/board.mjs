// Turns the board config and ticket files into lanes of tickets. Pure functions over strings:
// the caller reads the files, this module only parses and sorts, so it runs anywhere JS does.

// The six lanes the pane shows, left to right, and which ticket statuses land in each.
export const LANES = [
  { key: 'backlog', title: 'BACKLOG', statuses: ['backlog', 'scoping', 'design'] },
  { key: 'todo', title: 'TODO', statuses: ['todo'] },
  { key: 'in_progress', title: 'COOKING', statuses: ['in_progress'] },
  { key: 'in_review', title: 'IN REVIEW', statuses: ['in_review'] },
  { key: 'blocked', title: 'BLOCKED', statuses: ['blocked'] },
  { key: 'done', title: 'DONE', statuses: ['done'] },
]

// Splits text into lines, tolerating Windows line endings.
function linesOf(text) {
  return String(text ?? '').split(/\r?\n/)
}

// Drops a trailing `# comment` (a `#` at the start or after whitespace) and trims what is left.
function stripComment(value) {
  return value.replace(/(^|\s)#.*$/, '').trim()
}

// The value of a config bullet like `- source: obsidian   # note`, or null when the line is absent.
function configValue(configText, key) {
  const pattern = new RegExp('^\\s*-\\s*' + key + '\\s*:(.*)$')
  for (const line of linesOf(configText)) {
    const match = line.match(pattern)
    if (match) return stripComment(match[1])
  }
  return null
}

// The board folder named by `.brigade/config.md`, or null when the config names no usable
// folder or the board source is something other than obsidian or local.
export function boardDirFrom(configText) {
  const source = (configValue(configText, 'source') || '').toLowerCase()
  if (source !== 'obsidian' && source !== 'local') return null
  const dir = configValue(configText, 'database_id')
  return dir ? dir : null
}

// Reads a quoted value that starts at raw[0]. Returns the unquoted text, or null when the
// closing quote is missing. Double quotes honour backslash escapes; single quotes use YAML's
// doubled-quote escape ('it''s').
function unquote(raw) {
  const quote = raw[0]
  let out = ''
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i]
    if (quote === '"' && ch === '\\' && i + 1 < raw.length) {
      const next = raw[++i]
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next
    } else if (quote === "'" && ch === "'" && raw[i + 1] === "'") {
      out += "'"
      i++
    } else if (ch === quote) {
      return out
    } else {
      out += ch
    }
  }
  return null
}

// One frontmatter value: quoted values are kept whole, unquoted ones lose a trailing comment.
function scalar(raw) {
  const value = raw.trim()
  if (value[0] === '"' || value[0] === "'") {
    const inner = unquote(value)
    if (inner !== null) return inner
  }
  return stripComment(value)
}

// The top-level `key: value` pairs of a frontmatter block, or null when there is no block.
// Indented lines (nested YAML) and list items are skipped; a key splits on its first colon only.
function frontmatter(text) {
  const lines = linesOf(text)
  if (lines[0].replace(/^﻿/, '').trimEnd() !== '---') return null
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  if (end === -1) return null
  const fields = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/)
    if (match) fields[match[1]] = scalar(match[2] ?? '')
  }
  return fields
}

// One ticket from a markdown file, or null when the file is not a ticket (an underscore file like
// `_board.md`, a non-markdown file, or text without frontmatter). Missing fields come back as ''.
export function parseTicket(text, fileName) {
  const name = String(fileName ?? '')
  if (name.startsWith('_') || !name.endsWith('.md')) return null
  const fields = frontmatter(text)
  if (!fields) return null
  const field = (key) => (typeof fields[key] === 'string' ? fields[key] : '')
  const id = field('id') || name.slice(0, -'.md'.length)
  return {
    id,
    title: field('title') || id,
    status: field('status'),
    kind: field('kind'),
    assignee: field('assignee'),
    worker: field('worker'),
  }
}

// The lane key a status belongs to. Anything the lanes do not list, including '', is backlog.
export function laneOf(status) {
  const lane = LANES.find((l) => l.statuses.includes(status))
  return lane ? lane.key : 'backlog'
}

// Compares ids as plain strings so the order is the same on every machine.
function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// All six lanes in order, each with its full ticket count and up to `perLane` tickets to show.
// Pinned tickets (say, the ones an agent is working) always show and come first, even past the cap.
export function toLanes(tickets, perLane = 6, pinned = []) {
  const pins = new Set(pinned)
  return LANES.map((lane) => {
    const mine = (tickets || []).filter((t) => t && laneOf(t.status) === lane.key)
    const first = mine.filter((t) => pins.has(t.id)).sort(byId)
    const rest = mine.filter((t) => !pins.has(t.id)).sort(byId)
    const room = Math.max(0, perLane - first.length)
    return {
      key: lane.key,
      title: lane.title,
      total: mine.length,
      tickets: first.concat(rest.slice(0, room)),
    }
  })
}
