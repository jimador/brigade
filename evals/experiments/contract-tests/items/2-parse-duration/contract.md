# Packet: parse-duration-tests — test parseDuration

- **files:** the ONLY files you may touch
  - test/parse-duration.contract.test.js (create)

### Goal

`parseDuration` in `src/duration.js` now reads compound durations but has no tests for them. Add a test file that would catch a regression in it, because config values such as a rate-limit window go through it and a typo must fail loudly instead of becoming a wrong number.

### Contracts you code against

```js
// src/duration.js
parseDuration(text: string): number   // milliseconds
module.exports = { parseDuration }
```

Contract of `parseDuration(text)`, with `t` for `String(text).trim()`:

- **R1 requires:** `t` is one or more parts `<digits><unit>`, with a whole number and a unit of `d`, `h`, `m` or `s`.
- **R2 requires:** the parts come in the order `d`, `h`, `m`, `s`, and each unit appears at most once.
- **R3 requires:** when R1 or R2 does not hold, including an empty `t`, the call throws an `Error` with message `` `invalid duration: ${text}` ``.
- **E1 ensures:** `1s` = 1000, `1m` = 60000, `1h` = 3600000, `1d` = 86400000.
- **E2 ensures:** spaces around `text` do not change the result.
- **L1 law (additivity):** a compound duration equals the sum of its parts read alone, e.g. `parseDuration('1h30m') === parseDuration('1h') + parseDuration('30m')`.

### Current behavior (pasted anchors)

```js
// src/duration.js
const UNIT_MS = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000, m: 60 * 1000, s: 1000 }
const PATTERN = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

function parseDuration(text) {
  const trimmed = String(text).trim()
  const match = PATTERN.exec(trimmed)
  // The pattern also matches the empty string, which is not a duration.
  if (!match || trimmed === '') throw new Error(`invalid duration: ${text}`)
  const units = ['d', 'h', 'm', 's']
  let total = 0
  units.forEach((unit, index) => {
    if (match[index + 1] !== undefined) total += Number(match[index + 1]) * UNIT_MS[unit]
  })
  return total
}
```

### Steps

1. **Explore (read-only, 2 files):** read `src/duration.js` and `test/duration.test.js`; if the source doesn't match what's pasted above, stop and report the difference in your final message.
2. **Implement:** create `test/parse-duration.contract.test.js` with at least one test per clause above (`R1`–`R3`, `E1`, `E2`, `L1`), each test named after its clause id. For a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/parse-duration.contract.test.js
```

### Acceptance criteria

- [ ] Every clause id `R1`–`R3`, `E1`, `E2`, `L1` names at least one test
- [ ] `node --test test/parse-duration.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
