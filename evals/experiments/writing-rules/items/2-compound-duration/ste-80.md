# Packet: compound-duration

- **files:** Change only the files in this list.
  - `src/duration.js` (edit)
  - `test/duration.test.js` (edit)

### Goal

The function `parseDuration` also reads the unit `d` for days.
The function `parseDuration` also reads compound durations, such as `1h30m`.
A compound duration is a duration with more than one part.
A config value, such as a 90-minute session timeout, can then be `1h30m`.
Each single-unit value that `parseDuration` accepts today returns the same number as before.

### Contracts you code against

```js
// src/duration.js after this change
parseDuration(text: string): number // milliseconds
// units: d = 86400000, h = 3600000, m = 60000, s = 1000
```

- A duration MUST have one or more parts.
- Each part MUST be a whole number, followed by one unit.
- The parts MUST touch each other, with no spaces between the parts.
- The result MUST be the sum of the parts.
- For example, `1h30m` is 5400000, and `1d2h3m4s` is 93784000.
- The units MUST occur in the order `d`, `h`, `m`, `s`, from the largest unit to the smallest unit.
- Each unit MUST occur at most one time.
- These values are invalid:
  - `30m1h`: the units are out of order.
  - `1h1h`: a unit occurs two times.
  - `1h30`: a number has no unit.
  - `''`: the empty string has no parts.
  - `1h 30m`: the value has a space inside.
  - `5w`: the unit is unknown.
- `parseDuration` MUST ignore spaces at the start and at the end, as today.
- For example, `' 1h30m '` is 5400000.
- For an invalid value, `parseDuration` MUST throw `new Error('invalid duration: ' + text)`.
- In the message, `text` MUST be the exact text from the caller, not trimmed.

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

1. **Explore (read-only, 2 files):**
   - Read `src/duration.js` and `test/duration.test.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - Rewrite `parseDuration` in `src/duration.js` to agree with the contract above.
   - Keep the comment above `parseDuration` accurate.
   - Export only `parseDuration`.
3. **Implement:** Add these cases to `test/duration.test.js`:
   - Test `2d`.
   - Test `1h30m`.
   - Test a unit out of order, `30m1h`.
   - Test a repeated unit, `1h1h`.
   - For `30m1h` and `1h1h`, check the error message.
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

- [ ] `parseDuration('1h30m')` returns 5400000.
- [ ] `parseDuration('2d')` returns 172800000.
- [ ] `parseDuration('90s')` returns 90000, as before.
- [ ] `parseDuration('30m1h')` throws an `Error`.
- [ ] The message of the `Error` for `30m1h` is `invalid duration: 30m1h`.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Add no other units, such as weeks or milliseconds.
- Add no decimal numbers, such as `1.5h`.
- Leave `package.json` unchanged.
