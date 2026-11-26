// A collision force that keeps nodes and the labels below them from overlapping (a custom d3-force force).
// Cytoscape's labels share the nodes' coordinate system (scaling with zoom), so no overlap in the layout means no overlap at any zoom level.
import type { Force, SimulationNodeDatum } from 'd3-force'

/** Matches the label style in style.ts */
export const LABEL_FONT_SIZE = 11
export const LABEL_GAP = 4
/** Gap kept around each box */
const PAD = 3

/**
 * Estimates label width (there's no DOM to measure text in a Worker): CJK characters and full-width symbols are about one em wide, others about 0.6.
 * Better to overestimate: a little extra space beats overlap.
 */
export function estimateLabelWidth(text: string, fontSize = LABEL_FONT_SIZE): number {
  let w = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    w += code >= 0x1100 && !(code >= 0xff61 && code <= 0xffdc) ? 1 : ch === ' ' ? 0.3 : 0.62
  }
  return Math.ceil(w * fontSize)
}

/** The box covering a node plus its label, with the node center as the origin: half to each side, top above, bottom below */
export interface Footprint {
  half: number
  top: number
  bottom: number
}

export function footprint(r: number, labelWidth: number, fontSize = LABEL_FONT_SIZE): Footprint {
  if (labelWidth <= 0) return { half: r + PAD, top: r + PAD, bottom: r + PAD }
  return {
    half: Math.max(r, labelWidth / 2) + PAD,
    top: r + PAD,
    bottom: r + LABEL_GAP + Math.ceil(fontSize * 1.25) + PAD
  }
}

export interface RectNode extends SimulationNodeDatum {
  box: Footprint
}

/** Grid cell size: most boxes fall in 1–4 cells */
const CELL = 80
const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768)

/**
 * Finds overlapping boxes and pushes them apart along the axis with less overlap. Returns the number of overlaps found this round.
 * - velocity: changes velocity (during the simulation, as d3's forceCollide does), pushing apart strength × the overlap
 * - position: changes positions directly (cleanup after convergence), pushing apart fully; pinned (dragged) nodes stay put and the other node moves
 * Uses grid partitioning to compare only nearby nodes, about O(n) per round.
 */
function collidePass(
  nodes: RectNode[],
  stamp: Int32Array,
  mode: 'velocity' | 'position',
  strength: number
): number {
  const n = nodes.length
  const grid = new Map<number, number[]>()
  const x1 = new Float64Array(n)
  const x2 = new Float64Array(n)
  const y1 = new Float64Array(n)
  const y2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const d = nodes[i]
    const x = (d.x ?? 0) + (mode === 'velocity' ? (d.vx ?? 0) : 0)
    const y = (d.y ?? 0) + (mode === 'velocity' ? (d.vy ?? 0) : 0)
    x1[i] = x - d.box.half
    x2[i] = x + d.box.half
    y1[i] = y - d.box.top
    y2[i] = y + d.box.bottom
    for (let cx = Math.floor(x1[i] / CELL); cx <= Math.floor(x2[i] / CELL); cx++) {
      for (let cy = Math.floor(y1[i] / CELL); cy <= Math.floor(y2[i] / CELL); cy++) {
        const cell = grid.get(cellKey(cx, cy))
        if (cell) cell.push(i)
        else grid.set(cellKey(cx, cy), [i])
      }
    }
  }

  const move = (d: RectNode, axis: 'x' | 'y', amount: number): void => {
    if (mode === 'velocity') {
      if (axis === 'x') d.vx = (d.vx ?? 0) + amount
      else d.vy = (d.vy ?? 0) + amount
    } else if (axis === 'x') d.x = (d.x ?? 0) + amount
    else d.y = (d.y ?? 0) + amount
  }
  const fixed = (d: RectNode): boolean => mode === 'position' && (d.fx != null || d.fy != null)

  let found = 0
  stamp.fill(-1)
  for (let i = 0; i < n; i++) {
    for (let cx = Math.floor(x1[i] / CELL); cx <= Math.floor(x2[i] / CELL); cx++) {
      for (let cy = Math.floor(y1[i] / CELL); cy <= Math.floor(y2[i] / CELL); cy++) {
        const cell = grid.get(cellKey(cx, cy))
        if (!cell) continue
        for (const j of cell) {
          if (j <= i || stamp[j] === i) continue
          stamp[j] = i
          const ox = Math.min(x2[i], x2[j]) - Math.max(x1[i], x1[j])
          const oy = Math.min(y2[i], y2[j]) - Math.max(y1[i], y1[j])
          if (ox <= 0 || oy <= 0) continue
          found++
          const a = nodes[i]
          const b = nodes[j]
          const axis = ox < oy ? 'x' : 'y'
          // When centers coincide, pick the direction by index so it can't get stuck
          const dir =
            Math.sign(
              axis === 'x' ? x1[j] + x2[j] - x1[i] - x2[i] : y1[j] + y2[j] - y1[i] - y2[i]
            ) || 1
          // When moving positions directly, push an extra 0.5px so float error can't make boxes that just touch count as overlapping again
          const overlap = axis === 'x' ? ox : oy
          const total = mode === 'velocity' ? overlap * strength : overlap + 0.5
          const aFixed = fixed(a)
          const bFixed = fixed(b)
          if (aFixed && bFixed) continue
          const shareA = aFixed ? 0 : bFixed ? 1 : 0.5
          move(a, axis, -dir * total * shareA)
          move(b, axis, dir * total * (1 - shareA))
        }
      }
    }
  }
  return found
}

/** Rectangular collision force during the simulation (changes velocity) */
export function forceRectCollide<N extends RectNode>(
  strength = 1,
  iterations = 2
): Force<N, never> {
  let nodes: N[] = []
  let stamp = new Int32Array(0)
  function force(): void {
    for (let k = 0; k < iterations; k++) collidePass(nodes, stamp, 'velocity', strength)
  }
  force.initialize = (ns: N[]): void => {
    nodes = ns
    stamp = new Int32Array(ns.length)
  }
  return force
}

/**
 * Cleanup after convergence: collision only, moving positions directly until nothing overlaps (or a limit is reached).
 * Each node moves only the minimum distance needed to resolve its overlap, so the overall shape is unchanged. Returns the overlaps left in the last round.
 */
export function resolveOverlaps(nodes: RectNode[], maxPasses = 60): number {
  const stamp = new Int32Array(nodes.length)
  let found = 0
  for (let k = 0; k < maxPasses; k++) {
    found = collidePass(nodes, stamp, 'position', 1)
    if (found === 0) break
  }
  return found
}
