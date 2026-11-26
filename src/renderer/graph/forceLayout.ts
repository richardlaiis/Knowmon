// Force-directed layout (d3-force). Pure logic, run in a Web Worker (layout.worker.ts) and directly in Node for tests.
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import { footprint, forceRectCollide, resolveOverlaps, type Footprint } from './labelCollide'

export interface LayoutNodeInput {
  id: string
  x: number
  y: number
  /** Node radius, to avoid overlap */
  r: number
  /** Width (estimated) of the label below the node; kept from overlapping along with the node. 0 or omitted means no label */
  labelWidth?: number
}

export interface LayoutEdgeInput {
  source: string
  target: string
}

interface SimNode extends SimulationNodeDatum {
  id: string
  r: number
  box: Footprint
}

/** Below this alpha the layout counts as converged and stops */
export const ALPHA_MIN = 0.02

export class ForceLayout {
  private readonly sim: Simulation<SimNode, SimulationLinkDatum<SimNode>>
  private readonly nodes: SimNode[]
  private readonly index: Map<string, number>
  /** Whether overlaps have been cleaned up after this convergence */
  private settled = false

  constructor(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[], alpha = 1) {
    this.nodes = nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      r: n.r,
      box: footprint(n.r, n.labelWidth ?? 0)
    }))
    this.index = new Map(this.nodes.map((n, i) => [n.id, i]))
    const links = edges
      .filter((e) => this.index.has(e.source) && this.index.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }))
    this.sim = forceSimulation<SimNode>(this.nodes)
      .stop()
      .alpha(alpha)
      .alphaMin(ALPHA_MIN)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((n) => n.id)
          .distance(70)
      )
      // Parameters tuned by measurement (docs/plans/phase3-graph.md): strong enough repulsion and weak enough centering give labels room not to overlap.
      // No distanceMax: limiting the repulsion distance squeezes the center of large graphs too much. A larger theta is faster but less accurate.
      .force('charge', forceManyBody<SimNode>().strength(-250).theta(0.9))
      // Rectangles of nodes plus their labels don't overlap
      .force('collide', forceRectCollide<SimNode>(1, 3))
      // Weak x/y attraction instead of center, so isolated notes and small groups don't drift away
      .force('x', forceX<SimNode>(0).strength(0.01))
      .force('y', forceY<SimNode>(0).strength(0.01))
  }

  get alpha(): number {
    return this.sim.alpha()
  }

  get done(): boolean {
    return this.sim.alpha() < ALPHA_MIN
  }

  get ids(): string[] {
    return this.nodes.map((n) => n.id)
  }

  tick(iterations = 1): void {
    this.sim.tick(iterations)
    this.settleIfDone()
  }

  /** Computes as many steps as possible within budgetMs (at least one) and returns how many */
  tickFor(budgetMs: number, now: () => number = () => performance.now()): number {
    const start = now()
    let n = 0
    do {
      this.sim.tick()
      n++
    } while (!this.done && now() - start < budgetMs)
    this.settleIfDone()
    return n
  }

  /**
   * A cleanup pass on convergence: the simulation's collision force is partly offset by links and centering,
   * so this does only collision, pushing apart nodes (with labels) that still overlap.
   */
  private settleIfDone(): void {
    if (!this.done || this.settled) return
    this.settled = true
    resolveOverlaps(this.nodes)
  }

  /** Outputs [x0, y0, x1, y1, ...] in the order of ids */
  positions(): Float32Array {
    const out = new Float32Array(this.nodes.length * 2)
    this.nodes.forEach((n, i) => {
      out[i * 2] = n.x ?? 0
      out[i * 2 + 1] = n.y ?? 0
    })
    return out
  }

  /** While dragging: fixes a node's position and lets the others adjust */
  pin(id: string, x: number, y: number): void {
    const n = this.nodes[this.index.get(id) ?? -1]
    if (!n) return
    n.fx = x
    n.fy = y
    this.reheat(0.3)
  }

  unpin(id: string): void {
    const n = this.nodes[this.index.get(id) ?? -1]
    if (!n) return
    n.fx = null
    n.fy = null
  }

  reheat(alpha = 0.3): void {
    if (this.sim.alpha() < alpha) this.sim.alpha(alpha)
    this.settled = this.done
  }
}
