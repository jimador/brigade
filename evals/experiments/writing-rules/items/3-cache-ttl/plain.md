# Packet: cache-ttl — cache entries expire after ttlMs

- **files:** the ONLY files you may touch
  - src/cache.js (edit)
  - test/cache.test.js (edit)

### Goal

`createCache` takes an optional `ttlMs` so entries expire a fixed time after they were stored and the session cache stops serving stale values; without `ttlMs` the cache behaves exactly as it does today.

### Contracts you code against

```js
// src/cache.js after this change
createCache({ maxEntries: number, ttlMs?: number, now?: () => number })
// returns { get(key), set(key, value), size }  (size is a getter, as today)
```

`now` is the clock in milliseconds and defaults to `Date.now` (tests pass a fake clock). `set` records `now()` as the entry's set time, and setting a key again restarts that time; an entry is expired once `now() - setTime >= ttlMs`, so with `ttlMs: 1000` an entry set at 0 is live at 999 and expired at 1000. `get` on an expired entry returns `undefined` and removes the entry, so `size` drops by one; `get` on a live entry does not restart its time but still counts as a use for the least-recently-used order. `size` counts the stored entries, including expired ones that no `get` has removed yet. With `ttlMs` undefined nothing ever expires, and eviction by `maxEntries` works as today.

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

1. **Explore (read-only, 2 files):** read `src/cache.js` and `test/cache.test.js`; if either doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** add `ttlMs` and `now` to `createCache` in `src/cache.js`, store each entry's set time next to its value, and expire entries only inside `get` (no timer or background sweep); keep the comment above the function accurate and export only `createCache`.
3. **Implement:** add cases to `test/cache.test.js` with a fake clock: live at 999 and expired at 1000 for `ttlMs: 1000`, `size` after reading an expired entry, a second `set` restarting the time, and no expiry without `ttlMs`.
4. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] With `ttlMs: 1000` and a fake clock, an entry set at 0 is returned by `get` at 999
- [ ] The same entry gives `undefined` from `get` at 1000, and `size` is 0 afterwards
- [ ] Without `ttlMs`, an entry is still returned after the clock moves forward by 10^12
- [ ] The existing eviction test still passes
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file, a time-to-live per entry, a timer that sweeps expired entries, and `package.json`.
