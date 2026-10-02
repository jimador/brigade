// Checks the board layout by its properties: lanes go down the page, chips and sprites stay
// inside the pane and never overlap, and sprites stand under the tickets they are working.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layout, CHIP_W } from '../../hooks/board/lib/layout.mjs'

function tickets(prefix, n, kind = 'feature') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, title: `${prefix} ${i + 1}`, status: prefix, kind }))
}

function lane(key, n) {
  return { key, title: key.toUpperCase(), total: n, tickets: tickets(key, n) }
}

const SNAPSHOT = {
  lanes: [lane('todo', 9), lane('in_progress', 2), lane('in_review', 0), lane('blocked', 0), lane('in_test', 0), lane('done', 5)],
  agents: [
    { id: 'a1', name: 'Basil', role: 'cook', model: 'claude-haiku', lane: null, ticket: null },
    { id: 'a2', name: 'Sage', role: 'cook', model: 'claude-sonnet', lane: 'in_progress', ticket: 'in_progress-2' },
    { id: 'a3', name: 'Miso', role: 'heavy', model: 'claude-opus', lane: 'in_progress', ticket: 'in_progress-1' },
    { id: 'a4', name: 'Nori', role: 'mystery', model: 'claude-fable', lane: 'in_progress', ticket: null },
    { id: 'a5', name: 'Clove', role: 'inspector', model: 'claude-sonnet', lane: 'in_review', ticket: 'in_progress-1' },
  ],
}

// Two boxes overlap when they share any cell; w and h count cells.
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function rowsOf(items) {
  return new Set(items.map((i) => i.y)).size
}

for (const columns of [60, 30]) {
  test(`layout rules hold at ${columns} columns`, () => {
    const out = layout(SNAPSHOT, columns)
    assert.equal(out.columns, columns)

    // Lanes run strictly down the page, the first one below the two heads-up rows.
    assert.ok(out.lanes[0].y >= 2)
    for (let i = 1; i < out.lanes.length; i++) assert.ok(out.lanes[i].y > out.lanes[i - 1].y)

    // A bench lane exists for the agent with no lane, and it comes first.
    assert.equal(out.lanes[0].key, 'bench')
    assert.equal(out.lanes.filter((l) => l.key === 'bench').length, 1)

    // Chips stay inside the pane and never overlap.
    const chips = out.lanes.flatMap((l) => l.chips)
    for (const c of chips) {
      assert.equal(c.w, CHIP_W)
      assert.ok(c.x >= 1, `chip ${c.id} x=${c.x}`)
      assert.ok(c.x + c.w <= columns, `chip ${c.id} ends at ${c.x + c.w}`)
    }
    const chipBoxes = chips.map((c) => ({ ...c, h: 1 }))
    for (let i = 0; i < chipBoxes.length; i++) {
      for (let j = i + 1; j < chipBoxes.length; j++) assert.ok(!overlaps(chipBoxes[i], chipBoxes[j]), `${chips[i].id} vs ${chips[j].id}`)
    }

    const byKey = Object.fromEntries(out.lanes.map((l) => [l.key, l]))
    assert.ok(rowsOf(byKey.todo.chips) <= 2)
    assert.equal(byKey.todo.more, 9 - byKey.todo.chips.length)
    assert.ok(byKey.todo.more > 0)
    assert.ok(rowsOf(byKey.done.chips) <= 1)
    assert.equal(byKey.in_review.chips.length, 0)

    // Every agent has a home inside the pane, and no two homes overlap, tag row included.
    const homes = Object.entries(out.homes)
    assert.equal(homes.length, SNAPSHOT.agents.length)
    for (const [id, h] of homes) assert.ok(h.x >= 1, `${id} x=${h.x}`)
    for (let i = 0; i < homes.length; i++) {
      for (let j = i + 1; j < homes.length; j++) {
        const [ia, a] = homes[i]
        const [ib, b] = homes[j]
        assert.ok(!overlaps({ ...a, h: a.h + 1 }, { ...b, h: b.h + 1 }), `${ia} vs ${ib}`)
      }
    }

    // Sprites in one row share a baseline: any two homes whose rows of cells (tag row included)
    // touch the same line of the pane must stand on the same line.
    for (let i = 0; i < homes.length; i++) {
      for (let j = i + 1; j < homes.length; j++) {
        const [ia, a] = homes[i]
        const [ib, b] = homes[j]
        const sameRow = a.y <= b.y + b.h && b.y <= a.y + a.h
        if (sameRow) assert.equal(a.y + a.h, b.y + b.h, `${ia} and ${ib} share a row but not a baseline`)
      }
    }
    // And the row really does mix sizes somewhere, so the check above is not vacuous.
    const mixed = homes.some(([, a]) => homes.some(([, b]) => a.h !== b.h && a.y + a.h === b.y + b.h))
    assert.ok(mixed)

    // The agent on the lane's second chip stands no further left than that chip.
    const second = byKey.in_progress.chips[1]
    assert.equal(second.id, 'in_progress-2')
    assert.ok(out.homes.a2.x >= second.x)

    // Agents land in their own lane: the bench, in_progress or in_review.
    const laneOf = (h) => out.lanes.findLast((l) => l.y <= h.y).key
    assert.equal(laneOf(out.homes.a1), 'bench')
    assert.equal(laneOf(out.homes.a2), 'in_progress')
    assert.equal(laneOf(out.homes.a4), 'in_progress')
    assert.equal(laneOf(out.homes.a5), 'in_review')

    // Tags carry the role mark, and an unknown role falls back to the plain agent mark.
    assert.equal(out.homes.a2.tag, '♨ Sage')
    assert.equal(out.homes.a4.tag, '• Nori')

    // The pane is tall enough for every sprite and its tag.
    for (const [, h] of homes) assert.ok(out.rows > h.y + h.h)
  })
}

test('the working agents stand under their chips when the row has room', () => {
  const out = layout(SNAPSHOT, 60)
  const chips = Object.fromEntries(out.lanes.flatMap((l) => l.chips).map((c) => [c.id, c]))
  assert.ok(out.homes.a3.x >= chips['in_progress-1'].x)
  assert.ok(out.homes.a2.x >= chips['in_progress-2'].x)
  // Ordered by chip position: the agent on the first chip sits left of the one on the second.
  assert.ok(out.homes.a3.x < out.homes.a2.x)
})

test('with no agents there is no bench lane', () => {
  const out = layout({ lanes: SNAPSHOT.lanes, agents: [] }, 60)
  assert.ok(!out.lanes.some((l) => l.key === 'bench'))
  assert.equal(out.lanes[0].key, 'todo')
  assert.equal(out.lanes[0].y, 2)
  assert.deepEqual(out.homes, {})
})

test('a pane narrower than 24 columns is laid out at 24', () => {
  const out = layout(SNAPSHOT, 5)
  assert.equal(out.columns, 24)
  for (const c of out.lanes.flatMap((l) => l.chips)) assert.ok(c.x + c.w <= 24)
  for (const h of Object.values(out.homes)) assert.ok(h.x >= 1)
})
