#!/usr/bin/env node
// PostToolUse hook (matcher "*"): warns a running brigade subagent as it nears its maxTurns.
//
// Counts tool calls per agent_id. Tool calls are at least the turns, so a warning never
// comes late. Fires once at the soft point and once at the final point by returning
// additionalContext, which reaches the subagent. Silent for the main session and for any
// agent that is not a brigade agent. Any error exits 0 with no output: it never blocks a tool.
//
// Claude Code only. Codex hook parity is unverified.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULTS = { enabled: true, softFraction: 0.75, finalReserve: 3 }
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function maxTurnsFor(agentType) {
  const name = agentType.slice('brigade:'.length)
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', `${name}.md`), 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const m = front && /^maxTurns:\s*(\d+)\s*$/m.exec(front[1])
  return m ? Number(m[1]) : null
}

function readBudgets(cwd) {
  const out = { ...DEFAULTS }
  try {
    const raw = execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'brigade-config'), 'get', 'budgets', '--json'], {
      env: { ...process.env, BRIGADE_PROJECT_DIR: cwd }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    })
    const v = JSON.parse(raw).value || {}
    if (typeof v.enabled === 'boolean') out.enabled = v.enabled
    if (typeof v.softFraction === 'number' && v.softFraction > 0 && v.softFraction < 1) out.softFraction = v.softFraction
    if (Number.isInteger(v.finalReserve) && v.finalReserve >= 1) out.finalReserve = v.finalReserve
  } catch { /* defaults */ }
  return out
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const { agent_id: id, agent_type: type } = input
  if (!id || typeof id !== 'string' || typeof type !== 'string' || !type.startsWith('brigade:')) return
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return
  const cwd = input.cwd || process.cwd()

  const dir = path.join(process.env.CLAUDE_PLUGIN_DATA || os.tmpdir(), 'turn-budget')
  const file = path.join(dir, `${id}.json`)
  let state = null
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first call */ }
  if (!state) {
    const maxTurns = maxTurnsFor(type)
    state = { count: 0, maxTurns, budgets: maxTurns ? readBudgets(cwd) : DEFAULTS, soft: false, final: false }
  }
  if (!state.maxTurns || !state.budgets.enabled) return

  state.count += 1
  const { maxTurns, budgets, count } = state
  const softAt = Math.ceil(maxTurns * budgets.softFraction)
  const finalAt = maxTurns - budgets.finalReserve
  let event = null
  let text = null
  if (count >= finalAt && !state.final) {
    event = 'final'; state.final = true
    text = 'Final turns: write your report or brief now and stop.'
  } else if (count >= softAt && count < finalAt && !state.soft) {
    event = 'soft'; state.soft = true
    text = `Turn budget: you have used ${count} of ${maxTurns} turns. Wrap up now: stop new work, commit what passes, and write your artifact. An incomplete report that names what is left, with status blocked, is the expected outcome; never claim done, skip the gate, or weaken a test to finish.`
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(state))
  if (!event) return

  const stateDir = path.join(cwd, '.brigade')
  if (fs.existsSync(stateDir)) {
    try {
      fs.mkdirSync(path.join(stateDir, 'state'), { recursive: true })
      fs.appendFileSync(path.join(stateDir, 'state', 'turn-budget.jsonl'),
        JSON.stringify({ agent_id: id, agent_type: type, event, count, maxTurns, at: new Date().toISOString() }) + '\n')
    } catch { /* the warning still goes out */ }
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }))
}

try { main() } catch { /* never block a tool */ }
process.exit(0)
