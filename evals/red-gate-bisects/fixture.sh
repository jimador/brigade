#!/usr/bin/env bash
# Fixture: a dish whose four items have all landed on the delivery branch, one commit
# each, and whose full gate is now red. The item that broke it is currency-option: it
# makes formatPrice drop the cents when no currency is given. The last item to touch
# the same file, format-comments, only renames and comments, so a reader who blames the
# latest change to the failing file names the wrong item.
set -euo pipefail
git -c init.defaultBranch=main init -q .
mkdir -p .brigade/dishes/price-helpers src test
printf '.brigade/\n' >> .git/info/exclude
commit() { git add -A && git -c user.name=alex -c user.email=alex@example.com commit -qm "$1"; }

cat > package.json <<'JSON'
{ "name": "acme-shop", "version": "0.1.0", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/format.js <<'JS'
// Turns a price in cents into the text the shop shows, such as "$12.30".
function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2)
}

module.exports = { formatPrice }
JS
cat > test/format.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { formatPrice } = require('../src/format.js')

test('formatPrice shows dollars and cents', () => {
  assert.equal(formatPrice(1230), '$12.30')
  assert.equal(formatPrice(5), '$0.05')
})
JS
commit "acme-shop: price formatting"
git checkout -qb feat/price-helpers

cat > src/tax.js <<'JS'
// Adds sales tax to a price in cents, rounding to the nearest cent.
function addTax(cents, rate) {
  return Math.round(cents * (1 + rate))
}

module.exports = { addTax }
JS
cat > test/tax.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { addTax } = require('../src/tax.js')

test('addTax rounds to the nearest cent', () => {
  assert.equal(addTax(1000, 0.0825), 1083)
})
JS
commit "add-tax: addTax for sales tax"

cat > src/discount.js <<'JS'
// Takes a percentage off a price in cents. The price never goes below zero.
function applyDiscount(cents, percent) {
  return Math.max(0, Math.round(cents * (1 - percent / 100)))
}

module.exports = { applyDiscount }
JS
cat > test/discount.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { applyDiscount } = require('../src/discount.js')

test('applyDiscount takes the percentage off', () => {
  assert.equal(applyDiscount(2000, 15), 1700)
  assert.equal(applyDiscount(100, 150), 0)
})
JS
commit "add-discount: applyDiscount"

cat > src/format.js <<'JS'
// Turns a price in cents into the text the shop shows, such as "$12.30".
const SYMBOL = { USD: '$', JPY: '¥' }
const DECIMALS = { USD: 2, JPY: 0 }

function formatPrice(cents, currency) {
  const symbol = SYMBOL[currency] ?? '$'
  return symbol + (cents / 100).toFixed(DECIMALS[currency] ?? 0)
}

module.exports = { formatPrice }
JS
cat > test/format-currency.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert/strict')
const { formatPrice } = require('../src/format.js')

test('formatPrice takes a currency', () => {
  assert.equal(formatPrice(1230, 'USD'), '$12.30')
  assert.equal(formatPrice(123000, 'JPY'), '¥1230')
})
JS
commit "currency-option: formatPrice takes a currency"

cat > src/format.js <<'JS'
// Price formatting for the shop. Every price is an integer number of cents.
const SYMBOL = { USD: '$', JPY: '¥' }
// How many digits each currency shows after the decimal point.
const DECIMALS = { USD: 2, JPY: 0 }

// Turns a price in cents into the text the shop shows, such as "$12.30". The
// currency is a code from SYMBOL; leave it out for dollars.
function formatPrice(amountCents, currency) {
  const symbol = SYMBOL[currency] ?? '$'
  const units = amountCents / 100
  return symbol + units.toFixed(DECIMALS[currency] ?? 0)
}

module.exports = { formatPrice }
JS
commit "format-comments: name and comment the formatting code"

cat > .brigade/config.md <<'MD'
# Brigade config — acme-shop

## Source

- source: local
- transport: fs
- database_id: .brigade/board
- user: alex

## Repo

- main_branch: main
- tier: two-star
- verification_gate:
  - npm test
- test_convention: node --test files under test/
- remote_pr: false
MD

base=$(git rev-parse main)
range() { git log --format=%H --grep="^$1:" -1; }
cat > .brigade/dishes/price-helpers/PLAN.md <<MD
---
doc: plan
schema: 1
dish: price-helpers
role: planner
model: sonnet
created: 2026-10-01T09:00:00Z
ticket: price-helpers
ticket_url: null
delivery_branch: feat/price-helpers
source: local
tier: two-star
items:
  - { slug: add-tax, status: done, depends_on: [], heavy: false, files: [src/tax.js, test/tax.test.js], landedRange: "$base..$(range add-tax)" }
  - { slug: add-discount, status: done, depends_on: [], heavy: false, files: [src/discount.js, test/discount.test.js], landedRange: "$(range add-tax)..$(range add-discount)" }
  - { slug: currency-option, status: done, depends_on: [], heavy: false, files: [src/format.js, test/format-currency.test.js], landedRange: "$(range add-discount)..$(range currency-option)" }
  - { slug: format-comments, status: done, depends_on: [currency-option], heavy: false, files: [src/format.js], landedRange: "$(range currency-option)..$(range format-comments)" }
---

## Dish

Price helpers for acme-shop: tax, discounts, and a currency option for formatPrice.

## Waves

1. add-tax, add-discount, currency-option
2. format-comments
MD
