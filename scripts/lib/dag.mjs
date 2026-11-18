// Lays out and draws a dependency graph as one inline SVG. The plan view and the roadmap view
// both use it. Pure ESM, no imports, no clock: the same graph always gives the same bytes.
//
// A graph is plain data:
//   { nodes: [{ id, label, cls, meta?, tag?, data? }], edges: [[from, to]] }
// `id` is what edges point at, `label` is the node's main text, `cls` is added to the node's
// class list. Optional: `meta` is a second line of text (and joins the hover title), `tag` is
// a small marker in the top-right corner, and `data` is a map of data-* attributes for the
// node (default: data-id set to the id). An edge [from, to] means `from` must come before
// `to`, so it is drawn left to right. Edges naming an unknown id are skipped, a repeated pair
// is drawn once, and when two nodes share an id an edge points at the later one.

// Node geometry in SVG user units; the SVG scales to the page width through its viewBox.
const NODE_W = 180
const NODE_H = 56
const GAP_X = 52
const GAP_Y = 24
const PAD = 16
const LABEL_MAX = 22

// Text made safe for an element or an attribute. The markup characters become entities. On top
// of that, the few spots where plain text could look like a script hook to a filter that scans
// the raw source (an `on...=` pair, the word href, a `url(`) get one character written as a
// character reference. A reader of the page sees exactly the same text.
export function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/(on[a-z0-9_-]*\s*)=/gi, '$1&#61;')
    .replace(/h(ref)/gi, (all, rest) => `&#${all.charCodeAt(0)};${rest}`)
    .replace(/(url\s*)\(/gi, '$1&#40;')
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

// Turns the edge list into node-index pairs: { from, to }, in input order, unknown ids dropped,
// each pair kept once.
function resolve(graph) {
  const nodes = graph.nodes ?? []
  const index = new Map()
  nodes.forEach((n, i) => index.set(n.id, i))
  const links = []
  const seen = new Set()
  for (const [a, b] of graph.edges ?? []) {
    const from = index.get(a)
    const to = index.get(b)
    if (from === undefined || to === undefined) continue
    const key = `${from} ${to}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ from, to })
  }
  return { nodes, links }
}

// Which nodes each node can reach by following edges forward. `skip` leaves one edge out.
function reacher(links, count) {
  const out = Array.from({ length: count }, () => [])
  for (const l of links) out[l.from].push(l.to)
  return (start, skip) => {
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const n = stack.pop()
      for (const m of out[n]) {
        if (skip && n === skip.from && m === skip.to) continue
        if (!seen.has(m)) { seen.add(m); stack.push(m) }
      }
    }
    return seen
  }
}

// Column = longest path from a root (roots are column 0); row = input order within the column.
// A cycle is cut where the walk meets a node it is still inside, so the walk always ends.
function placeLinks(nodes, links) {
  const preds = Array.from({ length: nodes.length }, () => [])
  for (const l of links) preds[l.to].push(l.from)
  const depth = new Array(nodes.length).fill(-1)
  const open = new Set()
  const depthOf = (i) => {
    if (depth[i] >= 0) return depth[i]
    if (open.has(i)) return 0
    open.add(i)
    let d = 0
    for (const j of preds[i]) d = Math.max(d, depthOf(j) + 1)
    open.delete(i)
    depth[i] = d
    return d
  }
  nodes.forEach((_, i) => depthOf(i))
  const nextRow = new Map()
  return nodes.map((_, i) => {
    const col = depth[i]
    const row = nextRow.get(col) ?? 0
    nextRow.set(col, row + 1)
    return { col, row }
  })
}

// Transitive reduction. Edge u->v is dropped when another path from u to v exists. Nodes on a
// cycle are left alone: any edge touching one is kept, and paths only pass through nodes that
// are not on a cycle.
function reduceIdx(links, count) {
  const reach = reacher(links, count)
  const cyclic = new Set()
  for (let i = 0; i < count; i++) if (reach(i, null).has(i)) cyclic.add(i)
  return links.filter((l) => {
    if (cyclic.has(l.from) || cyclic.has(l.to)) return true
    return !reach(l.from, l).has(l.to)
  })
}

// Grid position of every node, in node order: [{ col, row }].
export function place(graph) {
  const { nodes, links } = resolve(graph)
  return placeLinks(nodes, links)
}

// The edges worth drawing, as [from, to] id pairs in input order: what is left after the
// transitive reduction.
export function reduceLinks(graph) {
  const { nodes, links } = resolve(graph)
  return reduceIdx(links, nodes.length).map((l) => [nodes[l.from].id, nodes[l.to].id])
}

const nodeX = (col) => GAP_X + col * (NODE_W + GAP_X)
const round = (v) => Math.round(v * 10) / 10

const CURVE_STEPS = 24
function curvePoint(p, t) {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return [0, 1].map((k) => w[0] * p[0][k] + w[1] * p[1][k] + w[2] * p[2][k] + w[3] * p[3][k])
}

// Draws the graph. Every drawn edge is one cubic Bezier from the source's right side to the
// target's left side. An edge that lies on a cycle gets the class "cycle" as well as "edge",
// unless `markCycles` is false.
//
// @param graph { nodes, edges } as described at the top of the file.
// @param options.markCycles mark cycle edges (default true).
// @param options.ariaLabel the SVG's accessible name (default "Dependency graph of N nodes").
// @return { svg, hidden, cycles }: the markup, how many edges the reduction left out, and how
//   many drawn edges lie on a cycle.
export function renderDag(graph, options = {}) {
  const markCycles = options.markCycles ?? true
  const { nodes, links: declared } = resolve(graph)
  const pos = placeLinks(nodes, declared)
  const cols = pos.reduce((m, p) => Math.max(m, p.col), 0) + 1
  const rows = pos.reduce((m, p) => Math.max(m, p.row), 0) + 1
  const links = reduceIdx(declared, nodes.length)
  const hidden = declared.length - links.length

  // An edge is on a cycle when its target leads back to its source.
  const reach = reacher(declared, nodes.length)
  for (const l of links) l.cycle = l.from === l.to || reach(l.to, null).has(l.from)

  const top = PAD
  const nodeY = (row) => top + row * (NODE_H + GAP_Y)
  const width = nodeX(cols - 1) + NODE_W + GAP_X
  const height = nodeY(rows - 1) + NODE_H + PAD
  // Row gaps, including the strips above and below the grid: y of each strip's middle.
  const gapYs = []
  for (let r = 0; r <= rows; r++) gapYs.push(nodeY(r) - GAP_Y / 2)

  // Ports: edges leaving a node share its right side and edges entering share its left side,
  // spread down the side in the order of the far end's height so arrowheads never stack.
  const port = (row, n, count) => round(nodeY(row) + (NODE_H * (n + 1)) / (count + 1))
  const cmp = (a, b) => pos[a].row - pos[b].row || pos[a].col - pos[b].col
  nodes.forEach((_, i) => {
    const outs = links.filter((l) => l.from === i).sort((a, b) => cmp(a.to, b.to))
    outs.forEach((l, n) => { l.outY = port(pos[i].row, n, outs.length) })
    const ins = links.filter((l) => l.to === i).sort((a, b) => cmp(a.from, b.from))
    ins.forEach((l, n) => { l.inY = port(pos[i].row, n, ins.length) })
  })

  // Does the curve clear every node in the columns strictly between its ends?
  const clear = (pts, c1, c2) => {
    for (let s = 0; s <= CURVE_STEPS; s++) {
      const [x, y] = curvePoint(pts, s / CURVE_STEPS)
      for (let i = 0; i < nodes.length; i++) {
        const c = pos[i].col
        if (c <= c1 || c >= c2) continue
        const nx = nodeX(c)
        const ny = nodeY(pos[i].row)
        if (x > nx - 2 && x < nx + NODE_W + 2 && y > ny - 3 && y < ny + NODE_H + 3) return false
      }
    }
    return true
  }

  const edges = links.map((l) => {
    const c1 = pos[l.from].col
    const c2 = pos[l.to].col
    const x1 = nodeX(c1) + NODE_W
    const x2 = nodeX(c2)
    const y1 = l.outY
    const y2 = l.inY
    const bend = Math.max(GAP_X, Math.abs(x2 - x1)) * 0.5
    let pts = [[x1, y1], [x1 + bend, y1], [x2 - bend, y2], [x2, y2]]
    if (c2 - c1 >= 2) {
      // Skipped columns: try each row gap, nearest the straight line first, and keep the first
      // curve that passes between nodes. The control height puts the curve's middle in the gap;
      // a short handle lets the curve leave the source's column quickly, a long one is smoother.
      const mid = (y1 + y2) / 2
      const tries = [...gapYs].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
      const handles = [bend, GAP_X * 0.8, GAP_X * 0.5, GAP_X * 0.3]
      search:
      for (const g of tries) {
        const yc = (8 * g - (y1 + y2)) / 6
        for (const h of handles) {
          const cand = [[x1, y1], [x1 + h, yc], [x2 - h, yc], [x2, y2]]
          if (clear(cand, c1, c2)) { pts = cand; break search }
        }
      }
    }
    const f = (q) => `${round(q[0])} ${round(q[1])}`
    const d = `M${f(pts[0])} C${f(pts[1])} ${f(pts[2])} ${f(pts[3])}`
    const cls = markCycles && l.cycle ? 'edge cycle' : 'edge'
    const title = `${esc(nodes[l.from].label)} to ${esc(nodes[l.to].label)}`
    return `<path class="${cls}" marker-end="url(#dag-arrow)" d="${d}"><title>${title}</title></path>`
  })

  const marker = '<defs><marker id="dag-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="arrow" d="M0 0 L10 5 L0 10 z"/></marker></defs>'

  const drawn = nodes.map((n, i) => {
    const p = { x: nodeX(pos[i].col), y: nodeY(pos[i].row) }
    const label = String(n.label ?? n.id)
    const hasMeta = n.meta !== undefined && n.meta !== null
    const data = Object.entries(n.data ?? { id: n.id })
      .map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')
    const title = hasMeta ? `${esc(label)} - ${esc(n.meta)}` : esc(label)
    const meta = hasMeta ? `<text class="meta" x="${p.x + 10}" y="${p.y + 46}">${esc(n.meta)}</text>` : ''
    const tag = n.tag ? `<text class="tag" x="${p.x + NODE_W - 10}" y="${p.y + 15}" text-anchor="end">${esc(n.tag)}</text>` : ''
    return [
      `<g class="node${n.cls ? ` ${n.cls}` : ''}"${data}>`,
      `<title>${title}</title>`,
      `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>`,
      `<text class="slug" x="${p.x + 10}" y="${p.y + 28}">${esc(short(label, LABEL_MAX))}</text>`,
      meta,
      tag,
      '</g>',
    ].join('')
  })

  // The SVG never renders below its viewBox width at scale 1, so node text keeps its font size;
  // the page around it should scroll the rest on a narrow screen.
  const aria = options.ariaLabel ?? `Dependency graph of ${nodes.length} nodes`
  const svg = `<svg class="dag" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="${esc(aria)}">`
    + `${marker}${edges.join('')}${drawn.join('')}</svg>`
  const cycles = markCycles ? links.filter((l) => l.cycle).length : 0
  return { svg, hidden, cycles }
}
