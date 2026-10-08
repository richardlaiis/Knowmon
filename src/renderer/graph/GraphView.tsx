// 圖譜視圖：Cytoscape 繪製與互動，版面配置在 Web Worker（layout.worker.ts）計算
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
  /** 目前開著的筆記，以強調色標示 */
  current: string | null
  /** newTab：Ctrl/Cmd+點擊 */
  onOpen: (path: string, newTab: boolean) => void
  /** 節點座標快取，由呼叫者保存（同一個 vault 重開圖譜時不重排） */
  positions: Map<string, Point>
  labels: boolean
  /** 主題改變時改變，重新套用顏色 */
  theme: string
  /** 遞增時清掉座標重新排列 */
  relayoutKey: number
  /** 遞增時縮放到整張圖 */
  fitKey: number
  /** 節點有增減時，排版收斂後自動縮放到整張圖（局部圖切換筆記時用） */
  autoFit?: boolean
  /** 大型圖譜排版中的進度（0–1），完成時為 null */
  onProgress?: (progress: number | null) => void
  /** 隱藏的節點（時間篩選）：只是不顯示，仍參與版面配置，所以篩選時節點不會移動 */
  hidden?: ReadonlySet<string>
}

/** 新增/刪除的節點少於這個比例時只輕度加熱，不重排整張圖 */
const SMALL_CHANGE = 0.2
const FIT_PADDING = 40
/** 縮放到整張圖時的最大倍率，避免筆記很少時被放得很大 */
const MAX_FIT_ZOOM = 1.2
/**
 * 超過這個節點數視為大型圖譜（實測 1000 篇時 Cytoscape 每次整張重畫約 25–110ms）：
 * 排版收斂後才一次套用座標，hover 只高亮鄰居、不淡化其他元素。
 */
export const LARGE_GRAPH = 500

/** 縮放到整張圖；容器還沒有大小（例如被隱藏）時回傳 false */
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
  /** 目前 Worker 版面的節點順序（對應回傳的座標陣列） */
  ids: string[]
  generation: number
  pending: Float32Array | null
  frame: number
  /** 這次排版收斂後縮放到整張圖 */
  fitWhenDone: boolean
  /** 隱藏時無法縮放，等容器有大小時再做 */
  fitWhenVisible: boolean
  /** 套用隱藏節點的 requestAnimationFrame（拖動時間滑桿時每幀最多一次） */
  hideFrame: number
}

const EMPTY: GraphData = { nodes: [], edges: [] }

/** 把 Cytoscape 的元素更新成 data，必要時重新啟動 Worker 的版面配置 */
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
    // 連結數改變會影響節點大小
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

  // 大部分座標都有快取（重開圖譜、少量變動）時只微調，否則重新排列
  const alpha = fresh
    ? cached >= data.nodes.length * (1 - SMALL_CHANGE)
      ? 0.3
      : 1
    : changed > data.nodes.length * SMALL_CHANGE
      ? 0.8
      : 0.3
  const nodes = data.nodes.map((n) => {
    const p = cy.getElementById(n.path).position()
    // 標籤關閉時也保留標籤的位置，切換標籤時版面不會跳動
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
  // 事件處理器透過 ref 取得最新的 props，Cytoscape 只建立一次
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  // ---- 建立 Cytoscape 與 Worker ----
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
      // 平移、縮放時以點陣圖代替重畫，大型圖譜仍然流暢
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
      // 同一幀只套用最後一次收到的座標
      if (!s.frame) s.frame = requestAnimationFrame(applyPositions)
      if (msg.done && s.fitWhenDone) {
        s.fitWhenDone = false
        requestAnimationFrame(() => {
          if (!fitView(cy)) s.fitWhenVisible = true
        })
      }
    }

    // hover：高亮自己與鄰居；小型圖譜同時淡化其他元素（大型圖譜整張重新套樣式太貴）
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
    // 拖曳節點：固定在游標位置，其他節點跟著調整
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

  // ---- 資料更新：增量修改 Cytoscape，必要時重新排列 ----
  useEffect(() => {
    if (cyRef.current && workerRef.current) {
      sync(cyRef.current, workerRef.current, state.current, data, positions, latest.current.autoFit)
    }
  }, [data, positions])

  // ---- 重新排列：清掉座標快取與畫面，再以相同資料重建 ----
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
    // 只在 relayoutKey 改變時執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayoutKey])

  // ---- 時間篩選：切換節點的 hidden class（相連的邊跟著隱藏），不重新排版 ----
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

  // ---- 目前的筆記 ----
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes('.current').removeClass('current')
      if (current) cy.getElementById(current).addClass('current')
    })
  }, [current, data, relayoutKey])

  // ---- 樣式（主題、標籤） ----
  useEffect(() => {
    cyRef.current?.style(graphStyle(readColors(), labels))
  }, [labels, theme])

  useEffect(() => {
    const cy = cyRef.current
    if (fitKey > 0 && cy) fitView(cy)
  }, [fitKey])

  return <div className="graph-canvas" ref={host} />
}
