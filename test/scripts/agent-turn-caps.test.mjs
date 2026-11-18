// Tests for the turn caps written in the agent files' frontmatter. The inspector reviews a whole
// item or plan, so its turn cap must not sit below the cook-heavy cap it checks.
// Run with `node --test test/scripts/agent-turn-caps.test.mjs`.
//
// Contract (agent turn caps):
//   R1 reads only agent files that open with a `---` frontmatter block
//   E1 agents/brigade-inspector.md frontmatter has maxTurns: 80
//   E2 the inspector's maxTurns is at least cook-heavy's maxTurns
//   E3 every agents/*.md file with a maxTurns line gives a positive whole number
//   I1 the agent files are read, never written
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENTS = path.join(ROOT, 'agents')

// Returns the frontmatter block of an agent file as text, or null when the file has none.
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  return m ? m[1] : null
}

// Returns the maxTurns value from a frontmatter block, or null when the line is absent.
function maxTurnsOf(fm) {
  const m = /^maxTurns:[ \t]*(.*?)[ \t]*$/m.exec(fm)
  return m ? m[1] : null
}

function readAgent(name) {
  return fs.readFileSync(path.join(AGENTS, name), 'utf8')
}

function capOf(name) {
  const fm = frontmatter(readAgent(name))
  assert.ok(fm !== null, `${name} has no frontmatter block`)
  const raw = maxTurnsOf(fm)
  assert.ok(raw !== null, `${name} frontmatter has no maxTurns line`)
  return Number(raw)
}

const agentFiles = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).sort()

test('R1: every agent file that opens with frontmatter is parsed', () => {
  const withFrontmatter = agentFiles.filter((f) => frontmatter(readAgent(f)) !== null)
  assert.ok(withFrontmatter.includes('brigade-inspector.md'), 'inspector frontmatter not found')
  assert.ok(withFrontmatter.includes('brigade-cook-heavy.md'), 'cook-heavy frontmatter not found')
})

test('E1: the inspector frontmatter sets maxTurns to 80', () => {
  assert.equal(capOf('brigade-inspector.md'), 80)
})

test('E1 boundary: the parser rejects a 40 cap on the inspector', () => {
  // Guards against a vacuous E1: the cap read must be the exact value, not any number.
  assert.notEqual(capOf('brigade-inspector.md'), 40)
})

// The comparison E2 applies, pulled out so its boundary can be pinned with fixed numbers.
const inspectorCoversHeavy = (inspector, heavy) => inspector >= heavy

test('E2: the inspector cap is at least cook-heavy cap', () => {
  const inspector = capOf('brigade-inspector.md')
  const heavy = capOf('brigade-cook-heavy.md')
  assert.ok(inspectorCoversHeavy(inspector, heavy), `inspector maxTurns ${inspector} is below cook-heavy ${heavy}`)
})

test('E2 boundary: one turn short of cook-heavy fails, equal passes', () => {
  assert.equal(inspectorCoversHeavy(79, 80), false)
  assert.equal(inspectorCoversHeavy(80, 80), true)
})

test('E3: every agent file with a maxTurns line has a positive whole number', () => {
  const withCap = agentFiles.filter((f) => {
    const fm = frontmatter(readAgent(f))
    return fm !== null && maxTurnsOf(fm) !== null
  })
  assert.ok(withCap.length >= 2, 'expected at least the inspector and cook-heavy to carry a cap')
  for (const f of withCap) {
    const raw = maxTurnsOf(frontmatter(readAgent(f)))
    assert.match(raw, /^[1-9][0-9]*$/, `${f} maxTurns is not a positive whole number: ${raw}`)
  }
})
