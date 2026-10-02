// Hidden test for item 3: cache entries expire after ttlMs.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCache } = require('../src/cache.js')

test('an entry expires exactly ttlMs after its set', () => {
  let time = 0
  const cache = createCache({ maxEntries: 5, ttlMs: 1000, now: () => time })
  cache.set('a', 1)
  time = 999
  assert.equal(cache.get('a'), 1)
  time = 1000
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.size, 0)
})

test('setting a key again restarts its time, reading it does not', () => {
  let time = 0
  const cache = createCache({ maxEntries: 5, ttlMs: 1000, now: () => time })
  cache.set('b', 1)
  cache.set('c', 1)
  time = 500
  assert.equal(cache.get('c'), 1)
  time = 600
  cache.set('b', 2)
  time = 1000
  assert.equal(cache.get('c'), undefined)
  time = 1500
  assert.equal(cache.get('b'), 2)
  time = 1600
  assert.equal(cache.get('b'), undefined)
})

test('size counts expired entries until a get removes them', () => {
  let time = 0
  const cache = createCache({ maxEntries: 5, ttlMs: 1000, now: () => time })
  cache.set('d', 1)
  cache.set('e', 1)
  time = 2000
  assert.equal(cache.size, 2)
  assert.equal(cache.get('d'), undefined)
  assert.equal(cache.size, 1)
})

test('without ttlMs nothing expires, and eviction still works', () => {
  let time = 0
  const cache = createCache({ maxEntries: 2, now: () => time })
  cache.set('a', 1)
  cache.set('b', 2)
  time = 1e12
  cache.get('a')
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('c'), 3)
})

test('the clock defaults to Date.now', () => {
  const cache = createCache({ maxEntries: 2, ttlMs: 60000 })
  cache.set('x', 'kept')
  assert.equal(cache.get('x'), 'kept')
})
