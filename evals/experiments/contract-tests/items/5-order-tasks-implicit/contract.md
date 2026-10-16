# Packet: order-tasks-tests — test orderTasks

- **files:** the ONLY files you may touch
  - test/order-tasks.contract.test.js (create)

### Goal

`orderTasks` in `src/tasks.js` is written but has no tests. Add a test file that would catch a regression in it, because the to-do page depends on both the order it returns and the caller's list staying as entered.

### Contracts you code against

```js
// src/tasks.js
// A task: { id, title, priority: 'high' | 'normal' | 'low', due?: 'YYYY-MM-DD', done }
orderTasks(tasks: Task[]): Task[]
module.exports = { PRIORITY_RANK, openTasks, orderTasks }
```

`orderTasks` returns the tasks in the order people should work on them: by priority, then by due date.

### Current behavior (pasted anchors)

```js
// src/tasks.js
function orderTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (byPriority !== 0) return byPriority
    if (a.due === undefined || b.due === undefined) {
      return (a.due === undefined ? 1 : 0) - (b.due === undefined ? 1 : 0)
    }
    if (a.due < b.due) return -1
    if (a.due > b.due) return 1
    return 0
  })
}
```

### Steps

1. **Explore (read-only, 2 files):** read `src/tasks.js` and `test/tasks.test.js`; if the source doesn't match what's pasted above, stop and report the difference in your final message.
2. **Implement:** create `test/order-tasks.contract.test.js`. First write the contract of the code above as a comment block at the top of the file: numbered clauses, `R1`… for requires (the inputs the code accepts and what it does outside them), `E1`… for ensures (what each call returns or changes), `I1`… for invariants (what a call leaves unchanged) and `L1`… for laws (such as idempotence, stability, a round-trip or a sum of parts). Read each clause from the code. Then write at least one test per clause, named with its id; for a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/order-tasks.contract.test.js
```

### Acceptance criteria

- [ ] The file opens with the numbered contract, and every clause id names at least one test
- [ ] `node --test test/order-tasks.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
