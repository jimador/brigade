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

`parseDuration` reads a duration such as `90s`, `2d` or `1h30m` and returns milliseconds.

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
2. **Implement:** create `test/parse-duration.contract.test.js`. First write the contract of the code above as a comment block at the top of the file: numbered clauses, `R1`… for requires (the inputs the code accepts and what it does outside them), `E1`… for ensures (what each call returns or changes), `I1`… for invariants (what a call leaves unchanged) and `L1`… for laws (such as idempotence, stability, a round-trip or a sum of parts). Read each clause from the code. Then write at least one test per clause, named with its id; for a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/parse-duration.contract.test.js
```

### Acceptance criteria

- [ ] The file opens with the numbered contract, and every clause id names at least one test
- [ ] `node --test test/parse-duration.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
