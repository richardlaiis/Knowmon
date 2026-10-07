// 全文搜尋（FTS5 trigram）。trigram 只能比對 3 字以上，較短的詞（常見的 2 字中文詞）改用 LIKE。
import type { SearchHit } from '../../shared/types'
import type { DB } from '.'
import { clip, findAll, toSegments, type Range } from './segments'

const SNIPPET_MAX = 160

/** 依空白切詞，去掉重複（不分大小寫） */
export function searchTerms(query: string): string[] {
  const seen = new Set<string>()
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => {
      const k = t.toLowerCase()
      if (!t || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

const isLong = (t: string): boolean => [...t].length >= 3
const likePattern = (t: string): string => '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
const quote = (t: string): string => '"' + t.replace(/"/g, '""') + '"'

/** 所有詞都要出現（AND）。標題包含所有詞的排前面，其次依 bm25 或最近修改時間。 */
export function searchNotes(db: DB, query: string, limit = 50): SearchHit[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  const long = terms.filter(isLong)
  const short = terms.filter((t) => !isLong(t))

  const where: string[] = []
  const params: unknown[] = []
  const titleHit = terms.map(() => "f.title LIKE ? ESCAPE '\\'").join(' AND ')
  const titleParams = terms.map(likePattern)
  if (long.length) {
    where.push('notes_fts MATCH ?')
    params.push(long.map(quote).join(' AND '))
  }
  for (const t of short) {
    where.push("(f.title LIKE ? ESCAPE '\\' OR f.body LIKE ? ESCAPE '\\')")
    params.push(likePattern(t), likePattern(t))
  }
  const rank = long.length ? 'bm25(notes_fts, 10.0, 1.0)' : '-n.modified_at'
  const rows = db
    .prepare(
      `SELECT n.path AS path, n.title AS title, f.body AS body
       FROM notes_fts f JOIN notes n ON n.id = f.rowid
       WHERE ${where.join(' AND ')}
       ORDER BY (${titleHit}) DESC, ${rank}, n.path
       LIMIT ?`
    )
    .all(...params, ...titleParams, Math.max(1, Math.min(limit, 500))) as {
    path: string
    title: string
    body: string
  }[]

  return rows.map((r) => ({ path: r.path, title: r.title, snippet: snippet(r.body, terms) }))
}

/** 擷取第一個命中位置附近的文字；內文沒有命中（只有標題命中）時取開頭 */
export function snippet(body: string, terms: readonly string[]): SearchHit['snippet'] {
  const text = body.trim()
  const ranges: Range[] = terms.flatMap((t) => findAll(text, t))
  const c = clip(text, ranges, SNIPPET_MAX)
  return toSegments(c.text, c.ranges)
}
