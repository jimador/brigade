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

test('null positions or homes and positions that are not cells are tolerated', () => {
  assert.deepEqual(advance(null, null), {})
  assert.deepEqual(advance(null, { a: home }), { a: { x: -7, y: 4 } })
  assert.deepEqual(advance({ a: { x: 'far' } }, { a: home }), { a: { x: -7, y: 4 } })
  assert.deepEqual(advance({ a: null }, { a: home }, null), { a: { x: -7, y: 4 } })
})

// --- walking without overlapping ----------------------------------------------------------

function boxOf(p, h) {
  return { x: p.x, y: p.y, w: h.w, h: h.h }
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function onBoard(box) {
  return box.x + box.w > 0
}

// Every pair of on-board sprites, and every sprite against every obstacle,
// that share a cell. Empty means the board reads cleanly.
function clashes(pos, homes, obstacles) {
  const ids = Object.keys(homes)
  const found = []
  for (let i = 0; i < ids.length; i++) {
    const a = boxOf(pos[ids[i]], homes[ids[i]])
    if (!onBoard(a)) continue
    for (let j = i + 1; j < ids.length; j++) {
      const b = boxOf(pos[ids[j]], homes[ids[j]])
      if (onBoard(b) && overlap(a, b)) found.push(`${ids[i]} ${JSON.stringify(a)} over ${ids[j]} ${JSON.stringify(b)}`)
    }
    for (const wall of obstacles) {
      if (overlap(a, wall)) found.push(`${ids[i]} ${JSON.stringify(a)} over obstacle ${JSON.stringify(wall)}`)
    }
  }
  return found
}

// Walks until settled (or 200 ticks), checking every tick. Returns the ticks taken.
function walkHome(start, homes, obstacles = []) {
  let pos = start
  for (let tick = 1; tick <= 200; tick++) {
    pos = advance(pos, homes, obstacles)
    assert.deepEqual(clashes(pos, homes, obstacles), [], `tick ${tick}`)
    if (settled(pos, homes)) return { tick, pos }
  }
  assert.fail(`not settled after 200 ticks: ${JSON.stringify(pos)}`)
}

test('two sprites entering one row with touching homes never overlap and both settle', () => {
  const homes = { a: { x: 0, y: 2, w: 9, h: 4 }, b: { x: 9, y: 2, w: 9, h: 4 } }
  const { pos } = walkHome({}, homes)
  assert.deepEqual(pos, { a: { x: 0, y: 2 }, b: { x: 9, y: 2 } })
})

test('two sprites that must swap places in one row settle without overlapping', () => {
  const homes = { a: { x: 30, y: 5, w: 9, h: 3 }, b: { x: 0, y: 5, w: 9, h: 3 } }
  const { pos } = walkHome({ a: { x: 0, y: 5 }, b: { x: 30, y: 5 } }, homes)
  assert.deepEqual(pos, { a: { x: 30, y: 5 }, b: { x: 0, y: 5 } })
})

test('a sprite whose straight path crosses an obstacle never overlaps it and still arrives', () => {
  const homes = { a: { x: 40, y: 5, w: 9, h: 3 } }
  const obstacles = [{ x: 20, y: 6, w: 10, h: 1 }]
  const { pos } = walkHome({}, homes, obstacles)
  assert.deepEqual(pos, { a: { x: 40, y: 5 } })
})

test('advance with no obstacles argument behaves as with an empty list', () => {
  const homes = { a: { x: 0, y: 5, w: 9, h: 3 }, b: { x: 30, y: 5, w: 9, h: 3 }, c: { x: 12, y: 0, w: 7, h: 3 } }
  let two = { a: { x: 30, y: 5 }, b: { x: 0, y: 5 } }
  let three = two
  for (let tick = 0; tick < 40; tick++) {
    two = advance(two, homes)
    three = advance(three, homes, [])
    assert.deepEqual(two, three, `tick ${tick}`)
  }
})

test('a sprite whose home moves three rows down walks there one row per tick', () => {
  const homes = { a: { x: 10, y: 7, w: 9, h: 4 } }
  let pos = { a: { x: 10, y: 4 } }
  for (const y of [5, 6, 7]) {
    pos = advance(pos, homes)
    assert.deepEqual(pos, { a: { x: 10, y } })
  }
})

test('an unseen sprite waits off the left edge while a resident blocks its way in', () => {
  const homes = { resident: { x: 0, y: 4, w: 9, h: 4 }, late: { x: 30, y: 4, w: 9, h: 4 } }
  let pos = { resident: { x: 0, y: 4 } }
  for (let tick = 1; tick < 8; tick++) {
    pos = advance(pos, homes)
    assert.deepEqual(pos.late, { x: -9, y: 4, wait: tick })
    assert.deepEqual(pos.resident, { x: 0, y: 4 })
  }
  // Eight ticks stuck in a row is enough: its home is clear, so it jumps there.
  pos = advance(pos, homes)
  assert.deepEqual(pos, { resident: { x: 0, y: 4 }, late: { x: 30, y: 4 } })
})

test('a sprite handed in on top of another moves off it in the very next tick', () => {
  const homes = { a: { x: 0, y: 0, w: 9, h: 3 }, b: { x: 40, y: 0, w: 9, h: 3 } }
  const pos = advance({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, homes)
  assert.deepEqual(clashes(pos, homes, []), [])
})

// --- the seeded sweep ---------------------------------------------------------------------

const SEED = process.env.BOARD_STAGE_SEED === undefined ? 20261002 : Number(process.env.BOARD_STAGE_SEED)
const CASES = 300
const WIDTH = 120
const HEIGHT = 60

// A small seeded generator (mulberry32), so every run sees the same boards.
function random(seed) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1))
  return { next, int, pick: (list) => list[int(0, list.length - 1)] }
}

// Homes laid out in bands down the board, a few to a band, some with just
// one cell between neighbours, and the odd one sitting a row or two lower.
function makeHomes(r, ids) {
  const homes = {}
  let i = 0
  let y = r.int(0, 3)
  while (i < ids.length) {
    let x = r.int(0, 8)
    let bottom = y
    const perBand = r.int(1, 5)
    for (let k = 0; k < perBand && i < ids.length; k++) {
      const box = { x, y: y + r.int(0, 2), w: r.int(7, 13), h: r.int(3, 6) }
      if (box.x + box.w > WIDTH || box.y + box.h > HEIGHT) break
      homes[ids[i++]] = box
      bottom = Math.max(bottom, box.y + box.h)
      x += box.w + (r.next() < 0.5 ? 1 : r.int(2, 12))
    }
    if (bottom === y) break
    y = bottom + r.int(1, 4)
  }
  return homes
}

// Name lines: one row tall, under a home the way a sprite's name sits under it.
function makeObstacles(r, homes) {
  const boxes = Object.values(homes)
  const want = r.int(0, 12)
  const out = []
  for (let n = 0; n < want * 4 && out.length < want && boxes.length > 0; n++) {
    const h = r.pick(boxes)
    const wall = { x: Math.max(0, h.x + r.int(-4, 2)), y: h.y + h.h + r.int(0, 1), w: r.int(8, 20), h: 1 }
    if (wall.y >= HEIGHT || boxes.some((b) => overlap(b, wall))) continue
    out.push(wall)
  }
  return out
}

function checkLayout(where, homes, obstacles) {
  const boxes = Object.values(homes)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${where}: homes overlap`)
    for (const wall of obstacles) assert.ok(!overlap(boxes[i], wall), `${where}: home under obstacle`)
  }
}

// One tick's worth of checks: the right ids, every move a legal step or a
// jump home, and nothing on the board drawn over anything else.
function checkTick(where, prev, next, homes, obstacles) {
  assert.deepEqual(Object.keys(next).sort(), Object.keys(homes).sort(), `${where}: ids`)
  for (const [id, h] of Object.entries(homes)) {
    const was = Object.hasOwn(prev, id) && Number.isFinite(prev[id]?.x) && Number.isFinite(prev[id]?.y)
      ? prev[id]
      : { x: -h.w, y: h.y }
    const p = next[id]
    const jumpedHome = p.x === h.x && p.y === h.y
    const step = Math.abs(p.x - was.x) <= 2 && Math.abs(p.y - was.y) <= 1 &&
      Math.abs(h.x - p.x) <= Math.abs(h.x - was.x) && Math.abs(h.y - p.y) <= Math.abs(h.y - was.y) &&
      Math.sign(h.x - p.x) * Math.sign(h.x - was.x) >= 0 && Math.sign(h.y - p.y) * Math.sign(h.y - was.y) >= 0
    assert.ok(step || jumpedHome, `${where}: ${id} moved ${JSON.stringify(was)} -> ${JSON.stringify(p)}, home ${JSON.stringify(h)}`)
  }
  const found = clashes(next, homes, obstacles)
  assert.deepEqual(found, [], `${where}: overlap`)
}

function walkCase(label, start, homes, obstacles) {
  checkLayout(label, homes, obstacles)
  let pos = start
  for (let tick = 1; tick <= 200; tick++) {
    const next = advance(pos, homes, obstacles)
    checkTick(`${label} tick ${tick}`, pos, next, homes, obstacles)
    pos = next
    if (settled(pos, homes)) {
      const after = advance(pos, homes, obstacles)
      assert.deepEqual(after, pos, `${label} tick ${tick + 1}: left home after settling`)
      return pos
    }
  }
  assert.fail(`${label}: not settled after 200 ticks`)
}

test(`seeded sweep: ${CASES} generated boards, no overlap at any tick, all settle (seed ${SEED})`, () => {
  const began = Date.now()
  for (let c = 0; c < CASES; c++) {
    const r = random(SEED * 7919 + c)
    const count = r.int(1, 12)
    const ids = Array.from({ length: count }, (_, i) => `s${i}`)
    const label = (phase) => `seed ${SEED} case ${c} ${phase}`

    // Some sprites stand where an earlier layout put them, some are new.
    const earlier = makeHomes(r, ids)
    const homes = makeHomes(r, ids)
    const start = {}
    for (const id of ids) {
      const roll = r.next()
      if (roll < 0.6 && earlier[id]) start[id] = { x: earlier[id].x, y: earlier[id].y }
      else if (roll < 0.65) start[id] = { x: 'nowhere' }
    }
    let pos = walkCase(label('first layout'), start, homes, makeObstacles(r, homes))

    // Everyone trades homes, which is where swaps come from.
    const owners = Object.keys(homes)
    const boxes = owners.map((id) => homes[id])
    for (let i = boxes.length - 1; i > 0; i--) {
      const j = r.int(0, i)
      const held = boxes[i]
      boxes[i] = boxes[j]
      boxes[j] = held
    }
    const traded = Object.fromEntries(owners.map((id, i) => [id, boxes[i]]))
    pos = walkCase(label('shuffled'), pos, traded, makeObstacles(r, traded))

    // A whole new layout under sprites that are standing where the old one put them.
    const fresh = makeHomes(r, ids)
    walkCase(label('fresh layout'), pos, fresh, makeObstacles(r, fresh))
  }
  const took = Date.now() - began
  console.log(`sweep: ${CASES} cases, seed ${SEED}, ${took} ms`)
  assert.ok(took < 20000, `sweep took ${took} ms`)
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
