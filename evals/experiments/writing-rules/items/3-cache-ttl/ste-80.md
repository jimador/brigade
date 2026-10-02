# Packet: cache-ttl

- **files:** Change only the files in this list.
  - `src/cache.js` (edit)
  - `test/cache.test.js` (edit)

### Goal

The function `createCache` takes an optional option `ttlMs`.
With `ttlMs`, each entry expires a fixed time after the entry was stored.
Then the session cache returns no stale values.
Without `ttlMs`, the cache behaves exactly as today.

### Contracts you code against

```js
// src/cache.js after this change
createCache({ maxEntries: number, ttlMs?: number, now?: () => number })
// returns { get(key), set(key, value), size }  (size is a getter, as today)
```

- The option `now` is the clock, in milliseconds.
- If `now` is undefined, the clock MUST be `Date.now`.
- The tests give a fake clock as `now`.
- The set time of an entry is the value of `now()` at the last `set` of the key.
- `set` MUST record the set time of the entry.
- A second `set` of the same key MUST restart the set time.
- An entry MUST be expired when `now() - setTime >= ttlMs`.
- For example, with `ttlMs: 1000`, an entry from a `set` at 0 is live at 999.
- The same entry is expired at 1000.
- For an expired entry, `get` MUST return `undefined`.
- For an expired entry, `get` MUST remove the entry, so `size` decreases by one.
- For a live entry, `get` MUST NOT restart the set time.
- For a live entry, `get` MUST still count as a use for the least-recently-used order.
- `size` MUST count the stored entries.
- `size` MUST include expired entries that no `get` has removed yet.
- If `ttlMs` is undefined, entries MUST NOT expire.
- The eviction by `maxEntries` MUST work as today.

### Current behavior (pasted anchors)

```js
// src/cache.js
function createCache({ maxEntries }) {
  const entries = new Map()

  return {
    get(key) {
      if (!entries.has(key)) return undefined
      const value = entries.get(key)
      // Re-insert so the Map's insertion order doubles as the recency order.
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, value)
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        entries.delete(oldest)
      }
    },
    get size() {
      return entries.size
    },
  }
}

module.exports = { createCache }
```

### Steps

1. **Explore (read-only, 2 files):**
   - Read `src/cache.js` and `test/cache.test.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - Add the options `ttlMs` and `now` to `createCache` in `src/cache.js`.
   - Store the set time of each entry next to the value of the entry.
   - Expire entries only inside `get`.
   - Do not add a timer or a background sweep for expired entries.
   - Keep the comment above `createCache` accurate.
   - Export only `createCache`.
3. **Implement:** Add these cases to `test/cache.test.js`, with a fake clock:
   - With `ttlMs: 1000`, test that an entry is live at 999.
   - With `ttlMs: 1000`, test that the entry is expired at 1000.
   - Test `size` after a `get` of an expired entry.
   - Test that a second `set` restarts the set time.
   - Test that no entry expires without `ttlMs`.
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

- [ ] With `ttlMs: 1000` and a fake clock, `get` at 999 returns an entry from a `set` at 0.
- [ ] `get` at 1000 returns `undefined` for the same entry.
- [ ] After the `get` at 1000, `size` is 0.
- [ ] Without `ttlMs`, `get` returns the entry after the clock moves forward by 10^12.
- [ ] The existing eviction test passes.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Add no time-to-live for each entry.
- Add no timer that removes expired entries.
- Leave `package.json` unchanged.
