// 圖譜的時間範圍篩選（純函式）。只決定哪些節點要隱藏，不影響版面配置。
import { dayNumber } from '../../shared/time'
import type { GraphData, GraphNode } from '../../shared/types'

/** event：內容講的事何時發生（eventDate）；written：何時寫的（有 create / edit 的日期） */
export type TimeAxis = 'event' | 'written'

export interface TimeFilter {
  axis: TimeAxis
  /** 範圍（dayNumber，含兩端）；null 表示不限 */
  range: [number, number] | null
  /** 是否顯示在這個時間軸上沒有日期的筆記 */
  undated: boolean
}

/** 節點在這個時間軸上的日期（dayNumber，遞增） */
export function nodeDays(n: GraphNode, axis: TimeAxis): number[] {
  if (axis === 'event') return n.eventDate ? [dayNumber(n.eventDate)] : []
  return n.activeDays.map(dayNumber)
}

/** 所有節點日期的最小與最大值；沒有任何日期時為 null */
export function timeDomain(data: GraphData, axis: TimeAxis): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const n of data.nodes) {
    const days = nodeDays(n, axis)
    if (!days.length) continue
    min = Math.min(min, days[0])
    max = Math.max(max, days[days.length - 1])
  }
  return min <= max ? [min, max] : null
}

/** 要隱藏的節點：沒有日期且不顯示未標日期的，或沒有任何日期落在範圍內的 */
export function hiddenByTime(data: GraphData, f: TimeFilter): Set<string> {
  const hidden = new Set<string>()
  for (const n of data.nodes) {
    const days = nodeDays(n, f.axis)
    if (!days.length) {
      if (!f.undated) hidden.add(n.path)
    } else if (f.range) {
      const [from, to] = f.range
      if (!days.some((d) => d >= from && d <= to)) hidden.add(n.path)
    }
  }
  return hidden
}

/**
 * 雙把手滑桿移動其中一端後的範圍：限制在 domain 內，且起點不超過終點
 * （拖過頭時推著另一端一起走）。
 */
export function moveRange(
  range: [number, number],
  domain: [number, number],
  end: 0 | 1,
  value: number
): [number, number] {
  const v = Math.min(domain[1], Math.max(domain[0], Math.round(value)))
  return end === 0 ? [v, Math.max(v, range[1])] : [Math.min(v, range[0]), v]
}

/** 限制在 domain 內（資料更新後範圍可能超出）；與 domain 相同時回傳 null（不限） */
export function clampRange(
  range: [number, number] | null,
  domain: [number, number] | null
): [number, number] | null {
  if (!range || !domain) return null
  const from = Math.max(domain[0], Math.min(range[0], domain[1]))
  const to = Math.min(domain[1], Math.max(range[1], from))
  return from === domain[0] && to === domain[1] ? null : [from, to]
}
