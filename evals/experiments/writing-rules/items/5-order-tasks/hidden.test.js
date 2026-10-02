// Hidden test for item 5: orderTasks sorts a copy by priority, then due date.
const test = require('node:test')
const assert = require('node:assert/strict')
const { orderTasks } = require('../src/tasks.js')

function sample() {
  return [
    { id: 't1', title: 'File receipts', priority: 'low', due: '2026-03-01', done: false },
    { id: 't2', title: 'Call alex', priority: 'high', done: false },
    { id: 't3', title: 'Draft agenda', priority: 'normal', due: '2026-03-09', done: false },
    { id: 't4', title: 'Send invoice', priority: 'high', due: '2026-03-10', done: true },
    { id: 't5', title: 'Pay rent', priority: 'high', due: '2026-03-02', done: false },
    { id: 't6', title: 'Book room', priority: 'normal', due: '2026-03-09', done: false },
    { id: 't7', title: 'Reply to acme', priority: 'high', done: false },
    { id: 't8', title: 'Tidy notes', priority: 'normal', done: false },
  ]
}

test('orderTasks orders by priority, then due date, with no due date last', () => {
  const ordered = orderTasks(sample())
  assert.deepEqual(
    ordered.map((task) => task.id),
    ['t5', 't4', 't2', 't7', 't3', 't6', 't8', 't1'],
  )
})

test('orderTasks leaves the input array and its tasks unchanged', () => {
  const tasks = sample()
  const before = JSON.stringify(tasks)
  const ordered = orderTasks(tasks)
  assert.equal(JSON.stringify(tasks), before)
  assert.notEqual(ordered, tasks)
  assert.equal(ordered[0], tasks[4])
})

test('orderTasks returns a new empty array for an empty list', () => {
  const tasks = []
  const ordered = orderTasks(tasks)
  assert.deepEqual(ordered, [])
  assert.notEqual(ordered, tasks)
})
