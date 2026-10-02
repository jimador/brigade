# Packet: limiter-retry — window strings and retryAfterMs for the rate limiter

- **files:** the ONLY files you may touch
  - src/rate-limiter.js (edit)
  - test/rate-limiter.test.js (edit)
  - src/duration.js (read only, do not edit)

### Goal

`createRateLimiter` accepts its window as a duration string (`window: '5m'`) as well as `windowMs`, and gains `retryAfterMs(key)` so the login handler can tell a blocked caller how long to wait; `allow` behaves exactly as it does today.

### Contracts you code against

```js
// src/rate-limiter.js after this change
createRateLimiter({ limit: number, window?: string, windowMs?: number, now?: () => number })
// returns { allow(key): boolean, retryAfterMs(key): number }

// src/duration.js, already there (do not change it)
parseDuration(text: string): number // '90s' -> 90000, '5m' -> 300000, '2h' -> 7200000
// throws new Error('invalid duration: ' + text) for anything else
```

Exactly one of `window` and `windowMs` must be given: when both or neither are, `createRateLimiter` itself throws `new Error('give exactly one of window and windowMs')`. `window` is read with `parseDuration` from `./duration.js`, so the window length is `windowMs` or `parseDuration(window)`, and an invalid string lets `parseDuration`'s error through unchanged (`window: '5w'` throws `invalid duration: 5w`). `retryAfterMs(key)` returns 0 when the next `allow(key)` would return true, and otherwise the milliseconds until the key's current window ends (`windowStart + windowLength - now()`); a window has ended once `now() - windowStart >= windowLength`, the same rule `allow` uses. `retryAfterMs` only looks: it records no call and starts no window, and a key that was never seen gives 0. Example, with `limit: 2`, `window: '1s'` and a fake clock: two `allow('alex')` calls at 0 return true, `retryAfterMs('alex')` at 400 returns 600, and at 1000 it returns 0 and `allow('alex')` returns true again.

### Current behavior (pasted anchors)

```js
// src/rate-limiter.js
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map()

  return {
    // Records one call for the key and says whether the call is allowed.
    allow(key) {
      const time = now()
      let current = windows.get(key)
      if (!current || time - current.start >= windowMs) {
        current = { start: time, count: 0 }
        windows.set(key, current)
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
  }
}

module.exports = { createRateLimiter }
```

### Steps

1. **Explore (read-only, 3 files):** read `src/rate-limiter.js`, `test/rate-limiter.test.js` and `src/duration.js`; if any of them doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** in `src/rate-limiter.js`, require `parseDuration` from `./duration.js`, add the `window` option with the exactly-one check, and update the comment above `createRateLimiter`.
3. **Implement:** add `retryAfterMs(key)` to the returned object with a short comment, keeping `allow` unchanged in behaviour, and export only `createRateLimiter`.
4. **Implement:** add cases to `test/rate-limiter.test.js` for a `window` string, the error when both or neither option is given, the example above (600 at 400, then 0 at 1000), and `retryAfterMs` not using up a call.
5. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] `createRateLimiter({ limit: 1 })` throws an `Error` with the message `give exactly one of window and windowMs`
- [ ] With `limit: 1` and `window: '5m'`, after one `allow` at time 0, `retryAfterMs` at time 0 returns 300000
- [ ] In the example above, `retryAfterMs('alex')` returns 600 at time 400 and 0 at time 1000
- [ ] `retryAfterMs` for a key that was never seen returns 0
- [ ] The existing rate limiter test still passes
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file (including `src/duration.js`), a sliding window or any other limiting rule, and `package.json`.
