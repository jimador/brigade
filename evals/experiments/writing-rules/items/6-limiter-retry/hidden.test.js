// Hidden test for item 6: the limiter reads a window string and says when to retry.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRateLimiter } = require('../src/rate-limiter.js')

test('window takes a duration string', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 1, window: '5m', now: () => time })
  assert.equal(limiter.allow('alex'), true)
  assert.equal(limiter.allow('alex'), false)
  assert.equal(limiter.retryAfterMs('alex'), 300000)
})

test('retryAfterMs is 0 when a call would pass, else the time left in the window', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 2, window: '1s', now: () => time })
  assert.equal(limiter.retryAfterMs('alex'), 0)
  assert.equal(limiter.allow('alex'), true)
  assert.equal(limiter.retryAfterMs('alex'), 0)
  assert.equal(limiter.allow('alex'), true)
  time = 400
  assert.equal(limiter.retryAfterMs('alex'), 600)
  assert.equal(limiter.allow('alex'), false)
  assert.equal(limiter.retryAfterMs('alex'), 600)
  time = 1000
  assert.equal(limiter.retryAfterMs('alex'), 0)
  assert.equal(limiter.allow('alex'), true)
})

test('retryAfterMs neither records a call nor starts a window', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time })
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.retryAfterMs('acme'), 0)
  time = 500
  assert.equal(limiter.allow('acme'), true)
  time = 1400
  assert.equal(limiter.allow('acme'), false)
  assert.equal(limiter.retryAfterMs('acme'), 100)
})

test('exactly one of window and windowMs must be given', () => {
  const message = 'give exactly one of window and windowMs'
  assert.throws(() => createRateLimiter({ limit: 1, window: '1s', windowMs: 1000 }), { message })
  assert.throws(() => createRateLimiter({ limit: 1 }), { message })
  assert.throws(() => createRateLimiter({ limit: 1, window: '5w' }), {
    message: 'invalid duration: 5w',
  })
})
