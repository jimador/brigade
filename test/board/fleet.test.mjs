// Checks how the roster works out who an agent is and follows it from first sighting to finish.
import { describe, test } from 'node:test'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { identify, roleFromAct, activityOf, emptyFleet, applyEvent, prune } from '../../hooks/board/lib/fleet.mjs'

const DISH = '/path/to/repo/.brigade/dishes/obsidian-example'

test('a heavy cook type wins over the plain cook substring', () => {
  const who = identify({ description: 'cook:board-tickets:0', subagentType: 'brigade:brigade-cook-heavy' })
  assert.equal(who.role, 'heavy')
  assert.equal(who.item, 'board-tickets')
  assert.equal(identify({ subagentType: 'brigade-cook-opus' }).role, 'heavy')
})

test('an inspector label and type give the inspector and its item', () => {
  const who = identify({ description: 'inspect:weather-forecast:1', subagentType: 'brigade:brigade-inspector' })
  assert.equal(who.role, 'inspector')
  assert.equal(who.item, 'weather-forecast')
})

test('the dish comes from the prompt', () => {
  assert.equal(identify({ prompt: `read ${DISH}/PLAN.md` }).dish, 'obsidian-example')
})

test('the item comes from a worktree folder', () => {
  assert.equal(identify({ paths: ['/path/to/repo/.brigade/worktrees/board-pane--cell-canvas/x.mjs'] }).item, 'cell-canvas')
})

test('a worktree add command names the item but not the role', () => {
  const who = identify({
    paths: ['git -C /path/to/repo worktree add /path/to/repo/.brigade/worktrees/board-pane--state-contract -b wip/board-pane/state-contract feat/board-pane'],
  })
  assert.equal(who.role, 'agent')
  assert.equal(who.item, 'state-contract')
})

test('a packet path names the item and the dish', () => {
  const who = identify({ paths: [`${DISH}/packets/dish-notes.md`] })
  assert.equal(who.item, 'dish-notes')
  assert.equal(who.dish, 'obsidian-example')
})

test('writing a verdict makes an inspector', () => {
  const path = `${DISH}/reports/dish-notes-verdict.md`
  const who = identify({ paths: [path], act: { tool: 'Write', filePath: path } })
  assert.equal(who.role, 'inspector')
  assert.equal(who.item, 'dish-notes')
})

test('a verdict path that is only mentioned names the item but not the role', () => {
  const who = identify({ paths: [`${DISH}/reports/dish-notes-verdict.md`] })
  assert.equal(who.role, 'agent')
  assert.equal(who.item, 'dish-notes')
})

test('roleFromAct takes the role from a written file', () => {
  const verdict = `${DISH}/reports/dish-notes-verdict.md`
  assert.equal(roleFromAct({ tool: 'Write', filePath: verdict }), 'inspector')
  assert.equal(roleFromAct({ tool: 'Read', filePath: verdict }), null)
  assert.equal(roleFromAct({ tool: 'Edit', filePath: '/path/to/repo/.brigade/worktrees/board-pane--dish-notes/hooks/a.mjs' }), 'cook')
  assert.equal(roleFromAct({ tool: 'Write', filePath: `${DISH}/briefs/1-topic.md` }), 'scout')
  assert.equal(roleFromAct({ tool: 'MultiEdit', filePath: `${DISH}/reports/dish-notes-cook.md` }), 'cook')
  assert.equal(roleFromAct({ tool: 'Write', filePath: `${DISH}/plan-check.md` }), 'inspector')
  assert.equal(roleFromAct({ tool: 'Write', filePath: `${DISH}/retro.md` }), 'analyst')
})

test('roleFromAct never takes a role from reading', () => {
  assert.equal(roleFromAct({ tool: 'Bash', command: `cat ${DISH}/state/dish-notes.md | head -50` }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: `cat ${DISH}/reports/dish-notes-verdict.md > /tmp/copy.md` }), null)
  assert.equal(roleFromAct({ tool: 'Grep', filePath: `${DISH}/reports/dish-notes-cook.md` }), null)
  assert.equal(roleFromAct({}), null)
  assert.equal(roleFromAct(undefined), null)
})

test('roleFromAct takes the role from what a shell command writes', () => {
  assert.equal(roleFromAct({ tool: 'Bash', command: `cat > ${DISH}/state/dish-notes.md` }), 'cook')
  assert.equal(roleFromAct({ tool: 'Bash', command: `echo done >> ${DISH}/state/dish-notes.md` }), 'cook')
  assert.equal(roleFromAct({ tool: 'Bash', command: `printf x | tee ${DISH}/reports/dish-notes-verdict.md` }), 'inspector')
  assert.equal(roleFromAct({ tool: 'Bash', command: `cat > ${DISH}/state/planner.md` }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git -C /path/to/repo worktree add /path/to/repo/.brigade/worktrees/board-pane--dish-notes -b wip/x feat/y' }), 'steward')
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git worktree remove /path/to/repo/.brigade/worktrees/board-pane--dish-notes' }), 'steward')
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git merge --ff-only wip/x' }), 'steward')
})

test("the Planner's state file names no item", () => {
  assert.equal(identify({ paths: [`${DISH}/state/planner.md`] }).item, null)
})

test('a slug that looks like a role never sets the role', () => {
  const inspector = identify({ description: 'inspect:cook-roster:1' })
  assert.equal(inspector.role, 'inspector')
  assert.equal(inspector.item, 'cook-roster')
  assert.equal(identify({ description: 'cook:scout-brief:0', subagentType: 'brigade:brigade-cook' }).role, 'cook')
  assert.equal(identify({ description: 'cook:scout-brief:0' }).role, 'cook')
})

test('a planner type gives the planner', () => {
  assert.equal(identify({ subagentType: 'planner' }).role, 'planner')
})

test('no evidence gives a plain agent with nothing known', () => {
  assert.deepEqual(identify({}), { role: 'agent', dish: null, item: null })
})

test('steps add up tokens after a spawn', () => {
  let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a1', at: 1000, description: 'cook:board-tickets:0' })
  fleet = applyEvent(fleet, { type: 'step', id: 'a1', at: 1100, model: 'model-x', tokens: 100 })
  fleet = applyEvent(fleet, { type: 'step', id: 'a1', at: 1200, tokens: 50 })
  const agent = fleet.agents.a1
  assert.equal(agent.tokens, 150)
  assert.equal(agent.model, 'model-x')
  assert.equal(agent.state, 'working')
  assert.equal(agent.startedAt, 1000)
  assert.equal(agent.item, 'board-tickets')
})

test('a step for an unknown id adds a new agent named Basil', () => {
  const fleet = applyEvent(emptyFleet(), { type: 'step', id: 'x9', at: 5, tokens: 7 })
  assert.deepEqual(fleet.order, ['x9'])
  const agent = fleet.agents.x9
  assert.equal(agent.name, 'Basil')
  assert.equal(agent.role, 'agent')
  assert.equal(agent.tokens, 7)
  assert.equal(agent.state, 'working')
  assert.equal(agent.endedAt, null)
  assert.equal(agent.ticket, null)
  assert.equal(agent.lane, null)
})

test('a tool event fills a missing item but keeps a known one', () => {
  let fleet = applyEvent(emptyFleet(), { type: 'step', id: 'a', at: 1, tokens: 0 })
  fleet = applyEvent(fleet, { type: 'tool', id: 'a', at: 2, paths: [`${DISH}/packets/first-item.md`] })
  assert.equal(fleet.agents.a.item, 'first-item')
  assert.equal(fleet.agents.a.dish, 'obsidian-example')
  fleet = applyEvent(fleet, { type: 'tool', id: 'a', at: 3, paths: [`${DISH}/packets/other-item.md`] })
  assert.equal(fleet.agents.a.item, 'first-item')
})

test('a tool event that writes turns a plain agent into a cook, but never changes a set role', () => {
  const report = `${DISH}/reports/dish-notes-cook.md`
  let fleet = applyEvent(emptyFleet(), { type: 'tool', id: 'a', at: 1, paths: [report], act: { tool: 'Write', filePath: report } })
  assert.equal(fleet.agents.a.role, 'cook')
  fleet = applyEvent(fleet, { type: 'spawn', id: 'i', at: 1, subagentType: 'brigade:brigade-inspector' })
  fleet = applyEvent(fleet, { type: 'tool', id: 'i', at: 2, paths: [report], act: { tool: 'Write', filePath: report } })
  assert.equal(fleet.agents.i.role, 'inspector')
  assert.equal(fleet.agents.a.name, 'Basil')
  assert.notEqual(fleet.agents.i.name, fleet.agents.a.name)
})

test('an agent that reads a ledger and a cook report stays a plain agent until it writes a verdict', () => {
  const ledger = `${DISH}/state/dish-notes.md`
  const report = `${DISH}/reports/dish-notes-cook.md`
  const verdict = `${DISH}/reports/dish-notes-verdict.md`
  let fleet = applyEvent(emptyFleet(), { type: 'step', id: 'i', at: 1, tokens: 0 })
  fleet = applyEvent(fleet, { type: 'tool', id: 'i', at: 2, paths: [`cat ${ledger}`], act: { tool: 'Bash', command: `cat ${ledger}` } })
  fleet = applyEvent(fleet, { type: 'tool', id: 'i', at: 3, paths: [report], act: { tool: 'Read', filePath: report } })
  assert.equal(fleet.agents.i.role, 'agent')
  assert.equal(fleet.agents.i.item, 'dish-notes')
  assert.equal(fleet.agents.i.dish, 'obsidian-example')
  fleet = applyEvent(fleet, { type: 'tool', id: 'i', at: 4, paths: [verdict], act: { tool: 'Write', filePath: verdict } })
  assert.equal(fleet.agents.i.role, 'inspector')
})

test('a cook stays a cook after it writes a verdict', () => {
  const verdict = `${DISH}/reports/dish-notes-verdict.md`
  let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'c', at: 1, description: 'cook:dish-notes:0' })
  fleet = applyEvent(fleet, { type: 'tool', id: 'c', at: 2, paths: [verdict], act: { tool: 'Write', filePath: verdict } })
  assert.equal(fleet.agents.c.role, 'cook')
})

test('a tool event with paths only names the item but sets no role', () => {
  const fleet = applyEvent(emptyFleet(), { type: 'tool', id: 'a', at: 1, paths: [`${DISH}/reports/dish-notes-cook.md`] })
  assert.equal(fleet.agents.a.role, 'agent')
  assert.equal(fleet.agents.a.item, 'dish-notes')
})

test('no two agents share a name, also after one has been pruned', () => {
  let fleet = applyEvent(emptyFleet(), { type: 'step', id: 'a', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'step', id: 'b', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'step', id: 'c', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'complete', id: 'a', at: 2, reason: 'answer' })
  fleet = prune(fleet, 1000, 10)
  assert.deepEqual(fleet.order, ['b', 'c'])
  fleet = applyEvent(fleet, { type: 'step', id: 'd', at: 1001, tokens: 1 })
  const names = fleet.order.map((id) => fleet.agents[id].name)
  assert.equal(names.length, 3)
  assert.equal(new Set(names).size, names.length, names.join(', '))
})

test('a repeat spawn only fills fields that are still empty', () => {
  let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1, description: 'cook:first-item:0', model: 'model-x' })
  fleet = applyEvent(fleet, { type: 'spawn', id: 'a', at: 9, description: 'cook:other-item:0', model: 'model-y', prompt: `${DISH}/PLAN.md` })
  const agent = fleet.agents.a
  assert.equal(agent.item, 'first-item')
  assert.equal(agent.model, 'model-x')
  assert.equal(agent.startedAt, 1)
  assert.equal(agent.dish, 'obsidian-example')
  assert.deepEqual(fleet.order, ['a'])
})

test('complete marks errors and aborts as failed and anything else as done', () => {
  let fleet = applyEvent(emptyFleet(), { type: 'step', id: 'a', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'step', id: 'b', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'step', id: 'c', at: 1, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'complete', id: 'a', at: 10, reason: 'error' })
  fleet = applyEvent(fleet, { type: 'complete', id: 'b', at: 11, reason: 'answer' })
  fleet = applyEvent(fleet, { type: 'complete', id: 'c', at: 12, reason: 'aborted' })
  assert.equal(fleet.agents.a.state, 'failed')
  assert.equal(fleet.agents.a.endedAt, 10)
  assert.equal(fleet.agents.b.state, 'done')
  assert.equal(fleet.agents.b.endedAt, 11)
  assert.equal(fleet.agents.c.state, 'failed')
})

test('complete for an unknown id leaves the roster as it was', () => {
  const fleet = applyEvent(emptyFleet(), { type: 'step', id: 'a', at: 1, tokens: 3 })
  assert.deepEqual(applyEvent(fleet, { type: 'complete', id: 'ghost', at: 2, reason: 'answer' }), fleet)
})

test('applying events never changes the roster passed in', () => {
  const fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
  const before = structuredClone(fleet)
  applyEvent(fleet, { type: 'step', id: 'a', at: 2, tokens: 40, model: 'model-x' })
  applyEvent(fleet, { type: 'step', id: 'new', at: 2, tokens: 1 })
  applyEvent(fleet, { type: 'tool', id: 'a', at: 3, paths: [`${DISH}/reports/dish-notes-cook.md`] })
  applyEvent(fleet, { type: 'spawn', id: 'a', at: 4, description: 'cook:dish-notes:0' })
  applyEvent(fleet, { type: 'complete', id: 'a', at: 5, reason: 'error' })
  prune(fleet, 10, 1)
  assert.deepEqual(fleet, before)
})

test('prune drops long-finished agents and keeps working ones', () => {
  const now = 1_000_000_000
  let fleet = applyEvent(emptyFleet(), { type: 'step', id: 'old', at: now - 20 * 60_000, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'step', id: 'busy', at: now - 20 * 60_000, tokens: 1 })
  fleet = applyEvent(fleet, { type: 'complete', id: 'old', at: now - 10 * 60_000, reason: 'answer' })
  const kept = prune(fleet, now, 60_000)
  assert.deepEqual(kept.order, ['busy'])
  assert.deepEqual(Object.keys(kept.agents), ['busy'])
  assert.equal(kept.agents.busy.state, 'working')
})

// A shell command or path can be any length an agent likes, and the role checks run on every tool
// call, so each one has to take time in step with the length of its input.
describe('working out a role costs time in step with the input', () => {
  const LIMIT_MS = 50
  const SIZES = [8_000, 100_000]

  // Repeats a piece until the text is at least `size` characters long.
  function grow(piece, size) {
    return piece.repeat(Math.ceil(size / piece.length))
  }

  // Runs `fn` once and fails if it took longer than the limit.
  function quick(label, fn) {
    const start = performance.now()
    fn()
    const took = performance.now() - start
    assert.ok(took < LIMIT_MS, `${label} took ${took.toFixed(1)} ms`)
  }

  const COMMANDS = {
    'git merge, over and over': (n) => grow('git merge ', n),
    'git worktree, over and over': (n) => grow('git worktree ', n),
    'one git and many merges': (n) => 'git ' + grow('merge ', n),
    'many bare redirects': (n) => grow('> ', n),
    'one long run of >': (n) => grow('>', n),
    'tee, over and over': (n) => grow('tee ', n),
    'double quotes only': (n) => grow('"', n),
    'single quotes only': (n) => grow("'", n),
    'a redirect into a quote that never closes': (n) => 'a > "' + grow('b', n),
  }

  const PATHS = {
    'state folders, over and over': (n) => grow('/state/', n),
    'worktree folders, over and over': (n) => grow('.brigade/worktrees/', n),
    'dish folders, over and over': (n) => grow('.brigade/dishes/', n),
  }

  for (const [name, build] of Object.entries(COMMANDS)) {
    test(`a shell command made of ${name}`, () => {
      for (const size of SIZES) {
        const command = build(size)
        quick(`roleFromAct at ${size}`, () => roleFromAct({ tool: 'Bash', command }))
        quick(`identify at ${size}`, () => identify({ prompt: command, paths: [command], act: { tool: 'Bash', command } }))
        quick(`a written path at ${size}`, () => roleFromAct({ tool: 'Write', filePath: command }))
        quick(`a tool event at ${size}`, () => applyEvent(emptyFleet(), { type: 'tool', id: 'a', at: 1, paths: [command], act: { tool: 'Bash', command } }))
      }
    })
  }

  for (const [name, build] of Object.entries(PATHS)) {
    test(`a path and a prompt made of ${name}`, () => {
      for (const size of SIZES) {
        const text = build(size)
        quick(`identify by path at ${size}`, () => identify({ paths: [text] }))
        quick(`identify by prompt at ${size}`, () => identify({ prompt: text }))
        quick(`a written path at ${size}`, () => roleFromAct({ tool: 'Write', filePath: text }))
        quick(`a shell command at ${size}`, () => roleFromAct({ tool: 'Bash', command: text }))
        quick(`a tool event at ${size}`, () => applyEvent(emptyFleet(), { type: 'tool', id: 'a', at: 1, paths: [text], act: { tool: 'Write', filePath: text } }))
      }
    })
  }
})

test('a steward command is judged one command of a list at a time', () => {
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git -C /path/to/repo merge --ff-only wip/x' }), 'steward')
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git log; echo merge --ff-only' }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git merge wip/x' }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git log && git worktree add /path/to/repo/.brigade/worktrees/a--b' }), 'steward')
  assert.equal(roleFromAct({ tool: 'Bash', command: 'git log | echo worktree add' }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: 'echo merge --ff-only git' }), null)
})

test('only the first 4,000 characters of a shell command are looked at', () => {
  const padding = 'x'.repeat(5_000)
  assert.equal(roleFromAct({ tool: 'Bash', command: `echo ${padding}; git merge --ff-only wip/x` }), null)
  assert.equal(roleFromAct({ tool: 'Bash', command: `echo ${padding}; git worktree add /path/to/repo/x` }), null)
})

// Anything the board might draw from a tool call: a control character there would move the
// cursor or recolour the terminal, so none may get through.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

// Fails unless `text` is null, or short, single-line text the board can draw as it is.
function drawable(text) {
  if (text === null) return
  assert.equal(typeof text, 'string')
  assert.ok(text.length <= 32, `${JSON.stringify(text.slice(0, 40))} is ${text.length} characters`)
  assert.ok(!CONTROL.test(text), `${JSON.stringify(text)} holds a control character`)
}

describe('what a tool call looks like to someone watching', () => {
  const FILE = '/path/to/repo/src/limits/bucket.ts'

  test('writing a file says which file is being edited', () => {
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      assert.equal(activityOf({ tool, filePath: FILE }), 'editing bucket.ts', tool)
    }
  })

  test('reading a file says which file is being read', () => {
    assert.equal(activityOf({ tool: 'Read', filePath: FILE }), 'reading bucket.ts')
  })

  test('a long file name is clipped to 24 characters', () => {
    const name = 'token-bucket-refill-rate-limiter-window-sliding-counters.mjs'
    assert.equal(name.length, 60)
    assert.equal(activityOf({ tool: 'Edit', filePath: `/path/to/repo/src/${name}` }), `editing ${name.slice(0, 24)}`)
    assert.equal(activityOf({ tool: 'Read', filePath: name }), `reading ${name.slice(0, 24)}`)
  })

  test('a folder path names its last folder', () => {
    assert.equal(activityOf({ tool: 'Read', filePath: '/path/to/repo/src/limits/' }), 'reading limits')
  })

  test('a write or read with no path says nothing', () => {
    assert.equal(activityOf({ tool: 'Write' }), null)
    assert.equal(activityOf({ tool: 'Edit', filePath: '' }), null)
    assert.equal(activityOf({ tool: 'Read', filePath: 42 }), null)
    assert.equal(activityOf({ tool: 'Read', filePath: '///' }), null)
  })

  test('grep and glob are searching', () => {
    assert.equal(activityOf({ tool: 'Grep' }), 'searching')
    assert.equal(activityOf({ tool: 'Glob', filePath: FILE }), 'searching')
  })

  test('a shell command that runs tests is running tests', () => {
    assert.equal(activityOf({ tool: 'Bash', command: 'cd /path/to/repo && node --test test/board/*.test.mjs' }), 'running tests')
    const runs = [
      'npm test', 'npm run test -- --watch', 'pnpm test', 'yarn test', 'pytest -q', 'go test ./...',
      'cargo test', 'gradle test', './gradlew test', 'mvn test', 'claude plugin test .', './test/regression.sh',
      '/path/to/repo/test/run.sh', 'cd /path/to/repo; tests/smoke.sh', 'bash /path/to/repo/tests/run.sh',
    ]
    for (const command of runs) assert.equal(activityOf({ tool: 'Bash', command }), 'running tests', command)
  })

  test('naming a file under a test folder without running it is not a test run', () => {
    assert.equal(activityOf({ tool: 'Bash', command: 'cat /path/to/repo/test/fixture.txt' }), 'running cat')
  })

  test('git is running git, whatever comes after it', () => {
    assert.equal(activityOf({ tool: 'Bash', command: 'git -C /path/to/repo status' }), 'running git')
    assert.equal(activityOf({ tool: 'Bash', command: '  git log --oneline' }), 'running git')
  })

  test('any other command is named by the last part of its first word', () => {
    assert.equal(activityOf({ tool: 'Bash', command: '/usr/local/bin/python3 script.py' }), 'running python3')
    assert.equal(activityOf({ tool: 'Bash', command: 'ls -la /path/to/repo' }), 'running ls')
    assert.equal(activityOf({ tool: 'Bash', command: '"/opt/acme/bin/token-bucket" --rate 5' }), 'running token-bucket')
    assert.equal(activityOf({ tool: 'Bash', command: 'token-bucket-benchmark --all' }), 'running token-bucket-ben')
  })

  test('only the first 400 characters of a command are looked at', () => {
    assert.equal(activityOf({ tool: 'Bash', command: `echo ${'x'.repeat(400)} && npm test` }), 'running echo')
  })

  test('a command with no word says nothing', () => {
    assert.equal(activityOf({ tool: 'Bash', command: '     ' }), null)
    assert.equal(activityOf({ tool: 'Bash', command: '' }), null)
    assert.equal(activityOf({ tool: 'Bash' }), null)
  })

  test('handing work to other agents is briefing agents', () => {
    for (const tool of ['Agent', 'Task', 'Workflow']) assert.equal(activityOf({ tool }), 'briefing agents', tool)
  })

  test('fetching or searching the web is on the web', () => {
    for (const tool of ['WebFetch', 'WebSearch']) assert.equal(activityOf({ tool }), 'on the web', tool)
  })

  test('an unknown or missing tool says nothing', () => {
    assert.equal(activityOf({ tool: undefined, filePath: FILE }), null)
    assert.equal(activityOf({ tool: 'TodoWrite' }), null)
    assert.equal(activityOf({}), null)
    assert.equal(activityOf(undefined), null)
    assert.equal(activityOf(null), null)
    assert.equal(activityOf('Bash'), null)
  })

  test('control characters in a path or command become spaces', () => {
    const edited = activityOf({ tool: 'Edit', filePath: '/path/to/repo/bad\nname\u001b[31m.ts' })
    drawable(edited)
    assert.equal(edited, 'editing bad name [31m.ts')
    const read = activityOf({ tool: 'Read', filePath: '/path/to/repo/\u0007\u009b\u2028\r.md' })
    drawable(read)
    assert.equal(activityOf({ tool: 'Bash', command: '\u0007ls\u001b-la' }), 'running ls')
    assert.equal(activityOf({ tool: 'Bash', command: '\u0000\n\t\r' }), null)
  })
})

describe('an activity event', () => {
  test('a new agent starts with no activity', () => {
    const fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1, description: 'cook:token-bucket:0' })
    assert.equal(fleet.agents.a.activity, null)
    assert.equal(applyEvent(emptyFleet(), { type: 'step', id: 'b', at: 1, tokens: 1 }).agents.b.activity, null)
    assert.equal(applyEvent(emptyFleet(), { type: 'tool', id: 'c', at: 1 }).agents.c.activity, null)
  })

  test('sets what the agent is doing, and a later one replaces it', () => {
    let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: 'reading bucket.ts' })
    assert.equal(fleet.agents.a.activity, 'reading bucket.ts')
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: 'running tests' })
    assert.equal(fleet.agents.a.activity, 'running tests')
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: null })
    assert.equal(fleet.agents.a.activity, null)
  })

  test('for an unknown id adds nobody', () => {
    const fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
    const after = applyEvent(fleet, { type: 'activity', id: 'ghost', text: 'running tests' })
    assert.deepEqual(after, fleet)
    assert.deepEqual(applyEvent(emptyFleet(), { type: 'activity', id: 'ghost', text: 'searching' }), emptyFleet())
  })

  test('never wakes a finished agent, and finishing clears the activity', () => {
    let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
    fleet = applyEvent(fleet, { type: 'spawn', id: 'b', at: 1 })
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: 'editing bucket.ts' })
    fleet = applyEvent(fleet, { type: 'activity', id: 'b', text: 'running tests' })
    fleet = applyEvent(fleet, { type: 'complete', id: 'a', at: 5, reason: 'answer' })
    fleet = applyEvent(fleet, { type: 'complete', id: 'b', at: 5, reason: 'error' })
    assert.equal(fleet.agents.a.activity, null)
    assert.equal(fleet.agents.b.activity, null)
    const before = structuredClone(fleet)
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: 'running git' })
    fleet = applyEvent(fleet, { type: 'activity', id: 'b', text: 'running git' })
    assert.deepEqual(fleet, before)
    assert.equal(fleet.agents.a.state, 'done')
    assert.equal(fleet.agents.b.state, 'failed')
  })

  test('never changes the roster passed in', () => {
    const fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
    const before = structuredClone(fleet)
    applyEvent(fleet, { type: 'activity', id: 'a', text: 'searching' })
    assert.deepEqual(fleet, before)
  })

  test('keeps outside text drawable', () => {
    let fleet = applyEvent(emptyFleet(), { type: 'spawn', id: 'a', at: 1 })
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: `running\n\u001b[2J${'x'.repeat(100_000)}` })
    drawable(fleet.agents.a.activity)
    assert.ok(fleet.agents.a.activity.startsWith('running  [2J'))
    fleet = applyEvent(fleet, { type: 'activity', id: 'a', text: 42 })
    assert.equal(fleet.agents.a.activity, null)
  })
})

// This runs on every tool call of every agent, and a command or path can be any length, so each
// answer has to come back quickly whatever it is handed, and still be short and drawable.
describe('working out an activity is quick and short for hostile input', () => {
  const LIMIT_MS = 20
  const SIZES = [10_000, 100_000]

  function grow(piece, size) {
    return piece.repeat(Math.ceil(size / piece.length))
  }

  const HOSTILE = {
    'node --test, over and over': 'node --test ',
    'git, over and over': 'git ',
    'one long run of slashes': '/',
    'spaces only': ' ',
    'double quotes only': '"',
    'a path of a/ over and over': 'a/',
    'escape characters only': '\u001b',
  }

  for (const [name, piece] of Object.entries(HOSTILE)) {
    test(`${name}`, () => {
      for (const size of SIZES) {
        const text = grow(piece, size)
        assert.ok(text.length >= size)
        for (const act of [{ tool: 'Bash', command: text }, { tool: 'Edit', filePath: text }, { tool: 'Read', filePath: text }]) {
          const start = performance.now()
          const result = activityOf(act)
          const took = performance.now() - start
          assert.ok(took < LIMIT_MS, `${act.tool} at ${size} took ${took.toFixed(1)} ms`)
          drawable(result)
        }
      }
    })
  }

  test('hostile input still gets the right answer', () => {
    assert.equal(activityOf({ tool: 'Bash', command: grow('node --test ', 100_000) }), 'running tests')
    assert.equal(activityOf({ tool: 'Bash', command: grow('git ', 100_000) }), 'running git')
    assert.equal(activityOf({ tool: 'Bash', command: grow('/', 100_000) }), null)
    assert.equal(activityOf({ tool: 'Bash', command: grow(' ', 100_000) }), null)
    assert.equal(activityOf({ tool: 'Bash', command: grow('"', 100_000) }), null)
    assert.equal(activityOf({ tool: 'Edit', filePath: grow('a/', 100_000) }), 'editing a')
    assert.equal(activityOf({ tool: 'Edit', filePath: grow('b', 100_000) }), `editing ${'b'.repeat(24)}`)
  })

  test('a file name of wide characters is never cut in half', () => {
    const result = activityOf({ tool: 'Read', filePath: `/path/to/repo/${'\u{1F600}'.repeat(30)}` })
    drawable(result)
    assert.ok(result.isWellFormed(), JSON.stringify(result))
  })
})
