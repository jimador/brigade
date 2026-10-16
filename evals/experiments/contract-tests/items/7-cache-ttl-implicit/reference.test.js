// The kit's own complete test for the cache's time to live. Never shown to an agent.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCache } = require('../src/cache.js')

function clock() {
  let time = 0
  return { now: () => time, advance: (ms) => { time += ms } }
}

test('an entry expires exactly ttlMs after its last set', () => {
  const c = clock()
  const cache = createCache({ maxEntries: 5, ttlMs: 100, now: c.now })
  cache.set('a', 1)
  c.advance(99)
  assert.equal(cache.get('a'), 1)
  c.advance(1)
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.size, 0)
})

test('setting again restarts the time, reading does not', () => {
  const c = clock()
  const cache = createCache({ maxEntries: 5, ttlMs: 100, now: c.now })
  cache.set('a', 1)
  c.advance(60)
  cache.set('a', 2)
  c.advance(60)
  assert.equal(cache.get('a'), 2)
  cache.set('b', 1)
  c.advance(60)
  assert.equal(cache.get('b'), 1)
  c.advance(40)
  assert.equal(cache.get('b'), undefined)
})

test('ttlMs 0 expires at once and no ttlMs never expires', () => {
  const c = clock()
  const zero = createCache({ maxEntries: 5, ttlMs: 0, now: c.now })
  zero.set('a', 1)
  assert.equal(zero.get('a'), undefined)
  const forever = createCache({ maxEntries: 5, now: c.now })
  forever.set('a', 1)
  c.advance(10 * 365 * 86400000)
  assert.equal(forever.get('a'), 1)
})
