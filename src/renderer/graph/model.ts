// Pure functions for the graph: adjacency, local graphs, node size, initial positions, incremental updates. No DOM or Cytoscape.
import type { GraphData, GraphEdge, LinkType } from '../../shared/types'

export interface Point {
  x: number
  y: number
}

/** A pair of notes may have edges of several types, so the id includes the type */
export const edgeId = (e: Pick<GraphEdge, 'source' | 'target' | 'type'>): string =>
  `${e.source}\u0000${e.target}\u0000${e.type}`

/** Keeps only edges in types (nodes unchanged) */
export function filterEdges(data: GraphData, types: ReadonlySet<LinkType>): GraphData {
  return { nodes: data.nodes, edges: data.edges.filter((e) => types.has(e.type)) }
}

/** Undirected adjacency lists (one entry per note; an empty set for isolated notes) */
export function adjacency(data: GraphData): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(data.nodes.map((n) => [n.path, new Set<string>()]))
  for (const e of data.edges) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }
  return adj
}

/** Notes within depth steps of center (undirected), and the edges between them */
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

/** Nodes to highlight on hover: the note itself and its direct neighbors */
export function neighborhood(adj: Map<string, Set<string>>, path: string): Set<string> {
  return new Set([path, ...(adj.get(path) ?? [])])
}

/** Node radius: more links means larger, up to a limit */
export function nodeRadius(degree: number): number {
  return Math.min(4 + 2.2 * Math.sqrt(degree), 18)
}

/**
 * Initial position of each node: known positions are kept; new nodes go near neighbors that have positions, or are scattered in a circle otherwise.
 * This way data updates or reopening the graph don't redo the whole layout.
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
  // Two rounds: the second lets notes whose neighbors are also new move next to positions placed in the first round
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
    // When the first round has no known position to attach to, place one node as an anchor first
    if (round === 0 && out.size === 0 && pending.length) out.set(pending[0], { x: 0, y: 0 })
  }
  return out
}

export interface GraphDiff {
  addNodes: string[]
  removeNodes: string[]
  /** Nodes whose title or date changed */
  updateNodes: string[]
  addEdges: GraphEdge[]
  removeEdges: string[]
  /** Edges whose weight changed */
  updateEdges: GraphEdge[]
}

/** Differences between two versions of the graph data, for updating Cytoscape incrementally */
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
