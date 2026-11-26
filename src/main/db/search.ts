// Full-text search (FTS5 trigram). trigram only matches terms of 3+ characters, so shorter ones (common 2-character Chinese words) use LIKE.
import type { SearchHit } from '../../shared/types'
import type { DB } from '.'
import { clip, findAll, toSegments, type Range } from './segments'

const SNIPPET_MAX = 160

/** Splits on whitespace and removes duplicates (case-insensitive) */
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

/** Every term must appear (AND). Notes whose titles contain every term come first, then by bm25 or most recent modification. */
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

/** Extracts the text around the first match; when the body has no match (only the title does), takes the start */
export function snippet(body: string, terms: readonly string[]): SearchHit['snippet'] {
  const text = body.trim()
  const ranges: Range[] = terms.flatMap((t) => findAll(text, t))
  const c = clip(text, ranges, SNIPPET_MAX)
  return toSegments(c.text, c.ranges)
}
