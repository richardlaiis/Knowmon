// 模糊比對（Quick switcher 與 [[ 自動補全共用，純函式）
import type { NoteSummary } from '../../../shared/types'

const BOUNDARY = /[\s/\\\-_.()[\]]/

/**
 * query 的字元依序出現在 text 中就算符合（不分大小寫，忽略 query 的空白），分數越高越好；不符合回傳 null。
 * 連續字串命中 > 字首/分隔符號後命中 > 零散命中；text 越短越好。
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()

  const idx = t.indexOf(q)
  if (idx >= 0) {
    const atBoundary = idx === 0 || BOUNDARY.test(t[idx - 1])
    return 1000 + (idx === 0 ? 300 : atBoundary ? 150 : 0) - idx - (t.length - q.length) * 0.5
  }

  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    score += 10
    if (found === prev + 1) score += 15
    if (found === 0 || BOUNDARY.test(t[found - 1])) score += 10
    score -= Math.min(found - ti, 10)
    prev = found
    ti = found + 1
  }
  return score - (t.length - q.length) * 0.5
}

/**
 * 依 query 排序筆記：標題比路徑優先；query 為空時最近開啟的在前，其餘依修改時間。
 * recent 是最近開啟的路徑，越前面越近。
 */
export function rankNotes(
  notes: readonly NoteSummary[],
  query: string,
  recent: readonly string[] = [],
  limit = 50
): NoteSummary[] {
  const recency = new Map(recent.map((p, i) => [p, recent.length - i]))
  if (!query.trim()) {
    return [...notes]
      .sort(
        (a, b) =>
          (recency.get(b.path) ?? 0) - (recency.get(a.path) ?? 0) || b.modifiedAt - a.modifiedAt
      )
      .slice(0, limit)
  }
  const scored: { note: NoteSummary; score: number }[] = []
  for (const note of notes) {
    const byTitle = fuzzyScore(query, note.title)
    const byPath = fuzzyScore(query, note.path.replace(/\.md$/i, ''))
    if (byTitle === null && byPath === null) continue
    const score = Math.max(byTitle === null ? -Infinity : byTitle + 500, byPath ?? -Infinity)
    scored.push({ note, score: score + (recency.has(note.path) ? 5 : 0) })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path))
    .slice(0, limit)
    .map((s) => s.note)
}
