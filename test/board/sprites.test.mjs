// Checks the sprite sheet's shape and the small rules that pick a sprite's size, name and colour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPRITES, SIZES, sizeOf, rosterName, colorOf } from '../../hooks/board/lib/sprites.mjs'

const ORDER = ['s', 'm', 'l', 'xl']

test('every size has a sprite with two frames', () => {
  assert.deepEqual(Object.keys(SPRITES).sort(), [...ORDER].sort())
  assert.deepEqual(Object.keys(SIZES).sort(), [...ORDER].sort())
  for (const size of ORDER) assert.equal(SPRITES[size].length, 2, size)
})

for (const size of ORDER) {
  test(`size ${size}: every frame matches its declared box and is symmetric`, () => {
    const { w, h } = SIZES[size]
    SPRITES[size].forEach((frame, f) => {
      assert.equal(frame.length, h * 2, `${size} frame ${f} row count`)
      frame.forEach((row, r) => {
        const where = `${size} frame ${f} row ${r}`
        assert.equal(row.length, w, `${where} width`)
        assert.match(row, /^[#.]+$/, `${where} characters`)
        assert.equal(row, [...row].reverse().join(''), `${where} symmetry`)
      })
    })
  })

  test(`size ${size}: the two frames differ`, () => {
    assert.notDeepEqual(SPRITES[size][0], SPRITES[size][1])
  })
}

test('sizes grow strictly from s to xl', () => {
  assert.ok(SIZES.s.w < SIZES.m.w && SIZES.m.w < SIZES.l.w && SIZES.l.w < SIZES.xl.w)
})

test('sizeOf picks the size from the model id', () => {
  assert.equal(sizeOf('claude-haiku-4-5-20251001'), 's')
  assert.equal(sizeOf('claude-sonnet-5-5'), 'm')
  assert.equal(sizeOf('claude-opus-5-5'), 'l')
  assert.equal(sizeOf('claude-fable-5-1'), 'xl')
  assert.equal(sizeOf('Claude-OPUS-x'), 'l')
  assert.equal(sizeOf(undefined), 'm')
})

test('rosterName wraps the names with a round number', () => {
  assert.equal(rosterName(0), 'Basil')
  assert.equal(rosterName(12), 'Basil 2')
  assert.equal(rosterName(25), 'Sage 3')
})

test('colorOf follows state first, then role', () => {
  assert.equal(colorOf('cook', 'failed'), '#ff3b30')
  assert.equal(colorOf('nobody', 'working'), '#e8e6d9')
})
