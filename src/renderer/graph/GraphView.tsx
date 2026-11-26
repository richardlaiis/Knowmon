// Graph view: Cytoscape draws and handles interaction, and layout is computed in a Web Worker (layout.worker.ts)
import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape'
import type { GraphData } from '../../shared/types'
import {
  adjacency,
  diffGraph,
  edgeId,
  neighborhood,
  nodeRadius,
  seedPositions,
  type Point
} from './model'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { estimateLabelWidth } from './labelCollide'
import { graphStyle, readColors } from './style'

export interface GraphViewProps {
  data: GraphData
  /** The currently open note, shown in the accent color */
  current: string | null
  /** newTab: Ctrl/Cmd+click */
  onOpen: (path: string, newTab: boolean) => void
  /** Node position cache, kept by the caller (reopening the graph for the same vault doesn't redo the layout) */
  positions: Map<string, Point>
  labels: boolean
  /** Changes when the theme changes, to reapply colors */
  theme: string
  /** Incremented to clear positions and lay out again */
  relayoutKey: number
  /** Incremented to zoom to fit the whole graph */
  fitKey: number
  /** When nodes are added or removed, zoom to fit once the layout converges (used when the local graph switches notes) */
  autoFit?: boolean
  /** Layout progress (0–1) for large graphs; null when done */
  onProgress?: (progress: number | null) => void
  /** Hidden nodes (time filter): only not shown, still part of the layout, so nodes don't move when filtering */
  hidden?: ReadonlySet<string>
}

/** When fewer than this fraction of nodes are added/removed, only reheat gently instead of redoing the whole layout */
const SMALL_CHANGE = 0.2
const FIT_PADDING = 40
/** Maximum zoom when fitting the whole graph, so a few notes aren't blown up */
const MAX_FIT_ZOOM = 1.2
/**
 * Above this many nodes the graph counts as large (measured at 1000 notes, each full Cytoscape redraw takes about 25–110ms):
 * positions are applied once after the layout converges, and hover only highlights neighbors without fading other elements.
 */
export const LARGE_GRAPH = 500

/** Zooms to fit the whole graph; returns false when the container has no size yet (for example while hidden) */
function fitView(cy: Core): boolean {
  const visible = cy.nodes(':visible')
  if (visible.empty()) return true
  if (cy.width() === 0 || cy.height() === 0) return false
  cy.fit(visible, FIT_PADDING)
  if (cy.zoom() > MAX_FIT_ZOOM) {
    cy.zoom({
      level: MAX_FIT_ZOOM,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
    })
  }
  return true
}

interface ViewState {
  data: GraphData
  adj: Map<string, Set<string>>
  /** Node order of the current Worker layout (matching the returned position array) */
  ids: string[]
  generation: number
  pending: Float32Array | null
  frame: number
  /** Zoom to fit once this layout converges */
  fitWhenDone: boolean
  /** Can't zoom while hidden, so do it once the container has a size */
  fitWhenVisible: boolean
  /** requestAnimationFrame for applying hidden nodes (at most once per frame while dragging the time slider) */
  hideFrame: number
}

const EMPTY: GraphData = { nodes: [], edges: [] }

/** Updates the Cytoscape elements to data, restarting the Worker layout when needed */
function sync(
  cy: Core,
  worker: Worker,
  s: ViewState,
  data: GraphData,
  positions: Map<string, Point>,
  autoFit = false
): void {
  const fresh = s.data.nodes.length === 0
  const diff = diffGraph(s.data, data)
  const adj = adjacency(data)
  const titles = new Map(data.nodes.map((n) => [n.path, n.title]))
  const sizeOf = (path: string): number => nodeRadius(adj.get(path)?.size ?? 0) * 2
  const cached = data.nodes.filter((n) => positions.has(n.path)).length
  const seeded = seedPositions(data, positions)

  cy.batch(() => {
    for (const id of diff.removeEdges) cy.getElementById(id).remove()
    for (const path of diff.removeNodes) cy.getElementById(path).remove()
    const add: ElementDefinition[] = diff.addNodes.map((path) => ({
      group: 'nodes',
      data: { id: path, title: titles.get(path), size: sizeOf(path) },
      position: { ...seeded.get(path)! }
    }))
    for (const e of diff.addEdges) {
      add.push({
        group: 'edges',
        data: { id: edgeId(e), source: e.source, target: e.target, type: e.type, weight: e.weight }
      })
    }
    cy.add(add)
    for (const path of diff.updateNodes) cy.getElementById(path).data('title', titles.get(path))
    for (const e of diff.updateEdges) cy.getElementById(edgeId(e)).data('weight', e.weight)
    // A change in link count affects node size
    cy.nodes().forEach((n) => {
      const size = sizeOf(n.id())
      if (n.data('size') !== size) n.data('size', size)
    })
  })
  s.data = data
  s.adj = adj
  if (fresh) {
    s.fitWhenVisible = !fitView(cy)
    s.fitWhenDone = cached < data.nodes.length
  }

  const changed = diff.addNodes.length + diff.removeNodes.length
  const structural = changed + diff.addEdges.length + diff.removeEdges.length
  if (structural === 0) return
  if (autoFit) s.fitWhenDone = true

  // When most positions are cached (reopening the graph, small changes), only fine-tune; otherwise lay out again
  const alpha = fresh
    ? cached >= data.nodes.length * (1 - SMALL_CHANGE)
      ? 0.3
      : 1
    : changed > data.nodes.length * SMALL_CHANGE
      ? 0.8
      : 0.3
  const nodes = data.nodes.map((n) => {
    const p = cy.getElementById(n.path).position()
    // Label space is kept even when labels are off, so the layout doesn't jump when toggling them
    return {
      id: n.path,
      x: p.x,
      y: p.y,
      r: sizeOf(n.path) / 2,
      labelWidth: estimateLabelWidth(n.title)
    }
  })
  s.generation++
  s.ids = nodes.map((n) => n.id)
  const msg: WorkerRequest = {
    type: 'init',
    generation: s.generation,
    nodes,
    edges: data.edges.map((e) => ({ source: e.source, target: e.target })),
    alpha,
    stream: data.nodes.length <= LARGE_GRAPH
  }
  worker.postMessage(msg)
}

export function GraphView(props: GraphViewProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const state = useRef<ViewState>({
    data: EMPTY,
    adj: new Map(),
    ids: [],
    generation: 0,
    pending: null,
    frame: 0,
    fitWhenDone: true,
    fitWhenVisible: false,
    hideFrame: 0
  })
  const { data, current, positions, labels, theme, relayoutKey, fitKey, hidden } = props
  // Event handlers get the latest props through a ref, so Cytoscape is created only once
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  // ---- Creating Cytoscape and the Worker ----
  useEffect(() => {
    const s = state.current
    const cy = cytoscape({
      container: host.current,
      style: graphStyle(readColors(), latest.current.labels),
      layout: { name: 'preset' },
      minZoom: 0.05,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autounselectify: true,
      // While panning and zooming, use a bitmap instead of redrawing, so large graphs stay smooth
      textureOnViewport: true
    })
    cyRef.current = cy

    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const send = (msg: WorkerRequest): void => worker.postMessage(msg)

    const applyPositions = (): void => {
      s.frame = 0
      const pos = s.pending
      s.pending = null
      if (!pos) return
      const cache = latest.current.positions
      cy.batch(() => {
        s.ids.forEach((id, i) => {
          const p = { x: pos[i * 2], y: pos[i * 2 + 1] }
          cache.set(id, p)
          const n = cy.getElementById(id)
          if (n.nonempty() && !n.grabbed()) n.position(p)
        })
      })
    }
    worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
      const msg = e.data
      if (msg.generation !== s.generation) return
      if (msg.type === 'progress') {
        latest.current.onProgress?.(msg.progress)
        return
      }
      if (msg.done) latest.current.onProgress?.(null)
      s.pending = msg.positions
      // Apply only the last positions received within a frame
      if (!s.frame) s.frame = requestAnimationFrame(applyPositions)
      if (msg.done && s.fitWhenDone) {
        s.fitWhenDone = false
        requestAnimationFrame(() => {
          if (!fitView(cy)) s.fitWhenVisible = true
        })
      }
    }

    // hover: highlight itself and its neighbors; small graphs also fade other elements (restyling a whole large graph is too expensive)
    cy.on('mouseover', 'node', (e) => {
      const node = e.target as NodeSingular
      const keep = neighborhood(s.adj, node.id())
      const fade = s.data.nodes.length <= LARGE_GRAPH
      cy.batch(() => {
        if (fade) cy.elements().addClass('faded')
        const near = cy.collection()
        for (const id of keep) near.merge(cy.getElementById(id))
        near.removeClass('faded').addClass('highlight')
        node.connectedEdges().removeClass('faded').addClass('highlight')
      })
    })
    cy.on('mouseout', 'node', () => {
      const lit = cy.elements('.highlight, .faded')
      if (lit.nonempty()) cy.batch(() => lit.removeClass('faded highlight'))
    })
    cy.on('tap', 'node', (e) => {
      const oe = e.originalEvent as MouseEvent | undefined
      latest.current.onOpen(e.target.id(), !!oe && (oe.ctrlKey || oe.metaKey))
    })
    // Dragging a node: pin it at the cursor while the other nodes adjust
    cy.on('drag', 'node', (e) => {
      const { x, y } = (e.target as NodeSingular).position()
      send({ type: 'pin', id: e.target.id(), x, y })
    })
    cy.on('free', 'node', (e) => send({ type: 'unpin', id: e.target.id() }))

    const resize = new ResizeObserver(() => {
      cy.resize()
      if (s.fitWhenVisible && fitView(cy)) s.fitWhenVisible = false
    })
    resize.observe(host.current!)

    return () => {
      resize.disconnect()
      if (s.frame) cancelAnimationFrame(s.frame)
      if (s.hideFrame) cancelAnimationFrame(s.hideFrame)
      send({ type: 'stop' })
      worker.terminate()
      cy.destroy()
      cyRef.current = null
      workerRef.current = null
      s.data = EMPTY
    }
  }, [])

  // ---- Data updates: modify Cytoscape incrementally, laying out again when needed ----
  useEffect(() => {
    if (cyRef.current && workerRef.current) {
      sync(cyRef.current, workerRef.current, state.current, data, positions, latest.current.autoFit)
    }
  }, [data, positions])

  // ---- Re-layout: clear the position cache and the view, then rebuild with the same data ----
  useEffect(() => {
    const cy = cyRef.current
    const worker = workerRef.current
    if (relayoutKey === 0 || !cy || !worker) return
    const s = state.current
    const data = s.data
    positions.clear()
    cy.elements().remove()
    s.data = EMPTY
    sync(cy, worker, s, data, positions)
    // Runs only when relayoutKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayoutKey])

  // ---- Time filter: toggle nodes' hidden class (connected edges hide with them), without re-running layout ----
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const s = state.current
    if (s.hideFrame) cancelAnimationFrame(s.hideFrame)
    s.hideFrame = requestAnimationFrame(() => {
      s.hideFrame = 0
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          const hide = hidden?.has(n.id()) ?? false
          if (n.hasClass('hidden') !== hide) n.toggleClass('hidden', hide)
        })
      })
    })
  }, [hidden, data, relayoutKey])

  // ---- The current note ----
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes('.current').removeClass('current')
      if (current) cy.getElementById(current).addClass('current')
    })
  }, [current, data, relayoutKey])

  // ---- Styles (theme, labels) ----
  useEffect(() => {
    cyRef.current?.style(graphStyle(readColors(), labels))
  }, [labels, theme])

  useEffect(() => {
    const cy = cyRef.current
    if (fitKey > 0 && cy) fitView(cy)
  }, [fitKey])

  return <div className="graph-canvas" ref={host} />
}
