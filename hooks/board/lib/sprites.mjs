// The board's pixel sprites, its palette, and the rules for naming and colouring agents.
// Each sprite is two animation frames of '#' (lit) and '.' (empty) rows, one set per model size.

// The sprites the terminal draws: 3 cells wide and one text row tall (two pixel rows), so a board
// with thirty agents on it still fits in one pane. Every size is the same box; the colour says
// which model an agent runs on, and the shape only hints at it.
export const SPRITES = {
  s: [['.#.', '###'], ['.#.', '#.#']],
  m: [['###', '#.#'], ['###', '.#.']],
  l: [['#.#', '###'], ['###', '#.#']],
  xl: [['###', '###'], ['###', '#.#']],
}

// Cells a terminal sprite covers: width is the bitmap width, height is half its pixel rows, since
// one cell row shows two pixel rows.
export const SIZES = { s: { w: 3, h: 1 }, m: { w: 3, h: 1 }, l: { w: 3, h: 1 }, xl: { w: 3, h: 1 } }

// The detailed sprites, for a surface that can draw real pixels, like the desktop picture. They
// grow with the model: 7x6, 9x8, 11x10 and 13x12 pixels.
export const ART = {
  s: [
    ['..#.#..', '.#####.', '##.#.##', '#######', '.#.#.#.', '#.....#'],
    ['..#.#..', '.#####.', '##.#.##', '#######', '.#...#.', '..#.#..'],
  ],
  m: [
    ['..#...#..', '...#.#...', '..#####..', '.##.#.##.', '#########', '#.#####.#', '#.#...#.#', '...#.#...'],
    ['..#...#..', '#..#.#..#', '#.#####.#', '###.#.###', '#########', '.#######.', '.#.....#.', '#.......#'],
  ],
  l: [
    ['...#...#...', '....#.#....', '..#######..', '.#########.', '###..#..###', '###########', '###########', '..##...##..', '.##.###.##.', '##.......##'],
    ['...#...#...', '#...#.#...#', '#.#######.#', '###########', '###..#..###', '###########', '.#########.', '..##...##..', '.#..###..#.', '..#.....#..'],
  ],
  xl: [
    ['....#...#....', '.....#.#.....', '...#######...', '..#########..', '.###.###.###.', '#############', '#############', '###.#####.###', '..###...###..', '.##..###..##.', '##.........##', '.#.........#.'],
    ['....#...#....', '#....#.#....#', '#..#######..#', '#.#########.#', '####.###.####', '#############', '.###########.', '..#.#####.#..', '..###...###..', '..#..###..#..', '.#.........#.', '#...........#'],
  ],
}
// Which size a model draws at, from its id, case-insensitive substring match:
// 'haiku' -> 's', 'sonnet' -> 'm', 'opus' -> 'l', 'fable' or 'mythos' -> 'xl', anything else -> 'm'.
export function sizeOf(modelId) {
  const id = String(modelId ?? '').toLowerCase()
  if (id.includes('haiku')) return 's'
  if (id.includes('sonnet')) return 'm'
  if (id.includes('opus')) return 'l'
  if (id.includes('fable') || id.includes('mythos')) return 'xl'
  return 'm'
}
export const PALETTE = {
  field: '#0f1020', ink: '#e8e6d9', dim: '#6b7089', header: '#8be9fd',
  chip: '#e8e6d9', chipInk: '#0f1020', alert: '#ff3b30',
  kinds: { feature: '#ffd166', bug: '#c77dff', chore: '#06d6a0', docs: '#4cc9f0', research: '#b388ff', contract: '#ffffff' },
  // A card's background and border, and the lightning in the context meter's cloud.
  card: '#1a1c2e', cardEdge: '#3a3f5c', bolt: '#ffd166',
}
// The model families in the order the legend lists them, each with the colour its sprites draw in.
export const FAMILIES = [
  { key: 'haiku', label: 'haiku', color: '#4cc9f0' },
  { key: 'sonnet', label: 'sonnet', color: '#06d6a0' },
  { key: 'opus', label: 'opus', color: '#ffd166' },
  { key: 'fable', label: 'fable', color: '#ff7ab6' },
]
// Which family a model id belongs to, case-insensitive substring match: 'haiku', 'sonnet', 'opus',
// or 'fable' (a 'mythos' id counts as fable too). Anything else, including a value that isn't a
// string at all, is null, since the id comes from outside and can be any shape.
export function familyOf(model) {
  if (typeof model !== 'string') return null
  const id = model.toLowerCase()
  if (id.includes('haiku')) return 'haiku'
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('opus')) return 'opus'
  if (id.includes('fable') || id.includes('mythos')) return 'fable'
  return null
}
// The little storm cloud next to the context meter: '#' is cloud, '*' is lightning, '.' is empty.
// Eight pixels wide and four tall, so it fills 8 cells by 2 rows in half blocks: a dome on top,
// a flat base, then the lightning and rain gaps hanging underneath.
export const CLOUD = [
  '..####..',
  '.######.',
  '########',
  '..*..*..',
]
// Role -> the mark shown before the name, the label for the hover card, the sprite colour.
export const ROLES = {
  planner: { mark: '✦', label: 'planner', color: '#fff3b0' },
  scout: { mark: '⌕', label: 'scout', color: '#4cc9f0' },
  cook: { mark: '♨', label: 'cook', color: '#06d6a0' },
  heavy: { mark: '♨', label: 'heavy cook', color: '#ffd166' },
  inspector: { mark: '✓', label: 'inspector', color: '#b388ff' },
  analyst: { mark: '∴', label: 'analyst', color: '#ff9f1c' },
  steward: { mark: '⚑', label: 'steward', color: '#8be9fd' },
  agent: { mark: '•', label: 'agent', color: '#e8e6d9' },
}
export const NAMES = ['Basil', 'Sage', 'Miso', 'Nori', 'Clove', 'Fennel', 'Juniper', 'Olive', 'Pepper', 'Rye', 'Saffron', 'Tamarind']
// The n-th agent's name, n from 0: NAMES[n] for the first twelve, then 'Basil 2', 'Sage 2', ...
export function rosterName(n) {
  const name = NAMES[n % NAMES.length]
  const round = Math.floor(n / NAMES.length) + 1
  return round === 1 ? name : `${name} ${round}`
}
// The first name nobody in `taken` already has. Goes through all twelve names, then 'Basil 2',
// 'Sage 2' and so on, so a name freed by an agent that left gets used again before a new round.
export function freeName(taken) {
  const used = new Set(Array.isArray(taken) ? taken : [])
  // Each round adds twelve fresh names, so this always ends once the rounds outnumber `used`.
  for (let n = 0; ; n++) {
    const name = rosterName(n)
    if (!used.has(name)) return name
  }
}
// The colour a sprite draws in. State wins: PALETTE.alert when 'failed', PALETTE.dim when 'done'.
// Given a model, the colour of its family, or plain ink when the model names no known family, so
// every colour on the board means what the legend says. Without a model, the role's colour (an
// unknown role uses ROLES.agent), which is how older callers still get what they always got.
export function colorOf(role, state, model) {
  if (state === 'failed') return PALETTE.alert
  if (state === 'done') return PALETTE.dim
  if (model !== undefined) {
    const family = FAMILIES.find((f) => f.key === familyOf(model))
    return family ? family.color : PALETTE.ink
  }
  // Own keys only, so a role like 'toString' can't pick up an Object method.
  const known = Object.hasOwn(ROLES, role) ? ROLES[role] : ROLES.agent
  return known.color
}
