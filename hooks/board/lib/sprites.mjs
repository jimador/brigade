// The board's pixel sprites, its palette, and the rules for naming and colouring agents.
// Each sprite is two animation frames of '#' (lit) and '.' (empty) rows, one set per model size.

export const SPRITES = {
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

// Cells a sprite covers: width is the bitmap width, height is half its pixel rows.
export const SIZES = { s: { w: 7, h: 3 }, m: { w: 9, h: 4 }, l: { w: 11, h: 5 }, xl: { w: 13, h: 6 } }
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
}
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
// The colour a sprite draws in: PALETTE.alert when state is 'failed', PALETTE.dim when 'done',
// else the role's colour (an unknown role uses ROLES.agent).
export function colorOf(role, state) {
  if (state === 'failed') return PALETTE.alert
  if (state === 'done') return PALETTE.dim
  // Own keys only, so a role like 'toString' can't pick up an Object method.
  const known = Object.hasOwn(ROLES, role) ? ROLES[role] : ROLES.agent
  return known.color
}
