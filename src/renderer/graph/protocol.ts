// Message format between the main thread and the layout Worker
import type { LayoutEdgeInput, LayoutNodeInput } from './forceLayout'

export type WorkerRequest =
  | {
      type: 'init'
      /** Incremented on every reinitialization, discarding late positions for old data */
      generation: number
      nodes: LayoutNodeInput[]
      edges: LayoutEdgeInput[]
      /** Initial temperature: 1 for a brand-new layout, smaller when only a little changed */
      alpha: number
      /**
       * true: return positions every frame (drawing while computing). A single redraw of a large graph is already expensive,
       * so with false positions are returned only once after convergence, reporting progress meanwhile.
       */
      stream: boolean
    }
  | { type: 'pin'; id: string; x: number; y: number }
  | { type: 'unpin'; id: string }
  | { type: 'reheat'; alpha: number }
  | { type: 'stop' }

export type WorkerResponse =
  | {
      type: 'positions'
      generation: number
      /** In the order of nodes at init: [x0, y0, x1, y1, ...] */
      positions: Float32Array
      done: boolean
    }
  | {
      /** Progress report when not streaming (0–1) */
      type: 'progress'
      generation: number
      progress: number
    }
