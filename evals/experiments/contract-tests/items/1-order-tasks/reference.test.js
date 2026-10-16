// The kit's own complete test for orderTasks. selfcheck.sh uses it to prove every
// mutant is a real behavior change. It is never shown to an agent.
const test = require('node:test')
const assert = require('node:assert/strict')
const { orderTasks } = require('../src/tasks.js')

const input = () => [
  { id: 'a', priority: 'normal', done: false },
  { id: 'b', priority: 'high', due: '2026-03-05', done: true },
  { id: 'c', priority: 'normal', due: '2026-03-01', done: false },
  { id: 'd', priority: 'high', done: false },
  { id: 'e', priority: 'normal', due: '2026-03-01', done: false },
  { id: 'f', priority: 'low', due: '2026-01-01', done: false },
  { id: 'g', priority: 'normal', done: false },
  { id: 'h', priority: 'normal', due: '2026-02-01', done: false },
]

test('orders by priority, then due date, undated last, ties in input order', () => {
  assert.deepEqual(orderTasks(input()).map((t) => t.id), ['b', 'd', 'h', 'c', 'e', 'a', 'g', 'f'])
})

test('keeps the input array and returns the same objects', () => {
  const tasks = input()
  const out = orderTasks(tasks)
  assert.deepEqual(tasks.map((t) => t.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  assert.notEqual(out, tasks)
  assert.equal(out[0], tasks[1])
  assert.equal(out.length, tasks.length)
})
