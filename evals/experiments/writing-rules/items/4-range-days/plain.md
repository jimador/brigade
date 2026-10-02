# Packet: range-days — count and list the days of a date range

- **files:** the ONLY files you may touch
  - src/date-range.js (edit)
  - test/date-range.test.js (edit)

### Goal

Add `countDays(range)` and `eachDay(range)` to `src/date-range.js` so the report page can show how many days a range covers and one row per day; `parseRange` itself does not change.

### Contracts you code against

```js
// src/date-range.js after this change
countDays(range: { start: Date, end: Date }): number
eachDay(range: { start: Date, end: Date }): string[] // 'YYYY-MM-DD' strings
module.exports = { parseRange, countDays, eachDay }
```

`range` is the object `parseRange` returns: `start` and `end` are `Date` objects at midnight UTC, and `end` may equal `start`. `countDays` returns the number of calendar days in the range counting both the start and the end day (`2026-03-01..2026-03-05` is 5, a one-day range is 1, `2025-12-31..2026-01-01` is 2). `eachDay` returns one `YYYY-MM-DD` string per day from start to end, both included, in order (`2026-02-27..2026-03-02` gives `2026-02-27`, `2026-02-28`, `2026-03-01`, `2026-03-02`). Both functions work in UTC and leave `range.start` and `range.end` unchanged.

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

- **Off by one.** `(end - start) / 86400000` is 4 for `2026-03-01..2026-03-05`, one short, because both ends count; add one, and a day loop that stops at `day < end` drops the last day, so loop while `day <= end`.
- **Do not mutate the range.** `Date` objects are mutable, so stepping with `range.start.setUTCDate(...)` moves the caller's range; step on a copy (`new Date(range.start.getTime())`) or on a millisecond number instead.
- **UTC only.** Local-time methods (`getDate`, `setDate`, `getMonth`) give the previous day in time zones west of UTC; use `getUTCDate`, `Date.UTC` or `toISOString().slice(0, 10)`.

### Steps

1. **Explore (read-only, 2 files):** read `src/date-range.js` and `test/date-range.test.js`; if either doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** add `countDays` and `eachDay` to `src/date-range.js` after `parseRange`, each with a short comment, and export them next to `parseRange` as shown in the contract.
3. **Implement:** add cases to `test/date-range.test.js` for `2026-03-01..2026-03-05` (5 days), a one-day range (1), the month end `2026-02-27..2026-03-02` from `eachDay`, and `range.start` unchanged after `eachDay`.
4. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] `countDays(parseRange('2026-03-01..2026-03-05'))` returns 5
- [ ] `countDays(parseRange('2026-03-01..2026-03-01'))` returns 1
- [ ] `eachDay(parseRange('2026-02-27..2026-03-02'))` returns `['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']`
- [ ] After `eachDay(range)`, `range.start.toISOString()` is unchanged
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file, any change to `parseRange` or `parseDay`, time zones other than UTC, and `package.json`.
