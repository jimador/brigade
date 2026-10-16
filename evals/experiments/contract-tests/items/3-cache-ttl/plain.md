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

`now` is the clock (milliseconds), which tests replace with a fake one. With `ttlMs` given, an entry expires once `ttlMs` milliseconds have passed since it was last set: a read before that returns the value, and a read at or after that returns `undefined` and removes the entry, so `size` drops. Setting a key again restarts its time; reading it does not. `ttlMs: 0` means every entry has expired by its first read. Without `ttlMs`, entries never expire, however much time passes. The least-recently-used eviction at `maxEntries` works as before.

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
2. **Implement:** create `test/cache-ttl.contract.test.js` with tests for the behavior described above. Name the cases; include at least one adversarial/edge case (malformed input, empty/null boundary, error path), not just the happy path.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/cache-ttl.contract.test.js
```

### Acceptance criteria

- [ ] New tests cover the behavior incl. one adversarial case
- [ ] `node --test test/cache-ttl.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
