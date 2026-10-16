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

With `ttlMs` set, cache entries expire; `now` is the clock, which tests replace with a fake one.

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
2. **Implement:** create `test/cache-ttl.contract.test.js`. First write the contract of the code above as a comment block at the top of the file: numbered clauses, `R1`… for requires (the inputs the code accepts and what it does outside them), `E1`… for ensures (what each call returns or changes), `I1`… for invariants (what a call leaves unchanged) and `L1`… for laws (such as idempotence, stability, a round-trip or a sum of parts). Read each clause from the code. Then write at least one test per clause, named with its id; for a requires clause, test inputs on both sides of its boundary.
3. **Verify (must pass):** run this from the repo root, fix the tests and rerun until it exits 0.

```bash
node --test test/cache-ttl.contract.test.js
```

### Acceptance criteria

- [ ] The file opens with the numbered contract, and every clause id names at least one test
- [ ] `node --test test/cache-ttl.contract.test.js` exits 0

### Conventions

CommonJS (`require`), tests on `node:test` with `node:assert/strict` like the existing ones.

### Out of scope

Every other file. Do not change `src/`; the code is correct, and this packet only adds tests.
