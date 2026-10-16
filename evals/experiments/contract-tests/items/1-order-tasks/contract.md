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

Contract of `orderTasks(tasks)`, with `out` for the returned array:

- **R1 requires:** every `task.priority` is `high`, `normal` or `low`; `task.due` is a `YYYY-MM-DD` string or absent.
- **E1 ensures:** `out !== tasks`.
- **E2 ensures:** `out` is a permutation of `tasks`: the same task objects (`===`, not copies), every task done or not, `out.length === tasks.length`.
- **E3 ensures:** `PRIORITY_RANK[out[i].priority]` never decreases as `i` grows (`high`, then `normal`, then `low`).
- **E4 ensures:** within one priority, every task with a `due` comes before every task without one, and dated tasks are in ascending `due` order.
- **I1 invariant (frame):** `tasks` keeps its order and length, and no task object changes.
- **L1 law (stability):** tasks with the same priority and the same `due`, or the same priority and both without `due`, keep their input order.
- **L2 law (idempotence):** `orderTasks(orderTasks(x))` has the same order as `orderTasks(x)`.
- **L3 law (empty):** `orderTasks([])` is a new empty array.

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

1. **Explore (read-only, 2 files):** read `src/tasks.js` and `test/tasks.test.js`; if `src/tasks.js` doesn't match what's pasted above, stop and report the difference in your final message.
2. **Implement:** create `test/order-tasks.contract.test.js` with at least one test per clause above (`E1`–`E4`, `I1`, `L1`–`L3`), each test named after its clause id.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/order-tasks.contract.test.js
```

### Acceptance criteria

- [ ] Every clause id `E1`–`E4`, `I1`, `L1`–`L3` names at least one test
- [ ] `node --test test/order-tasks.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
