// Checks the weather reading and the fill bar against the board's contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forecast, gauge } from '../../hooks/board/lib/weather.mjs'

const NO_READING = { level: 0, label: 'NO READING', glyph: '·', percent: null }

test('each boundary lands on the right side', () => {
  const cases = [
    [24, 0, 'CLEAR', '☀'],
    [25, 1, 'CLOUDY', '☁'],
    [49, 1, 'CLOUDY', '☁'],
    [50, 2, 'SHOWERS', '☂'],
    [74, 2, 'SHOWERS', '☂'],
    [75, 3, 'STORM', '☇'],
    [89, 3, 'STORM', '☇'],
    [90, 4, 'COMPACT SOON', '↯'],
  ]
  for (const [percent, level, label, glyph] of cases) {
    assert.deepEqual(forecast({ window: 100, percent }), { level, label, glyph, percent })
  }
})

test('works the percent out from tokens and window', () => {
  assert.deepEqual(forecast({ tokens: 58000, window: 100000 }), {
    level: 2, label: 'SHOWERS', glyph: '☂', percent: 58,
  })
})

test('a zero window gives no reading', () => {
  assert.deepEqual(forecast({ window: 0, tokens: 5 }), NO_READING)
})

test('a percent over 100 is clamped to 100', () => {
  assert.deepEqual(forecast({ window: 100, percent: 140 }), {
    level: 4, label: 'COMPACT SOON', glyph: '↯', percent: 100,
  })
})

test('nothing at all gives no reading', () => {
  assert.deepEqual(forecast(undefined), NO_READING)
})

test('gauge fills the rounded share', () => {
  assert.equal(gauge(58, 10), '▰▰▰▰▰▰▱▱▱▱')
})

test('gauge with no reading is all hollow', () => {
  assert.equal(gauge(null, 4), '▱▱▱▱')
})

test('gauge narrower than one cell is empty', () => {
  assert.equal(gauge(50, 0), '')
})
