# Packet: order-tasks

- **files:** Change only the files in this list.
  - `src/tasks.js` (edit)
  - `test/tasks.test.js` (edit)

### Goal

Add the function `orderTasks(tasks)` to `src/tasks.js`.
The to-do page needs the tasks in the order for work.
The array of the caller stays unchanged, because the page also shows the list in the order of entry.

### Contracts you code against

```js
// src/tasks.js after this change
// A task: { id, title, priority: 'high' | 'normal' | 'low', due?: 'YYYY-MM-DD', done }
orderTasks(tasks: Task[]): Task[]
module.exports = { PRIORITY_RANK, openTasks, orderTasks }
```

- `orderTasks` MUST return a new array.
- The new array MUST hold the same task objects, not copies.
- The new array MUST hold every task, done or not done.
- The first sort key MUST be the priority: `high`, then `normal`, then `low`, in the rank order of `PRIORITY_RANK`.
- In one priority, tasks with a `due` date MUST come first, with the earliest date first.
- In one priority, tasks without a `due` date MUST come after the tasks with a `due` date.
- A tie is two tasks with the same priority and the same `due` date.
- Two tasks with the same priority and no `due` date are also a tie.
- Tasks in a tie MUST keep the input order.
- The `due` strings compare correctly as plain strings.
- For an empty array, `orderTasks` MUST return a new empty array.
- `orderTasks` MUST NOT change the input array: not the order and not the length.
- `orderTasks` MUST NOT change a task object.

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

- **`sort` mutates.**
  - `Array.prototype.sort` sorts the array in place and returns the same array.
  - So `tasks.sort(...)` changes the order of the list of the caller.
  - Copy the array first, as in `[...tasks].sort(...)`.
- **Missing due dates.**
  - A comparison of `undefined` with a date string by `<` or `>` is false in both directions.
  - A comparator with only these comparisons returns 0, and tasks without a `due` date land in random places.
  - Handle a missing `due` date first, before the comparison of dates.

### Steps

1. **Explore (read-only, 2 files):**
   - Read `src/tasks.js` and `test/tasks.test.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - Add `orderTasks` to `src/tasks.js`, after `openTasks`.
   - Write a short comment above `orderTasks`.
   - Export `orderTasks`, as the contract shows.
3. **Implement:** Add these cases to `test/tasks.test.js`:
   - Test the order for the example input above.
   - Test that the input array is unchanged after the call.
   - Test that two tasks in a tie keep the input order.
   - Test an empty array.
4. **Verify (must pass):**
   - Run the command below from the root of the repo.
   - If the command fails, fix the code.
   - Then run the command again.
   - Continue until the command exits 0.
   - If you cannot make the command pass, stop the work.
   - Report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] For the example input, `orderTasks` returns the tasks with the ids `b, d, c, e, a`.
- [ ] After the call, the input array holds the ids `a, b, c, d, e`, in this order.
- [ ] The returned array is not the input array.
- [ ] The first element of the returned array is the same object as the input task `b`.
- [ ] `orderTasks([])` returns a new empty array.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Do not change `openTasks` or `PRIORITY_RANK`.
- Do not remove done tasks from the result.
- Leave `package.json` unchanged.
