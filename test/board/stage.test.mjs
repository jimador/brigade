import test from 'node:test'
import assert from 'node:assert/strict'
import { advance, settled, hitTest, kTokens, elapsed, cardLines } from '../../hooks/board/lib/stage.mjs'

const home = { x: 10, y: 4, w: 9, h: 4 }

test('a new sprite walks in from the left edge, one step in', () => {
  const next = advance({}, { a: home })
  assert.deepEqual(next, { a: { x: -9 + 2, y: 4 } })
})

test('repeated steps reach home exactly without overshooting', () => {
  const homes = { a: home, b: { x: 3, y: 0, w: 5, h: 2 } }
  let pos = { b: { x: 20, y: 9 } }
  let steps = 0
  while (!settled(pos, homes) && steps < 30) {
    const prev = pos
    pos = advance(pos, homes)
    steps++
    for (const id of Object.keys(homes)) {
      const before = prev[id] ?? { x: -homes[id].w, y: homes[id].y }
      const h = homes[id]
      // Each step only ever closes the gap, never crosses past home.
      assert.ok(Math.abs(h.x - pos[id].x) <= Math.abs(h.x - before.x))
      assert.ok(Math.sign(h.x - pos[id].x) * Math.sign(h.x - before.x) >= 0)
      assert.ok(Math.sign(h.y - pos[id].y) * Math.sign(h.y - before.y) >= 0)
      assert.ok(Math.abs(pos[id].x - before.x) <= 2)
      assert.ok(Math.abs(pos[id].y - before.y) <= 1)
    }
  }
  assert.ok(settled(pos, homes), `not settled after ${steps} steps`)
  assert.deepEqual(pos, { a: { x: 10, y: 4 }, b: { x: 3, y: 0 } })
  assert.deepEqual(advance(pos, homes), pos)
})

test('a sprite one cell from home moves one cell, not two', () => {
  assert.deepEqual(advance({ a: { x: 9, y: 4 } }, { a: home }), { a: { x: 10, y: 4 } })
  assert.deepEqual(advance({ a: { x: 11, y: 4 } }, { a: home }), { a: { x: 10, y: 4 } })
})

test('y moves at most one cell per step', () => {
  assert.deepEqual(advance({ a: { x: 10, y: 8 } }, { a: home }), { a: { x: 10, y: 7 } })
})

test('an id with no home is dropped', () => {
  const next = advance({ a: { x: 10, y: 4 }, gone: { x: 1, y: 1 } }, { a: home })
  assert.deepEqual(Object.keys(next), ['a'])
})

test('advance leaves its inputs untouched and returns fresh objects', () => {
  const positions = { a: { x: 0, y: 0 }, gone: { x: 1, y: 1 } }
  const homes = { a: home, b: { x: 2, y: 2, w: 3, h: 1 } }
  const positionsCopy = structuredClone(positions)
  const homesCopy = structuredClone(homes)
  const next = advance(positions, homes)
  assert.deepEqual(positions, positionsCopy)
  assert.deepEqual(homes, homesCopy)
  assert.notEqual(next, positions)
  assert.notEqual(next.a, positions.a)
})

test('empty inputs give empty, settled results', () => {
  assert.deepEqual(advance({}, {}), {})
  assert.deepEqual(advance({ a: { x: 1, y: 1 } }, {}), {})
  assert.equal(settled({}, {}), true)
  assert.equal(settled({}, { a: home }), false)
  assert.equal(hitTest([], 0, 0), null)
})

test('hitTest picks the later of two overlapping regions, and null outside both', () => {
  const regions = [
    { id: 'under', x: 0, y: 0, w: 10, h: 5 },
    { id: 'over', x: 5, y: 2, w: 10, h: 5 },
  ]
  assert.equal(hitTest(regions, 6, 3), 'over')
  assert.equal(hitTest(regions, 1, 1), 'under')
  assert.equal(hitTest(regions, 30, 30), null)
  assert.equal(hitTest(regions, 15, 3), null)
})

test('kTokens covers every contract example', () => {
  assert.equal(kTokens(41200), '41k')
  assert.equal(kTokens(999), '999')
  assert.equal(kTokens(1500), '2k')
  assert.equal(kTokens(1250000), '1.3M')
  assert.equal(kTokens('41200'), '0')
  assert.equal(kTokens(null), '0')
  assert.equal(kTokens(undefined), '0')
  assert.equal(kTokens(NaN), '0')
  assert.equal(kTokens(999999), '1M')
})

test('elapsed covers every contract example', () => {
  assert.equal(elapsed(40000), '40s')
  assert.equal(elapsed(12 * 60000), '12m')
  assert.equal(elapsed(3900000), '1h05m')
  assert.equal(elapsed(-5), '0s')
  assert.equal(elapsed(59999), '59s')
  assert.equal(elapsed(3599999), '59m')
})

const now = 1_000_000_000
const agent = {
  id: 'a1', name: 'alex', role: 'cook', model: 'sonnet', item: null,
  state: 'working', tokens: 41200, startedAt: now - 180000, endedAt: null,
}

test('cardLines words a working agent with no item', () => {
  assert.deepEqual(cardLines(agent, 'Cook', now), [
    'alex · Cook',
    'sonnet',
    'item —',
    'working · 41k tokens · 3m',
  ])
})

test('a working inspector reads reviewing', () => {
  const lines = cardLines({ ...agent, role: 'inspector' }, 'Inspector', now)
  assert.equal(lines[3], 'reviewing · 41k tokens · 3m')
})

test('a finished agent shows its item and stops the clock at endedAt', () => {
  const done = { ...agent, role: 'inspector', state: 'done', item: 'stage-motion', endedAt: now - 140000 }
  const lines = cardLines(done, 'Inspector', now)
  assert.equal(lines[2], 'item stage-motion')
  assert.equal(lines[3], 'done · 41k tokens · 40s')
})
