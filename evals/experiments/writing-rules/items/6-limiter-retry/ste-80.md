# Packet: limiter-retry

- **files:** Change only the files in this list.
  - `src/rate-limiter.js` (edit)
  - `test/rate-limiter.test.js` (edit)
  - `src/duration.js` (read only, do not edit)

### Goal

The function `createRateLimiter` accepts the window as a duration string, such as `window: '5m'`.
The option `windowMs` stays available.
The rate limiter gets a new method, `retryAfterMs(key)`.
The login handler then tells a blocked caller the time to wait.
The method `allow` behaves exactly as today.

### Contracts you code against

```js
// src/rate-limiter.js after this change
createRateLimiter({ limit: number, window?: string, windowMs?: number, now?: () => number })
// returns { allow(key): boolean, retryAfterMs(key): number }

// src/duration.js, already there (do not change it)
parseDuration(text: string): number // '90s' -> 90000, '5m' -> 300000, '2h' -> 7200000
// throws new Error('invalid duration: ' + text) for anything else
```

- The caller MUST give exactly one of the options `window` and `windowMs`.
- If the caller gives both options, `createRateLimiter` MUST throw `new Error('give exactly one of window and windowMs')`.
- If the caller gives neither option, `createRateLimiter` MUST throw the same error.
- `createRateLimiter` MUST read `window` with `parseDuration` from `./duration.js`.
- If `window` is an invalid string, the error from `parseDuration` MUST pass through unchanged.
- For example, `window: '5w'` throws `invalid duration: 5w`.
- The window length is the value of `windowMs`, or the result of `parseDuration(window)`.
- A window has ended when `now() - windowStart >= windowLength`.
- `allow` uses the same rule.
- If the next `allow(key)` returns true, `retryAfterMs(key)` MUST return 0.
- Otherwise, `retryAfterMs(key)` MUST return the milliseconds until the current window of the key ends.
- The formula is `windowStart + windowLength - now()`.
- `retryAfterMs` MUST NOT record a call.
- `retryAfterMs` MUST NOT start a window.
- For a key with no earlier call, `retryAfterMs` MUST return 0.
- Example, with `limit: 2`, `window: '1s'` and a fake clock:
  - Two calls of `allow('alex')` at time 0 return true.
  - At time 400, `retryAfterMs('alex')` returns 600.
  - At time 1000, `retryAfterMs('alex')` returns 0.
  - At time 1000, `allow('alex')` returns true again.

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

1. **Explore (read-only, 3 files):**
   - Read `src/rate-limiter.js`, `test/rate-limiter.test.js` and `src/duration.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - In `src/rate-limiter.js`, import `parseDuration` from `./duration.js` with `require`.
   - Add the option `window` to `createRateLimiter`.
   - Add the check for exactly one window option.
   - Update the comment above `createRateLimiter`.
3. **Implement:**
   - Add the method `retryAfterMs(key)` to the returned object.
   - Write a short comment above `retryAfterMs`.
   - Keep the behavior of `allow` unchanged.
   - Export only `createRateLimiter`.
4. **Implement:** Add these cases to `test/rate-limiter.test.js`:
   - Test a `window` string.
   - Test the error when the caller gives both window options.
   - Test the error when the caller gives neither window option.
   - Test the example above: 600 at time 400, then 0 at time 1000.
   - Test that `retryAfterMs` does not use up a call.
5. **Verify (must pass):**
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

- [ ] `createRateLimiter({ limit: 1 })` throws an `Error`.
- [ ] The message of the `Error` is `give exactly one of window and windowMs`.
- [ ] With `limit: 1` and `window: '5m'`, after one `allow` at time 0, `retryAfterMs` at time 0 returns 300000.
- [ ] In the example above, `retryAfterMs('alex')` returns 600 at time 400.
- [ ] In the example above, `retryAfterMs('alex')` returns 0 at time 1000.
- [ ] For a key with no earlier call, `retryAfterMs` returns 0.
- [ ] The existing rate limiter test passes.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Leave `src/duration.js` unchanged.
- Add no sliding window and no other rule for the limit.
- Leave `package.json` unchanged.
