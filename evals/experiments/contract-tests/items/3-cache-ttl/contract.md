# Packet: cache-ttl-tests — test the cache's time to live

- **files:** the ONLY files you may touch
  - test/cache-ttl.contract.test.js (create)

### Goal

The cache in `src/cache.js` gained a time to live (`ttlMs`) but has no tests for it. Add a test file that would catch a regression in it, because pages read prices through this cache and a stale entry shows a wrong price.

### Contracts you code against

```js
// src/cache.js
createCache({ maxEntries: number, ttlMs?: number, now?: () => number }): {
  get(key): value | undefined, set(key, value): void, readonly size: number }
module.exports = { createCache }
```

Contract of the cache, with `now` as the clock in milliseconds (tests pass a fake one) and `age(k)` for `now()` minus the time of the last `set(k)`:

- **E1 ensures:** with `ttlMs` given, `get(k)` returns the stored value while `age(k) < ttlMs`.
- **E2 ensures:** with `ttlMs` given, `get(k)` returns `undefined` once `age(k) >= ttlMs`, and that read removes the entry, so `size` drops by one.
- **E3 ensures:** with `ttlMs: 0`, every entry has expired by its first read.
- **E4 ensures:** without `ttlMs`, an entry never expires, for any `age(k)`.
- **I1 invariant:** `set(k, v)` restarts `age(k)` at 0; `get(k)` never changes `age(k)`.
- **I2 invariant:** least-recently-used eviction at `maxEntries` works as before.

### Current behavior (pasted anchors)

```js
// src/cache.js
function createCache({ maxEntries, ttlMs, now = Date.now }) {
  const entries = new Map()

  return {
    get(key) {
      if (!entries.has(key)) return undefined
      const entry = entries.get(key)
      entries.delete(key)
      if (ttlMs !== undefined && now() - entry.setAt >= ttlMs) return undefined
      // Re-insert so the Map's insertion order doubles as the recency order.
      entries.set(key, entry)
      return entry.value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, { value, setAt: now() })
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
```

### Steps

1. **Explore (read-only, 2 files):** read `src/cache.js` and `test/cache.test.js`; if the source doesn't match what's pasted above, stop and report the difference in your final message.
2. **Implement:** create `test/cache-ttl.contract.test.js` with at least one test per clause above (`E1`–`E4`, `I1`, `I2`), each test named after its clause id. For a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/cache-ttl.contract.test.js
```

### Acceptance criteria

- [ ] Every clause id `E1`–`E4`, `I1`, `I2` names at least one test
- [ ] `node --test test/cache-ttl.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
