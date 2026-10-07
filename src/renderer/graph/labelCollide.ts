// 讓節點連同下方的標籤一起不重疊的碰撞力（d3-force 自訂 force）。
// Cytoscape 的標籤與節點在同一個座標系（跟著縮放），所以版面上不重疊，任何縮放倍率都不會重疊。
import type { Force, SimulationNodeDatum } from 'd3-force'

/** 與 style.ts 的標籤樣式一致 */
export const LABEL_FONT_SIZE = 11
export const LABEL_GAP = 4
/** 每個佔位框四周保留的空隙 */
const PAD = 3

/**
 * 估計標籤寬度（Worker 裡沒有 DOM 可量字）：中日韓文字與全形符號約一個字寬，其他約 0.6 個字寬。
 * 寧可估大一點：略多的空隙比重疊好。
 */
export function estimateLabelWidth(text: string, fontSize = LABEL_FONT_SIZE): number {
  let w = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    w += code >= 0x1100 && !(code >= 0xff61 && code <= 0xffdc) ? 1 : ch === ' ' ? 0.3 : 0.62
  }
  return Math.ceil(w * fontSize)
}

/** 節點加上標籤的佔位框，以節點中心為原點：左右各 half，上 top、下 bottom */
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

/** 格子大小：大部分佔位框只會落在 1–4 格 */
const CELL = 80
const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768)

/**
 * 找出重疊的佔位框並推開，沿重疊較少的方向。回傳這一輪發現的重疊數。
 * - velocity：改速度（模擬過程中使用，與 d3 的 forceCollide 相同做法），推開 strength 倍的重疊量
 * - position：直接改座標（收斂後的整理），完整推開；被固定（拖曳中）的節點不動，由另一個節點讓開
 * 以格子分區，只比較附近的節點，每一輪約 O(n)。
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
          // 中心相同時依索引決定方向，避免卡住
          const dir =
            Math.sign(
              axis === 'x' ? x1[j] + x2[j] - x1[i] - x2[i] : y1[j] + y2[j] - y1[i] - y2[i]
            ) || 1
          // 直接移動座標時多推 0.5px，避免浮點誤差讓剛好相接的框又被算成重疊
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

/** 模擬過程中的矩形碰撞力（改速度） */
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
 * 收斂後的整理：只做碰撞，直接移動座標直到沒有重疊（或達到上限）。
 * 每個節點只移動解開重疊所需的最小距離，整體形狀不變。回傳最後一輪剩下的重疊數。
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
