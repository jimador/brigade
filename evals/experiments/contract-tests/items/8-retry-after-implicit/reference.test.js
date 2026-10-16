// The kit's own complete test for retryAfterMs. Never shown to an agent.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRateLimiter } = require('../src/rate-limiter.js')

test('the wait is exact', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time })
  assert.equal(limiter.retryAfterMs('alex'), 0)
  limiter.allow('alex')
  assert.equal(limiter.retryAfterMs('alex'), 0)
  limiter.allow('alex')
  time = 300
  assert.equal(limiter.retryAfterMs('alex'), 700)
  time = 999
  assert.equal(limiter.allow('alex'), false)
  time = 1000
  assert.equal(limiter.retryAfterMs('alex'), 0)
})

test('asking changes nothing and keys are separate', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time })
  limiter.retryAfterMs('alex')
  time = 500
  assert.equal(limiter.retryAfterMs('alex'), 0)
  assert.equal(limiter.allow('alex'), true)
  time = 1100
  assert.equal(limiter.allow('alex'), false)
  limiter.allow('acme')
  time = 1200
  assert.equal(limiter.retryAfterMs('alex'), 300)
})

test('takes exactly one of window and windowMs', () => {
  assert.throws(() => createRateLimiter({ limit: 1, window: '1s', windowMs: 1000 }))
  assert.throws(() => createRateLimiter({ limit: 1 }))
})
