# Packet: order-tasks — order tasks by priority, then due date

- **files:** the ONLY files you may touch
  - src/tasks.js (edit)
  - test/tasks.test.js (edit)

### Goal

Add `orderTasks(tasks)` to `src/tasks.js` so the to-do page can list tasks in the order people should work on them, while the caller's own array stays exactly as it was, because the page also shows the list in the order it was entered.

### Contracts you code against

```js
// src/tasks.js after this change
// A task: { id, title, priority: 'high' | 'normal' | 'low', due?: 'YYYY-MM-DD', done }
orderTasks(tasks: Task[]): Task[]
module.exports = { PRIORITY_RANK, openTasks, orderTasks }
```

`orderTasks` returns a new array holding the same task objects (not copies) and every task, done or not. The order is by priority first (`high`, then `normal`, then `low`, as ranked by `PRIORITY_RANK`); within one priority, tasks with a `due` date come first, earliest date first, and tasks with no `due` come after them; tasks that tie (same priority and same `due`, or same priority and both without `due`) keep their input order. `due` strings compare correctly as plain strings. An empty array gives a new empty array. The input array (its order and length) and every task object must be left unchanged.

```js
// example input (ids, priorities and due dates only)
[{ id: 'a', priority: 'normal' },
 { id: 'b', priority: 'high', due: '2026-03-05' },
 { id: 'c', priority: 'normal', due: '2026-03-01' },
 { id: 'd', priority: 'high' },
 { id: 'e', priority: 'normal', due: '2026-03-01' }]
// orderTasks gives the ids: b, d, c, e, a
```

### Current behavior (pasted anchors)

```js
// src/tasks.js
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 }

// Returns the tasks that are not done yet, in the order given.
function openTasks(tasks) {
  return tasks.filter((task) => !task.done)
}

module.exports = { PRIORITY_RANK, openTasks }
```

### Preconditions & hazards

- **`sort` mutates.** `Array.prototype.sort` sorts in place and returns the same array, so `tasks.sort(...)` reorders the caller's list; copy first (`[...tasks].sort(...)`).
- **Missing due dates.** Comparing `undefined` with a date string using `<` and `>` is false both ways, so a comparator that only does that returns 0 and undated tasks land anywhere; handle a missing `due` explicitly before comparing dates.

### Steps

1. **Explore (read-only, 2 files):** read `src/tasks.js` and `test/tasks.test.js`; if either doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** add `orderTasks` to `src/tasks.js` after `openTasks`, with a short comment, and export it as shown in the contract.
3. **Implement:** add cases to `test/tasks.test.js` for the example order above, the input array unchanged after the call, two tied tasks keeping their input order, and an empty array.
4. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] For the example input, `orderTasks` returns tasks with the ids `b, d, c, e, a`
- [ ] After the call, the input array still holds the ids `a, b, c, d, e` in that order
- [ ] The returned array is not the input array, and its first element is the same object as the input task `b`
- [ ] `orderTasks([])` returns a new empty array
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file, any change to `openTasks` or `PRIORITY_RANK`, filtering out done tasks, and `package.json`.
