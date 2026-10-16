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
2. **Implement:** create `test/retry-after.contract.test.js` with tests for the code above. Name the cases; include at least one adversarial/edge case (malformed input, empty/null boundary, error path), not just the happy path.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/retry-after.contract.test.js
```

### Acceptance criteria

- [ ] New tests cover the behavior incl. one adversarial case
- [ ] `node --test test/retry-after.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
