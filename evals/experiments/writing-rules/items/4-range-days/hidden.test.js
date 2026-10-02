// Hidden test for item 4: countDays and eachDay count both ends of a range.
// A time zone west of UTC makes local-time getters land on the wrong day.
process.env.TZ = 'America/Los_Angeles'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseRange, countDays, eachDay } = require('../src/date-range.js')

test('countDays counts both the start and the end day', () => {
  assert.equal(countDays(parseRange('2026-03-01..2026-03-05')), 5)
  assert.equal(countDays(parseRange('2026-03-01..2026-03-01')), 1)
  assert.equal(countDays(parseRange('2025-12-31..2026-01-01')), 2)
})

test('eachDay lists every day in order, both ends included', () => {
  assert.deepEqual(eachDay(parseRange('2026-02-27..2026-03-02')), [
    '2026-02-27',
    '2026-02-28',
    '2026-03-01',
    '2026-03-02',
  ])
  assert.deepEqual(eachDay(parseRange('2026-03-01..2026-03-01')), ['2026-03-01'])
})

test('neither function moves the range', () => {
  const range = parseRange('2026-03-01..2026-03-05')
  eachDay(range)
  countDays(range)
  assert.equal(range.start.toISOString(), '2026-03-01T00:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-03-05T00:00:00.000Z')
})
