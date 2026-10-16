// The kit's own complete test for parseDuration. Never shown to an agent.
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDuration } = require('../src/duration.js')

test('single and compound durations add up', () => {
  assert.equal(parseDuration('2d'), 2 * 86400000)
  assert.equal(parseDuration('1h30m'), parseDuration('1h') + parseDuration('30m'))
  assert.equal(parseDuration('1d2h3m4s'), 86400000 + 7200000 + 180000 + 4000)
  assert.equal(parseDuration(' 5m '), 300000)
})

test('rejects what is not a duration', () => {
  for (const bad of ['', '   ', '30m1h', '1h2h', '1.5h', '5w']) {
    assert.throws(() => parseDuration(bad), { message: `invalid duration: ${bad}` })
  }
})
