// 力導向版面配置（d3-force）。純邏輯，在 Web Worker 裡執行（layout.worker.ts），測試時直接在 Node 跑。
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
  /** 節點半徑，避免重疊 */
  r: number
  /** 節點下方標籤的寬度（估計值）；連同標籤一起避免重疊。0 或省略表示沒有標籤 */
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

/** alpha 低於這個值就視為收斂、停止計算 */
export const ALPHA_MIN = 0.02

export class ForceLayout {
  private readonly sim: Simulation<SimNode, SimulationLinkDatum<SimNode>>
  private readonly nodes: SimNode[]
  private readonly index: Map<string, number>
  /** 這次收斂後是否已整理過重疊 */
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
      // 參數依實測調整（docs/plans/phase3-graph.md）：斥力夠強、向心力夠弱，標籤才有空間不重疊。
      // 不設 distanceMax：限制斥力距離會讓大型圖譜中心過度擠壓。theta 越大越快但越不精確。
      .force('charge', forceManyBody<SimNode>().strength(-250).theta(0.9))
      // 節點連同下方標籤的矩形不重疊
      .force('collide', forceRectCollide<SimNode>(1, 3))
      // 用微弱的 x/y 引力取代 center，讓孤立筆記與小群組不會飄走
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

  /** 在 budgetMs 內盡量多算幾步（至少一步），回傳算了幾步 */
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
   * 收斂時做一次整理：模擬中的碰撞力會被連結與向心力抵銷一部分，
   * 這裡只做碰撞、直接把仍重疊的節點（含標籤）推開。
   */
  private settleIfDone(): void {
    if (!this.done || this.settled) return
    this.settled = true
    resolveOverlaps(this.nodes)
  }

  /** 依 ids 的順序輸出 [x0, y0, x1, y1, ...] */
  positions(): Float32Array {
    const out = new Float32Array(this.nodes.length * 2)
    this.nodes.forEach((n, i) => {
      out[i * 2] = n.x ?? 0
      out[i * 2 + 1] = n.y ?? 0
    })
    return out
  }

  /** 拖曳中：固定節點位置並讓其他節點跟著調整 */
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
