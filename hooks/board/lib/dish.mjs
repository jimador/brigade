// Turns what agents leave on disk (plans, reports, verdicts, briefs, ledgers) into short notes
// the board can list. Pure text in, plain objects out: no file reading happens here.

// Pulls the lines between the opening `---` and the next `---`, or null when there is no
// frontmatter at the top of the text.
function frontmatterLines(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end === -1) return null
  return lines.slice(1, end)
}

// Drops one pair of matching quotes around a value, if it has them.
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) return value.slice(1, -1)
  }
  return value
}

// The top-level `key: value` pairs of the frontmatter as strings. Nested lines (indented or
// list items) and keys without a value are left out. Values can hold colons of their own:
// only the first `: ` splits the line.
export function envelope(text) {
  const lines = frontmatterLines(text)
  const out = {}
  if (!lines) return out
  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('-')) continue
    const at = line.indexOf(': ')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = unquote(line.slice(at + 2).trim())
    if (!key || value === '') continue
    out[key] = value
  }
  return out
}

// The dish, its ticket, and each item's slug and status from a PLAN.md.
export function planInfo(text) {
  const env = envelope(text)
  const items = []
  const itemLine = /^\s*-\s*\{\s*slug:\s*([^,}\s]+)\s*,\s*status:\s*([^,}\s]+)/
  for (const line of frontmatterLines(text) ?? []) {
    const match = itemLine.exec(line)
    if (match) items.push({ slug: match[1], status: match[2] })
  }
  return { dish: env.dish ?? '', ticket: env.ticket ?? '', items }
}

// What each kind of artifact says in one glance.
function gistFor(kind, env) {
  if (kind === 'report') return env.status ?? ''
  if (kind === 'verdict') return env.verdict ?? ''
  if (kind === 'brief') return 'confidence ' + (env.confidence ?? '')
  if (kind === 'ledger') return 'memory updated'
  return ''
}

// A count from a frontmatter value: a plain run of digits, or null for anything else.
function wholeNumber(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

// How many lines a caller asked for: a whole number, never negative, or the fallback when the
// request isn't a number at all.
function capOf(limit, fallback) {
  const n = Math.floor(Number(limit))
  return Number.isFinite(n) ? Math.max(0, n) : fallback
}

// The fields of one `{ key: value, ... }` flow mapping in `text`. Quoted values keep their commas
// and colons and lose their quotes. Reading stops at the closing `}` or the end of the text, and
// walks each character once, so a hostile line costs no more than its length.
function flowFields(text) {
  const fields = Object.create(null)
  const n = text.length
  let i = text.indexOf('{')
  if (i === -1) return fields
  i += 1
  while (i < n) {
    const keyStart = i
    while (i < n && text[i] !== ':' && text[i] !== ',' && text[i] !== '}') i++
    if (i >= n || text[i] === '}') break
    if (text[i] === ',') {
      i++
      continue
    }
    const key = text.slice(keyStart, i).trim()
    i++
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++
    let value
    if (text[i] === '"' || text[i] === "'") {
      const close = text.indexOf(text[i], i + 1)
      const end = close === -1 ? n : close
      value = text.slice(i + 1, end)
      i = end + 1
      while (i < n && text[i] !== ',' && text[i] !== '}') i++
    } else {
      const valueStart = i
      while (i < n && text[i] !== ',' && text[i] !== '}') i++
      value = text.slice(valueStart, i).trim()
    }
    if (key) fields[key] = value
    if (i < n && text[i] === '}') break
    i++
  }
  return fields
}

// One finding from its joined `- { id: ... }` text, or null when it has no id.
function findingFrom(entry) {
  const fields = flowFields(entry)
  if (fields.id === undefined) return null
  return { id: fields.id, severity: fields.severity ?? '', summary: fields.summary ?? '' }
}

// The findings under a top-level `findings:` key, in one pass over the frontmatter lines. Each
// entry starts at a `- {` line; the indented lines after it are the same entry wrapped, so they
// get joined on before the entry is read.
function findingsIn(lines) {
  const found = []
  let inList = false
  let entry = null
  const finish = () => {
    if (entry) {
      const finding = findingFrom(entry.join(' '))
      if (finding) found.push(finding)
    }
    entry = null
  }
  for (const line of lines) {
    const topLevel = line !== '' && !/^[\s-]/.test(line)
    if (topLevel) {
      finish()
      inList = line.trimEnd() === 'findings:'
      continue
    }
    if (!inList) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('-')) {
      finish()
      if (trimmed.slice(1).trimStart().startsWith('{')) entry = [trimmed]
    } else if (entry && trimmed) {
      entry.push(trimmed)
    }
  }
  finish()
  return found
}

// Every finding a verdict's frontmatter lists, in order, as { id, severity, summary }.
export function findingsOf(text) {
  return findingsIn(frontmatterLines(text) ?? [])
}

// How many items a flow list like `[a, "b, c"]` holds. Commas inside quotes or nested brackets
// don't split it.
function flowCount(value) {
  let count = 0
  let filled = false
  let quote = null
  let depth = 0
  for (let i = 1; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '{') depth++
    else if ((ch === ']' || ch === '}') && depth > 0) depth--
    else if (ch === ']') break
    else if (ch === ',' && depth === 0) {
      if (filled) count++
      filled = false
      continue
    }
    if (ch !== ' ' && ch !== '\t') filled = true
  }
  return filled ? count + 1 : count
}

// How many blocking items a plan check names: `blocking:` holds either a number or a list, with
// one `- ` entry per item on the lines below it (an entry's wrapped lines sit further in). Null
// when the key is missing or holds something that is neither.
function blockingIn(lines) {
  let count = null
  let indent = -1
  for (const line of lines) {
    if (count === null) {
      if (!line.startsWith('blocking:')) continue
      const value = line.slice('blocking:'.length).trim()
      if (value.startsWith('[')) return flowCount(value)
      if (value !== '') return wholeNumber(value)
      count = 0
      continue
    }
    const rest = line.trimStart()
    if (rest === '') continue
    const pad = line.length - rest.length
    const isEntry = rest === '-' || rest.startsWith('- ')
    if (indent === -1) {
      if (!isEntry) break
      indent = pad
    } else if (pad > indent) {
      continue
    } else if (pad < indent || !isEntry) {
      break
    }
    count++
  }
  return count
}

// The attempt a report or verdict is about, 1 when it doesn't say.
function attemptOf(env) {
  return wholeNumber(env.attempt ?? env.attempt_reviewed) ?? 1
}

// One board note for an artifact, or null when the file doesn't say what kind of doc it is.
// `file` is where the artifact sits, relative to the dish folder, so a message can point at it.
// For a plan check `findings` is its blocking count, or null when it doesn't list one.
export function noteFrom(text, mtimeMs, file = null) {
  const env = envelope(text)
  const kind = env.doc
  if (!kind) return null
  const lines = frontmatterLines(text) ?? []
  const found = kind === 'plan_check' ? [] : findingsIn(lines)
  let summary = ''
  if (kind === 'verdict') summary = found.length > 0 ? found[0].summary : ''
  else if (kind === 'brief') summary = env.question ?? ''
  return {
    at: mtimeMs,
    dish: env.dish ?? '',
    item: env.item ?? '',
    role: env.role ?? '',
    kind,
    gist: gistFor(kind, env),
    findings: kind === 'plan_check' ? blockingIn(lines) : found.length,
    summary,
    attempt: attemptOf(env),
    file,
  }
}

const COOK_ROLES = new Set(['cook', 'heavy'])
const INSPECTOR_ROLES = new Set(['inspector'])

// A string field of something agents wrote, or '' when it isn't a string.
function textOf(value) {
  return typeof value === 'string' ? value : ''
}

// The roster name of the one agent in `roles` working on `item`. With none, or more than one,
// we can't tell who it was, so the role word stands in.
function nameFor(agents, roles, item, word) {
  if (!item) return word
  let match = null
  let matches = 0
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object' || !roles.has(agent.role) || agent.item !== item) continue
    match = agent
    matches++
  }
  return matches === 1 && typeof match.name === 'string' && match.name ? match.name : word
}

// The message one note stands for, or null when its kind and gist don't say anything to anyone.
function messageFor(note, agents) {
  const kind = textOf(note.kind)
  const gist = textOf(note.gist)
  const item = textOf(note.item)
  const summary = textOf(note.summary)
  const count = Number.isSafeInteger(note.findings) && note.findings >= 0 ? note.findings : null
  const label = item || textOf(note.dish) || 'item'
  let from
  let to
  let said
  if (kind === 'report' && gist === 'done') {
    from = nameFor(agents, COOK_ROLES, item, 'cook')
    to = 'inspector'
    said = `${label} ready for review`
  } else if (kind === 'report' && gist === 'blocked') {
    from = nameFor(agents, COOK_ROLES, item, 'cook')
    to = 'planner'
    said = `${label} is blocked`
  } else if (kind === 'verdict' && gist === 'FAIL') {
    from = nameFor(agents, INSPECTOR_ROLES, item, 'inspector')
    to = nameFor(agents, COOK_ROLES, item, 'cook')
    const more = count !== null && count > 1 ? ` (+${count - 1} more)` : ''
    said = summary ? `${label} sent back: ${summary}${more}` : `${label} sent back`
  } else if (kind === 'verdict' && gist === 'PASS') {
    from = nameFor(agents, INSPECTOR_ROLES, item, 'inspector')
    to = 'planner'
    const notes = count !== null && count > 0 ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : ''
    said = `${label} passed review${notes}`
  } else if (kind === 'brief') {
    from = 'scout'
    to = 'planner'
    said = summary ? `answered: ${summary}` : 'brief written'
  } else if (kind === 'plan_check') {
    from = 'inspector'
    to = 'planner'
    said = count === null ? 'plan check written' : `plan check: ${count} blocking`
  } else {
    return null
  }
  const at = Number.isFinite(note.at) ? note.at : 0
  const file = typeof note.file === 'string' && note.file ? note.file : null
  return {
    id: `${kind}:${textOf(note.dish)}:${item}:${at}:${file ?? ''}`,
    at,
    from,
    to,
    item,
    text: said,
    file,
  }
}

// The notes as messages between agents, newest first, at most `limit`. `agents` is the roster;
// a sender or receiver gets a name only when the roster pins it to exactly one agent.
export function messagesFrom(notes, agents, limit = 20) {
  const roster = Array.isArray(agents) ? agents : []
  const messages = []
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note || typeof note !== 'object') continue
    const message = messageFor(note, roster)
    if (message) messages.push(message)
  }
  return latest(messages, capOf(limit, 20))
}

const DATED = /^\d{4}-\d{2}-\d{2}/

// The repo's learnings from a LEARNINGS.md, newest first, at most `limit` lines; `total` counts
// them all. A `## ` heading is one learning, unless it starts with a date: then it's a retro
// section, and each of its top-level `- ` bullets is one learning, cut at its first sentence.
export function learningsFrom(text, limit = 5) {
  const all = []
  let dated = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim()
      dated = DATED.test(heading)
      if (!dated && heading) all.push(heading)
      continue
    }
    if (!dated || !line.startsWith('- ')) continue
    const bullet = line.slice(2)
    const stop = bullet.indexOf('. ')
    const learning = (stop === -1 ? bullet : bullet.slice(0, stop)).trim()
    if (learning) all.push(learning)
  }
  const cap = capOf(limit, 5)
  return { total: all.length, lines: cap === 0 ? [] : all.slice(-cap).reverse() }
}

// The newest `limit` notes, newest first. Array sort is stable, so equal times keep their order.
export function latest(notes, limit) {
  return [...(notes ?? [])].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit))
}

// The last `limit` live lines of a ledger's `## World state` section. Struck-through units
// (anything with `~~`) are dead and get skipped; the section ends at the next `## ` heading.
export function ledgerTail(text, limit) {
  const live = []
  let inWorld = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inWorld = line.trim() === '## World state'
      continue
    }
    if (!inWorld) continue
    if (!/^W\d+\./.test(line) || line.includes('~~')) continue
    live.push(line)
  }
  if (limit <= 0) return []
  return live.slice(-limit)
}
