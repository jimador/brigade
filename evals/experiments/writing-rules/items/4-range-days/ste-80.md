# Packet: range-days

- **files:** Change only the files in this list.
  - `src/date-range.js` (edit)
  - `test/date-range.test.js` (edit)

### Goal

Add the functions `countDays(range)` and `eachDay(range)` to `src/date-range.js`.
The report page needs the number of days in a range, and one row for each day.
The function `parseRange` does not change.

### Contracts you code against

```js
// src/date-range.js after this change
countDays(range: { start: Date, end: Date }): number
eachDay(range: { start: Date, end: Date }): string[] // 'YYYY-MM-DD' strings
module.exports = { parseRange, countDays, eachDay }
```

- The argument `range` is the object that `parseRange` returns.
- `range.start` and `range.end` are `Date` objects at midnight UTC.
- `range.end` can be equal to `range.start`.
- `countDays` MUST return the number of calendar days in the range.
- `countDays` MUST count both the start day and the end day.
- For example, `2026-03-01..2026-03-05` has 5 days.
- A range of one day has 1 day.
- `2025-12-31..2026-01-01` has 2 days.
- `eachDay` MUST return one `YYYY-MM-DD` string for each day in the range.
- The strings MUST start at the start day and stop at the end day, with both days included.
- The strings MUST be in order.
- For example, `2026-02-27..2026-03-02` gives `2026-02-27`, `2026-02-28`, `2026-03-01` and `2026-03-02`.
- Both functions MUST work in UTC.
- Both functions MUST leave `range.start` and `range.end` unchanged.

### Current behavior (pasted anchors)

```js
// src/date-range.js, the end of the file
function parseRange(text) {
  const parts = String(text).split('..')
  if (parts.length !== 2) throw new Error(`invalid range: ${text}`)
  const start = parseDay(parts[0])
  const end = parseDay(parts[1])
  if (end < start) throw new Error(`range ends before it starts: ${text}`)
  return { start, end }
}

module.exports = { parseRange }
```

### Preconditions & hazards

- **Off by one.**
  - For `2026-03-01..2026-03-05`, `(end - start) / 86400000` is 4.
  - The value 4 is one day short, because the start day and the end day both count.
  - Add one to the difference.
  - A day loop with the condition `day < end` drops the last day.
  - Loop while `day <= end`.
- **Do not mutate the range.**
  - A `Date` object is mutable.
  - A step with `range.start.setUTCDate(...)` moves the range of the caller.
  - Step on a copy, such as `new Date(range.start.getTime())`, or on a number of milliseconds.
- **UTC only.**
  - The local-time methods `getDate`, `setDate` and `getMonth` give the previous day in time zones west of UTC.
  - Use `getUTCDate`, `Date.UTC` or `toISOString().slice(0, 10)`.

### Steps

1. **Explore (read-only, 2 files):**
   - Read `src/date-range.js` and `test/date-range.test.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - Add `countDays` and `eachDay` to `src/date-range.js`, after `parseRange`.
   - Write a short comment above each new function.
   - Export the new functions next to `parseRange`, as the contract shows.
3. **Implement:** Add these cases to `test/date-range.test.js`:
   - Test that `2026-03-01..2026-03-05` has 5 days.
   - Test that a range of one day has 1 day.
   - Test the result of `eachDay` for the month end `2026-02-27..2026-03-02`.
   - Test that `range.start` is unchanged after `eachDay`.
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

- [ ] `countDays(parseRange('2026-03-01..2026-03-05'))` returns 5.
- [ ] `countDays(parseRange('2026-03-01..2026-03-01'))` returns 1.
- [ ] `eachDay(parseRange('2026-02-27..2026-03-02'))` returns `['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']`.
- [ ] After `eachDay(range)`, `range.start.toISOString()` is unchanged.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Do not change `parseRange` or `parseDay`.
- Support no time zone other than UTC.
- Leave `package.json` unchanged.
