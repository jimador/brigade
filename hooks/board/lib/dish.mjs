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

// One board note for an artifact, or null when the file doesn't say what kind of doc it is.
export function noteFrom(text, mtimeMs) {
  const env = envelope(text)
  const kind = env.doc
  if (!kind) return null
  return {
    at: mtimeMs,
    dish: env.dish ?? '',
    item: env.item ?? '',
    role: env.role ?? '',
    kind,
    gist: gistFor(kind, env),
  }
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
