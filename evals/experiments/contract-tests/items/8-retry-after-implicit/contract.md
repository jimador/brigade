# Packet: retry-after-tests — test retryAfterMs

- **files:** the ONLY files you may touch
  - test/retry-after.contract.test.js (create)

### Goal

The rate limiter in `src/rate-limiter.js` gained `retryAfterMs(key)` but has no tests for it. Add a test file that would catch a regression in it, because the API sends its value as the `Retry-After` header and clients sleep exactly that long.

### Contracts you code against

```js
// src/rate-limiter.js
createRateLimiter({ limit: number, window?: string, windowMs?: number, now?: () => number }): {
  allow(key): boolean, retryAfterMs(key): number }
module.exports = { createRateLimiter }
```

`retryAfterMs(key)` says how long the key must wait before `allow(key)` would pass; `now` is the clock, which tests replace with a fake one.

### Current behavior (pasted anchors)

```js
// src/rate-limiter.js
function createRateLimiter({ limit, window, windowMs, now = Date.now }) {
  if ((window === undefined) === (windowMs === undefined)) {
    throw new Error('give exactly one of window and windowMs')
  }
  const lengthMs = window === undefined ? windowMs : parseDuration(window)
  const windows = new Map()

  // The key's window if it is still running at `time`, otherwise undefined.
  function liveWindow(key, time) {
    const current = windows.get(key)
    if (!current || time - current.start >= lengthMs) return undefined
    return current
  }

  return {
    // Records one call for the key and says whether the call is allowed.
    allow(key) {
      const time = now()
      let current = liveWindow(key, time)
      if (!current) {
        current = { start: time, count: 0 }
        windows.set(key, current)
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
    // How long the key must wait before allow() would pass: 0 when it would pass
    // now. It only looks; it records no call and starts no window.
    retryAfterMs(key) {
      const time = now()
      const current = liveWindow(key, time)
      if (!current || current.count < limit) return 0
      return current.start + lengthMs - time
    },
  }
}
```

### Steps

1. **Explore (read-only, 2 files):** read `src/rate-limiter.js` and `test/rate-limiter.test.js`; if the source doesn't match what's pasted above, stop and report the difference in your final message.
2. **Implement:** create `test/retry-after.contract.test.js`. First write the contract of the code above as a comment block at the top of the file: numbered clauses, `R1`… for requires (the inputs the code accepts and what it does outside them), `E1`… for ensures (what each call returns or changes), `I1`… for invariants (what a call leaves unchanged) and `L1`… for laws (such as idempotence, stability, a round-trip or a sum of parts). Read each clause from the code. Then write at least one test per clause, named with its id; for a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/retry-after.contract.test.js
```

### Acceptance criteria

- [ ] The file opens with the numbered contract, and every clause id names at least one test
- [ ] `node --test test/retry-after.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
