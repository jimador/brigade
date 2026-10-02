// Hidden test for item 1: slugify takes a separator option.
const test = require('node:test')
const assert = require('node:assert/strict')
const { slugify } = require('../src/slug.js')

test('the separator defaults to a dash', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
  assert.equal(slugify('Hello World', {}), 'hello-world')
  assert.equal(slugify('Hello World', { separator: undefined }), 'hello-world')
})

test('the separator joins the words', () => {
  assert.equal(slugify('  Release notes: v2! ', { separator: '_' }), 'release_notes_v2')
  assert.equal(slugify('Hello World', { separator: '--' }), 'hello--world')
})

test('a separator that is not a non-empty string throws a TypeError', () => {
  const expected = { name: 'TypeError', message: 'separator must be a non-empty string' }
  assert.throws(() => slugify('Hello World', { separator: '' }), expected)
  assert.throws(() => slugify('Hello World', { separator: 5 }), expected)
})
