// 圖譜的純函式：鄰接、局部圖、節點大小、初始座標、增量更新。不碰 DOM 與 Cytoscape。
import type { GraphData, GraphEdge, LinkType } from '../../shared/types'

export interface Point {
  x: number
  y: number
}

/** 同一對筆記可能同時有多種類型的邊，所以 id 包含類型 */
export const edgeId = (e: Pick<GraphEdge, 'source' | 'target' | 'type'>): string =>
  `${e.source}\u0000${e.target}\u0000${e.type}`

/** 只保留 types 中的邊（節點不變） */
export function filterEdges(data: GraphData, types: ReadonlySet<LinkType>): GraphData {
  return { nodes: data.nodes, edges: data.edges.filter((e) => types.has(e.type)) }
}

/** 不分方向的鄰接表（每篇筆記都有一項，孤立筆記為空集合） */
export function adjacency(data: GraphData): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(data.nodes.map((n) => [n.path, new Set<string>()]))
  for (const e of data.edges) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }
  return adj
}

/** 以 center 為中心、不分方向走 depth 步內的筆記，以及它們之間的邊 */
export function localSubgraph(data: GraphData, center: string, depth: number): GraphData {
  const adj = adjacency(data)
  if (!adj.has(center)) return { nodes: [], edges: [] }
  const seen = new Set([center])
  let frontier = [center]
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = []
    for (const p of frontier) {
      for (const q of adj.get(p)!) {
        if (!seen.has(q)) {
          seen.add(q)
          next.push(q)
        }
      }
    }
    frontier = next
  }
  return {
    nodes: data.nodes.filter((n) => seen.has(n.path)),
    edges: data.edges.filter((e) => seen.has(e.source) && seen.has(e.target))
  }
}

/** hover 時要高亮的節點：自己與直接相連的筆記 */
export function neighborhood(adj: Map<string, Set<string>>, path: string): Set<string> {
  return new Set([path, ...(adj.get(path) ?? [])])
}

/** 節點半徑：連結越多越大，但有上限 */
export function nodeRadius(degree: number): number {
  return Math.min(4 + 2.2 * Math.sqrt(degree), 18)
}

/**
 * 每個節點的初始座標：已知座標沿用；新節點放在已有座標的鄰居附近，沒有的話散在圓內。
 * 這讓資料更新或重開圖譜時不會整張重排。
 */
export function seedPositions(
  data: GraphData,
  known: ReadonlyMap<string, Point>,
  random: () => number = Math.random
): Map<string, Point> {
  const adj = adjacency(data)
  const out = new Map<string, Point>()
  const spread = 30 * Math.sqrt(data.nodes.length + 1)
  const jitter = (): number => (random() - 0.5) * 40
  const pending: string[] = []
  for (const n of data.nodes) {
    const p = known.get(n.path)
    if (p) out.set(n.path, { ...p })
    else pending.push(n.path)
  }
  // 兩輪：第二輪讓「鄰居也是新節點」的筆記能靠到第一輪放好的位置
  for (let round = 0; round < 2; round++) {
    for (const path of pending) {
      if (out.has(path)) continue
      const placed = [...adj.get(path)!].map((q) => out.get(q)).filter((p): p is Point => !!p)
      if (placed.length) {
        const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length
        const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length
        out.set(path, { x: cx + jitter(), y: cy + jitter() })
      } else if (round === 1) {
        const a = random() * 2 * Math.PI
        const r = spread * Math.sqrt(random())
        out.set(path, { x: r * Math.cos(a), y: r * Math.sin(a) })
      }
    }
    // 第一輪沒有任何已知座標可依附時，先放一個節點當錨點
    if (round === 0 && out.size === 0 && pending.length) out.set(pending[0], { x: 0, y: 0 })
  }
  return out
}

export interface GraphDiff {
  addNodes: string[]
  removeNodes: string[]
  /** 標題或日期改變的節點 */
  updateNodes: string[]
  addEdges: GraphEdge[]
  removeEdges: string[]
  /** 權重改變的邊 */
  updateEdges: GraphEdge[]
}

/** 前後兩份圖譜資料的差異，用來增量更新 Cytoscape */
export function diffGraph(prev: GraphData, next: GraphData): GraphDiff {
  const prevNodes = new Map(prev.nodes.map((n) => [n.path, n]))
  const nextNodes = new Map(next.nodes.map((n) => [n.path, n]))
  const prevEdges = new Map(prev.edges.map((e) => [edgeId(e), e]))
  const nextEdges = new Map(next.edges.map((e) => [edgeId(e), e]))
  const diff: GraphDiff = {
    addNodes: [],
    removeNodes: [],
    updateNodes: [],
    addEdges: [],
    removeEdges: [],
    updateEdges: []
  }
  for (const [path, n] of nextNodes) {
    const p = prevNodes.get(path)
    if (!p) diff.addNodes.push(path)
    else if (p.title !== n.title || p.eventDate !== n.eventDate) diff.updateNodes.push(path)
  }
  for (const path of prevNodes.keys()) if (!nextNodes.has(path)) diff.removeNodes.push(path)
  for (const [id, e] of nextEdges) {
    const p = prevEdges.get(id)
    if (!p) diff.addEdges.push(e)
    else if (p.weight !== e.weight) diff.updateEdges.push(e)
  }
  for (const id of prevEdges.keys()) if (!nextEdges.has(id)) diff.removeEdges.push(id)
  return diff
}
