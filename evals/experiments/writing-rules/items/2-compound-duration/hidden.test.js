// Hidden test for item 2: parseDuration reads days and compound durations.
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDuration } = require('../src/duration.js')

test('single units still work, and d means days', () => {
  assert.equal(parseDuration('90s'), 90000)
  assert.equal(parseDuration('5m'), 300000)
  assert.equal(parseDuration('2h'), 7200000)
  assert.equal(parseDuration('2d'), 172800000)
})

test('a compound duration is the sum of its parts', () => {
  assert.equal(parseDuration('1h30m'), 5400000)
  assert.equal(parseDuration('1d2h3m4s'), 93784000)
  assert.equal(parseDuration(' 1h30m '), 5400000)
})

test('bad durations throw with the text as given', () => {
  for (const text of ['30m1h', '1h1h', '1h30', '', '1h 30m', '5w']) {
    assert.throws(() => parseDuration(text), { message: `invalid duration: ${text}` })
  }
})
