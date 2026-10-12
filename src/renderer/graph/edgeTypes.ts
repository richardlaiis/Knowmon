// 圖譜邊的類型：顯示名稱與篩選偏好（localStorage）
import type { LinkType } from '../../shared/types'

export const EDGE_TYPES: { type: LinkType; label: string; title: string }[] = [
  { type: 'wikilink', label: 'Links', title: '[[Wikilinks]] written in notes' },
  { type: 'same_session', label: 'Session', title: 'Edited in the same work session' },
  { type: 'same_day', label: 'Same day', title: 'Event dates on the same (or a nearby) day' },
  { type: 'sequence', label: 'Sequence', title: 'Previous / next dated note in the same folder' },
  { type: 'semantic', label: 'Semantic', title: 'Similar content (local embeddings)' }
]

const ALL = EDGE_TYPES.map((t) => t.type)

/**
 * 解析儲存的偏好：「a,-b」表示 a 開、b 關。沒有提到的類型預設開啟
 * （之後新增的類型，例如階段 5 的 semantic，在舊的偏好裡不會出現）。
 * 舊格式只記開著的類型（沒有 -），沒提到的原有類型視為關閉。
 */
export function parseEdgeTypes(raw: string | null): Set<LinkType> {
  if (raw === null) return new Set(ALL)
  const items = raw.split(',').filter(Boolean)
  const legacy = !items.some((t) => t.startsWith('-'))
  const LEGACY_TYPES: LinkType[] = ['wikilink', 'same_session', 'same_day', 'sequence']
  return new Set(
    ALL.filter((t) => {
      if (items.includes(t)) return true
      if (items.includes(`-${t}`)) return false
      return !(legacy && LEGACY_TYPES.includes(t))
    })
  )
}

export function serializeEdgeTypes(types: ReadonlySet<LinkType>): string {
  return ALL.map((t) => (types.has(t) ? t : `-${t}`)).join(',')
}

/** 讀取已選的類型；沒有紀錄或無法讀取時全選 */
export function loadEdgeTypes(key: string): Set<LinkType> {
  try {
    return parseEdgeTypes(localStorage.getItem(key))
  } catch {
    return new Set(ALL)
  }
}

export function saveEdgeTypes(key: string, types: ReadonlySet<LinkType>): void {
  try {
    localStorage.setItem(key, serializeEdgeTypes(types))
  } catch {
    // 無法儲存時仍可切換
  }
}
