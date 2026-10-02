// Checks the sprite sheet's shape and the small rules that pick a sprite's size, name and colour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPRITES, SIZES, ROLES, NAMES, PALETTE, FAMILIES, CLOUD, sizeOf, rosterName, freeName, colorOf, familyOf } from '../../hooks/board/lib/sprites.mjs'

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

test('the four sizes are small enough for a crowded board: 5x2, 7x3, 9x3 and 11x4 cells', () => {
  assert.deepEqual(SIZES, { s: { w: 5, h: 2 }, m: { w: 7, h: 3 }, l: { w: 9, h: 3 }, xl: { w: 11, h: 4 } })
})

test('the sprites are the approved bitmaps', () => {
  assert.deepEqual(SPRITES.s, [
    ['.#.#.', '#####', '#.#.#', '#...#'],
    ['.#.#.', '#####', '#.#.#', '.#.#.'],
  ])
  assert.deepEqual(SPRITES.m, [
    ['.#...#.', '..###..', '.#####.', '##.#.##', '#######', '#.#.#.#'],
    ['.#...#.', '#.###.#', '#######', '##.#.##', '.#####.', '.#...#.'],
  ])
  assert.deepEqual(SPRITES.l, [
    ['..#...#..', '...#.#...', '.#######.', '##.###.##', '#########', '#.#...#.#'],
    ['..#...#..', '#..#.#..#', '#########', '##.###.##', '.#######.', '.#.....#.'],
  ])
  assert.deepEqual(SPRITES.xl, [
    ['...#...#...', '....#.#....', '..#######..', '.##.###.##.', '###########', '###########', '..##...##..', '.##.....##.'],
    ['...#...#...', '#...#.#...#', '#.#######.#', '###.###.###', '###########', '.#########.', '..##...##..', '...##.##...'],
  ])
})

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

test('freeName gives the first name nobody on the roster has', () => {
  assert.equal(freeName([]), 'Basil')
  assert.equal(freeName(['Basil']), 'Sage')
  assert.equal(freeName(['Sage']), 'Basil')
  assert.equal(freeName([...NAMES]), 'Basil 2')
  assert.equal(freeName([...NAMES, 'Basil 2']), 'Sage 2')
})

test('the steward has its own mark', () => {
  assert.equal(ROLES.steward.mark, '⚑')
  assert.equal(ROLES.steward.label, 'steward')
})

test('colorOf follows state first, then role', () => {
  assert.equal(colorOf('cook', 'failed'), '#ff3b30')
  assert.equal(colorOf('nobody', 'working'), '#e8e6d9')
})

const familyColor = (key) => FAMILIES.find((f) => f.key === key).color

test('FAMILIES lists the four model families in legend order', () => {
  assert.deepEqual(FAMILIES.map((f) => f.key), ['haiku', 'sonnet', 'opus', 'fable'])
  for (const f of FAMILIES) assert.equal(f.label, f.key)
})

test('familyOf names the family in a model id, whatever its case', () => {
  assert.equal(familyOf('claude-haiku-4-5'), 'haiku')
  assert.equal(familyOf('claude-sonnet-5-5'), 'sonnet')
  assert.equal(familyOf('claude-opus-5-5'), 'opus')
  assert.equal(familyOf('claude-fable-5-1'), 'fable')
  assert.equal(familyOf('claude-mythos-5-1'), 'fable')
  assert.equal(familyOf('CLAUDE-OPUS-5'), 'opus')
})

test('familyOf gives null for an unknown id or anything that is not a string', () => {
  assert.equal(familyOf('gpt-x'), null)
  assert.equal(familyOf(null), null)
  assert.equal(familyOf(42), null)
  assert.equal(familyOf(undefined), null)
  assert.equal(familyOf({ toString: () => 'opus' }), null)
  assert.equal(familyOf(['opus']), null)
})

test('colorOf with a model draws the family colour, state still winning', () => {
  assert.equal(colorOf('cook', 'working', 'claude-opus-5-5'), familyColor('opus'))
  assert.equal(colorOf('cook', 'working', 'claude-haiku-4-5'), familyColor('haiku'))
  assert.equal(colorOf('cook', 'failed', 'claude-opus-5-5'), PALETTE.alert)
  assert.equal(colorOf('cook', 'done', 'claude-opus-5-5'), PALETTE.dim)
})

test('colorOf with an unknown or missing model draws plain ink', () => {
  assert.equal(colorOf('cook', 'working', 'gpt-x'), PALETTE.ink)
  assert.equal(colorOf('cook', 'working', null), PALETTE.ink)
})

test('colorOf with two arguments keeps the role colour', () => {
  assert.equal(colorOf('cook', 'working'), ROLES.cook.color)
  assert.equal(colorOf('planner', 'working'), ROLES.planner.color)
})

test('the family colours are distinct from each other and from the field, dim and alert', () => {
  const colors = FAMILIES.map((f) => f.color.toLowerCase())
  assert.equal(new Set(colors).size, colors.length)
  for (const c of colors) {
    assert.match(c, /^#[0-9a-f]{6}$/)
    for (const taken of [PALETTE.field, PALETTE.dim, PALETTE.alert]) assert.notEqual(c, taken.toLowerCase())
  }
})

test('CLOUD is an 8 by 4 pixel storm cloud with lightning under its base', () => {
  assert.equal(CLOUD.length, 4)
  for (const row of CLOUD) {
    assert.equal(row.length, 8)
    assert.match(row, /^[#*.]+$/)
  }
  assert.ok(CLOUD.join('').includes('*'))
  // Dome and base are cloud only; the lightning hangs in the bottom row.
  for (const row of CLOUD.slice(0, 3)) assert.ok(!row.includes('*'))
  assert.ok(CLOUD[3].includes('*'))
})

test('PALETTE keeps its keys and gains the card and lightning colours', () => {
  for (const key of ['field', 'ink', 'dim', 'header', 'chip', 'chipInk', 'alert', 'kinds']) assert.ok(Object.hasOwn(PALETTE, key), key)
  assert.equal(PALETTE.field, '#0f1020')
  assert.equal(PALETTE.ink, '#e8e6d9')
  assert.equal(PALETTE.dim, '#6b7089')
  assert.equal(PALETTE.alert, '#ff3b30')
  assert.equal(PALETTE.card, '#1a1c2e')
  assert.equal(PALETTE.cardEdge, '#3a3f5c')
  assert.equal(PALETTE.bolt, '#ffd166')
})
