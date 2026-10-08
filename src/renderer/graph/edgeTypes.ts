// 圖譜邊的類型：顯示名稱與篩選偏好（localStorage）
import type { LinkType } from '../../shared/types'

export const EDGE_TYPES: { type: LinkType; label: string; title: string }[] = [
  { type: 'wikilink', label: 'Links', title: '[[Wikilinks]] written in notes' },
  { type: 'same_session', label: 'Session', title: 'Edited in the same work session' },
  { type: 'same_day', label: 'Same day', title: 'Event dates on the same (or a nearby) day' },
  { type: 'sequence', label: 'Sequence', title: 'Previous / next dated note in the same folder' }
]

const ALL = EDGE_TYPES.map((t) => t.type)

/** 讀取已選的類型（逗號分隔）；沒有紀錄或無法讀取時全選 */
export function loadEdgeTypes(key: string): Set<LinkType> {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return new Set(ALL)
    return new Set(ALL.filter((t) => raw.split(',').includes(t)))
  } catch {
    return new Set(ALL)
  }
}

export function saveEdgeTypes(key: string, types: ReadonlySet<LinkType>): void {
  try {
    localStorage.setItem(key, ALL.filter((t) => types.has(t)).join(','))
  } catch {
    // 無法儲存時仍可切換
  }
}
