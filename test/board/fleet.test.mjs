// Checks how the roster works out who an agent is and follows it from first sighting to finish.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identify, roleFromAct, emptyFleet, applyEvent, prune } from '../../hooks/board/lib/fleet.mjs'

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
