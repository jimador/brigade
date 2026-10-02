# Packet: compound-duration — parseDuration reads days and compound durations

- **files:** the ONLY files you may touch
  - src/duration.js (edit)
  - test/duration.test.js (edit)

### Goal

`parseDuration` also reads the unit `d` (days) and compound durations such as `1h30m`, so a config value such as a 90-minute session timeout can be written as `1h30m`; every single-unit value it accepts today returns the same number as before.

### Contracts you code against

```js
// src/duration.js after this change
parseDuration(text: string): number // milliseconds
// units: d = 86400000, h = 3600000, m = 60000, s = 1000
```

A duration is one or more parts written together with no spaces, each part a whole number followed by one unit, and the result is the sum of the parts: `1h30m` is 5400000 and `1d2h3m4s` is 93784000. Units must appear from largest to smallest (`d`, `h`, `m`, `s`) and each at most once, so `30m1h` and `1h1h` are invalid, as are a number with no unit (`1h30`), the empty string `''`, a space inside the value (`1h 30m`) and an unknown unit (`5w`). Leading and trailing whitespace is still ignored, as today (`' 1h30m '` is 5400000). Anything invalid throws `new Error('invalid duration: ' + text)`, with `text` exactly as the caller passed it, not trimmed.

### Current behavior (pasted anchors)

```js
// src/duration.js
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 }

function parseDuration(text) {
  const match = /^(\d+)(s|m|h)$/.exec(String(text).trim())
  if (!match) throw new Error(`invalid duration: ${text}`)
  return Number(match[1]) * UNIT_MS[match[2]]
}

module.exports = { parseDuration }
```

### Steps

1. **Explore (read-only, 2 files):** read `src/duration.js` and `test/duration.test.js`; if either doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** rewrite `parseDuration` in `src/duration.js` to the contract above, keep the comment above it accurate, and export only `parseDuration`.
3. **Implement:** add cases to `test/duration.test.js` for `2d`, `1h30m`, a unit out of order (`30m1h`) and a repeated unit (`1h1h`), checking the error message for the two invalid ones.
4. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] `parseDuration('1h30m')` returns 5400000
- [ ] `parseDuration('2d')` returns 172800000
- [ ] `parseDuration('90s')` still returns 90000
- [ ] `parseDuration('30m1h')` throws an `Error` with the message `invalid duration: 30m1h`
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file, other units (weeks, milliseconds), decimal numbers such as `1.5h`, and `package.json`.
