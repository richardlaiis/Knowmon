// 主執行緒與版面配置 Worker 之間的訊息格式
import type { LayoutEdgeInput, LayoutNodeInput } from './forceLayout'

export type WorkerRequest =
  | {
      type: 'init'
      /** 每次重新初始化遞增，丟棄舊資料遲到的座標 */
      generation: number
      nodes: LayoutNodeInput[]
      edges: LayoutEdgeInput[]
      /** 初始溫度：全新版面用 1，只有少量變動時用較小的值 */
      alpha: number
      /**
       * true：每一幀回傳座標（邊算邊畫）。大型圖譜重畫一次就很貴，
       * 設為 false 時只在收斂後回傳一次，期間以 progress 回報進度。
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
      /** 依 init 時 nodes 的順序：[x0, y0, x1, y1, ...] */
      positions: Float32Array
      done: boolean
    }
  | {
      /** 不串流時的進度回報（0–1） */
      type: 'progress'
      generation: number
      progress: number
    }
