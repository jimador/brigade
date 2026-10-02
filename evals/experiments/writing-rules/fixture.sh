#!/usr/bin/env bash
# Fixture for the writing-rules experiment: a small plain-JavaScript library,
# acme-utils, with six modules and a passing test suite. Run it in an empty folder;
# it builds the repo there and makes one commit. It needs only git and node.
set -euo pipefail

git -c init.defaultBranch=main init -q .
mkdir -p src test

cat > package.json <<'JSON'
{
  "name": "acme-utils",
  "version": "0.1.0",
  "private": true,
  "scripts": { "test": "node --test" }
}
JSON

cat > README.md <<'MD'
# acme-utils

Small helpers for the acme web app. Plain JavaScript, no dependencies.
Run the tests with `node --test` from the repo root.
MD

cat > src/slug.js <<'JS'
// Turns a title into a URL slug: lower-case letters and digits, with every run of
// other characters replaced by one dash. Leading and trailing dashes are dropped.
function slugify(title) {
  return String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .join('-')
}

module.exports = { slugify }
JS

cat > src/duration.js <<'JS'
// Reads a duration such as "90s", "5m" or "2h" and returns it in milliseconds.
// Anything else throws, so a typo in a config value fails loudly.
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 }

function parseDuration(text) {
  const match = /^(\d+)(s|m|h)$/.exec(String(text).trim())
  if (!match) throw new Error(`invalid duration: ${text}`)
  return Number(match[1]) * UNIT_MS[match[2]]
}

module.exports = { parseDuration }
JS

cat > src/cache.js <<'JS'
// A small in-memory cache that keeps at most maxEntries values. When it is full,
// the least recently used entry goes first. Reading a value counts as a use.
function createCache({ maxEntries }) {
  const entries = new Map()

  return {
    get(key) {
      if (!entries.has(key)) return undefined
      const value = entries.get(key)
      // Re-insert so the Map's insertion order doubles as the recency order.
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, value)
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

module.exports = { createCache }
JS

cat > src/date-range.js <<'JS'
// Reads a date range written as "YYYY-MM-DD..YYYY-MM-DD". Both ends are calendar
// days, returned as Date objects at midnight UTC, and the end may equal the start.
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDay(text) {
  const match = DAY_PATTERN.exec(text)
  if (!match) throw new Error(`invalid date: ${text}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC rolls 2026-02-30 over to March, so check nothing rolled.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid date: ${text}`)
  }
  return date
}

function parseRange(text) {
  const parts = String(text).split('..')
  if (parts.length !== 2) throw new Error(`invalid range: ${text}`)
  const start = parseDay(parts[0])
  const end = parseDay(parts[1])
  if (end < start) throw new Error(`range ends before it starts: ${text}`)
  return { start, end }
}

module.exports = { parseRange }
JS

cat > src/tasks.js <<'JS'
// Helpers for a to-do list. A task looks like this:
//   { id: 't1', title: 'Send invoice', priority: 'high', due: '2026-03-01', done: false }
// priority is always 'high', 'normal' or 'low'. due is a YYYY-MM-DD string, or
// missing when the task has no due date.
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 }

// Returns the tasks that are not done yet, in the order given.
function openTasks(tasks) {
  return tasks.filter((task) => !task.done)
}

module.exports = { PRIORITY_RANK, openTasks }
JS

cat > src/rate-limiter.js <<'JS'
// A fixed-window rate limiter. Each key may make `limit` calls per window of
// `windowMs` milliseconds; the window starts at the key's first call. `now` is the
// clock, which tests replace with a fake one.
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map()

  return {
    // Records one call for the key and says whether the call is allowed.
    allow(key) {
      const time = now()
      let current = windows.get(key)
      if (!current || time - current.start >= windowMs) {
        current = { start: time, count: 0 }
        windows.set(key, current)
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
  }
}

module.exports = { createRateLimiter }
JS

cat > test/slug.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { slugify } = require('../src/slug.js')

test('slugify lower-cases and joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
})

test('slugify drops punctuation at the ends', () => {
  assert.equal(slugify('  -- Release notes: v2! --'), 'release-notes-v2')
})
JS

cat > test/duration.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDuration } = require('../src/duration.js')

test('parseDuration reads seconds, minutes and hours', () => {
  assert.equal(parseDuration('90s'), 90000)
  assert.equal(parseDuration('5m'), 300000)
  assert.equal(parseDuration('2h'), 7200000)
})

test('parseDuration rejects an unknown unit', () => {
  assert.throws(() => parseDuration('5w'), { message: 'invalid duration: 5w' })
})
JS

cat > test/cache.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCache } = require('../src/cache.js')

test('cache returns what was stored', () => {
  const cache = createCache({ maxEntries: 2 })
  cache.set('a', 1)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('missing'), undefined)
})

test('cache evicts the least recently used entry', () => {
  const cache = createCache({ maxEntries: 2 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a')
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.size, 2)
})
JS

cat > test/date-range.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseRange } = require('../src/date-range.js')

test('parseRange returns both ends at midnight UTC', () => {
  const range = parseRange('2026-03-01..2026-03-05')
  assert.equal(range.start.toISOString(), '2026-03-01T00:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-03-05T00:00:00.000Z')
})

test('parseRange rejects a range that ends before it starts', () => {
  assert.throws(() => parseRange('2026-03-05..2026-03-01'), /ends before it starts/)
})

test('parseRange rejects a day that does not exist', () => {
  assert.throws(() => parseRange('2026-02-30..2026-03-01'), /invalid date/)
})
JS

cat > test/tasks.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { openTasks } = require('../src/tasks.js')

test('openTasks keeps the tasks that are not done, in order', () => {
  const tasks = [
    { id: 't1', title: 'Send invoice', priority: 'high', done: false },
    { id: 't2', title: 'File receipts', priority: 'low', done: true },
    { id: 't3', title: 'Call alex', priority: 'normal', done: false },
  ]
  assert.deepEqual(openTasks(tasks).map((task) => task.id), ['t1', 't3'])
})
JS

cat > test/rate-limiter.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRateLimiter } = require('../src/rate-limiter.js')

test('rate limiter allows `limit` calls per window, per key', () => {
  let time = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time })
  assert.equal(limiter.allow('alex'), true)
  assert.equal(limiter.allow('alex'), true)
  assert.equal(limiter.allow('alex'), false)
  assert.equal(limiter.allow('acme'), true)
  time = 1000
  assert.equal(limiter.allow('alex'), true)
})
JS

git add -A
git -c user.name=alex -c user.email=alex@example.com commit -qm "acme-utils fixture"
