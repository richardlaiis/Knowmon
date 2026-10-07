// 在 Web Worker 中執行力導向版面配置，每一幀回傳座標，主執行緒只負責繪製
import { ALPHA_MIN, ForceLayout, type LayoutEdgeInput, type LayoutNodeInput } from './forceLayout'
import type { WorkerRequest, WorkerResponse } from './protocol'

const FRAME_MS = 16
const BUDGET_MS = 10
/** 不串流時回報進度的間隔 */
const PROGRESS_MS = 150

let layout: ForceLayout | null = null
let generation = 0
let stream = true
let startAlpha = 1
let lastProgress = 0
let timer: ReturnType<typeof setTimeout> | null = null

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer })
}

function loop(): void {
  timer = null
  if (!layout) return
  layout.tickFor(BUDGET_MS)
  if (stream || layout.done) {
    const positions = layout.positions()
    post({ type: 'positions', generation, positions, done: layout.done }, [positions.buffer])
  } else if (performance.now() - lastProgress > PROGRESS_MS) {
    lastProgress = performance.now()
    // alpha 以指數遞減，用對數換算成大致線性的進度
    const progress = Math.log(startAlpha / layout.alpha) / Math.log(startAlpha / ALPHA_MIN)
    post({ type: 'progress', generation, progress: Math.min(1, Math.max(0, progress)) })
  }
  if (!layout.done) timer = setTimeout(loop, stream ? FRAME_MS - BUDGET_MS : 0)
}

function start(): void {
  if (timer === null) timer = setTimeout(loop, 0)
}

function init(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], alpha: number): void {
  layout = new ForceLayout(nodes, edges, alpha)
  startAlpha = Math.max(alpha, ALPHA_MIN * 1.01)
  start()
}

self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      generation = msg.generation
      stream = msg.stream
      init(msg.nodes, msg.edges, msg.alpha)
      break
    case 'pin':
      layout?.pin(msg.id, msg.x, msg.y)
      if (layout) startAlpha = layout.alpha
      start()
      break
    case 'unpin':
      layout?.unpin(msg.id)
      break
    case 'reheat':
      layout?.reheat(msg.alpha)
      if (layout) startAlpha = layout.alpha
      start()
      break
    case 'stop':
      if (timer !== null) clearTimeout(timer)
      timer = null
      layout = null
      break
  }
}
