// 混合檢索：全文（FTS5）+ 向量（sqlite-vec）以 Reciprocal Rank Fusion 合併，
// 再把前幾名的圖譜鄰居加進來，並可依日期篩選。查詢向量由呼叫者提供（null = 只用全文）。
import { localDay } from '../../shared/time'
import type { RetrieveHit, RetrieveOptions, RetrieveResult, SearchHit } from '../../shared/types'
import { getNoteBody, type DB } from '../db'
import { searchNotes, searchTerms } from '../db/search'
import { clip, findAll, toSegments, type Range } from '../db/segments'
import { nearestChunks } from '../db/vectors'

/** RRF 的常數：分數 = Σ 1 / (RRF_K + 名次) */
export const RRF_K = 60
/** 每種來源取前幾篇 */
export const SOURCE_DEPTH = 50
/** 前幾名的圖譜鄰居會加分 */
export const EXPAND_SEEDS = 5
/** 鄰居得到種子分數的這個比例 */
export const NEIGHBOR_FACTOR = 0.5
const SNIPPET_MAX = 160

type Via = RetrieveHit['via'][number]

interface Candidate {
  noteId: number
  score: number
  line: number
  /** 最相關的段落（向量命中的 chunk）；沒有時用全文摘要或筆記開頭 */
  text: string | null
  snippet: RetrieveHit['snippet'] | null
  via: Set<Via>
}

/** Reciprocal Rank Fusion：每份排名（由好到壞的 id）依名次給分後相加 */
export function reciprocalRankFusion(
  rankings: readonly (readonly number[])[]
): Map<number, number> {
  const scores = new Map<number, number>()
  for (const list of rankings) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)))
  }
  return scores
}

interface NoteRow {
  id: number
  path: string
  title: string
  eventDate: string | null
  modifiedAt: number
}

/** 篩選用的日期：event_date，沒有的話用最後修改日（本地時區） */
export function noteDay(n: Pick<NoteRow, 'eventDate' | 'modifiedAt'>): string {
  return n.eventDate ?? localDay(n.modifiedAt)
}

/**
 * keywords 有值時（問答用），全文改為每個關鍵字各自搜尋（OR），命中越多個關鍵字的排越前面；
 * 沒有關鍵字但有查詢向量時只用向量。
 */
export function retrieve(
  db: DB,
  query: string,
  queryVector: ArrayLike<number> | null,
  opts: RetrieveOptions = {},
  keywords?: readonly string[]
): RetrieveResult {
  const terms = keywords ? [...keywords] : searchTerms(query)
  if (terms.length === 0 && !(keywords && queryVector)) return { hits: [], vector: false }
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 20)))

  const notes = new Map(
    (
      db
        .prepare(
          'SELECT id, path, title, event_date AS eventDate, modified_at AS modifiedAt FROM notes'
        )
        .all() as NoteRow[]
    ).map((n) => [n.id, n])
  )
  const byPath = new Map([...notes.values()].map((n) => [n.path, n.id]))
  const allowed = (id: number): boolean => {
    const n = notes.get(id)
    if (!n) return false
    const day = noteDay(n)
    return (!opts.from || day >= opts.from) && (!opts.to || day <= opts.to)
  }
  const filtered = !!(opts.from || opts.to)

  const candidates = new Map<number, Candidate>()
  const candidate = (id: number): Candidate => {
    let c = candidates.get(id)
    if (!c) {
      c = { noteId: id, score: 0, line: 0, text: null, snippet: null, via: new Set() }
      candidates.set(id, c)
    }
    return c
  }

  // 1. 全文
  const fulltext: number[] = []
  const depth = filtered ? 500 : SOURCE_DEPTH
  for (const h of keywords ? searchAny(db, terms, depth) : searchNotes(db, query, depth)) {
    const id = byPath.get(h.path)
    if (id === undefined || !allowed(id)) continue
    fulltext.push(id)
    const c = candidate(id)
    c.via.add('fulltext')
    c.snippet = h.snippet
    c.line = firstMatchLine(getNoteBody(db, id) ?? '', terms)
    if (fulltext.length >= SOURCE_DEPTH) break
  }

  // 2. 向量：同一篇只取最近的一塊
  const vector: number[] = []
  if (queryVector) {
    for (const hit of nearestChunks(db, queryVector, filtered ? 1000 : SOURCE_DEPTH * 4)) {
      if (vector.includes(hit.noteId) || !allowed(hit.noteId)) continue
      vector.push(hit.noteId)
      const c = candidate(hit.noteId)
      c.via.add('vector')
      // 向量命中的段落比全文的第一個命中更能代表「為什麼相關」
      c.line = hit.line
      c.text = hit.text
      if (vector.length >= SOURCE_DEPTH) break
    }
  }

  // 3. 合併
  for (const [id, score] of reciprocalRankFusion([fulltext, vector])) candidate(id).score = score

  // 4. 圖譜鄰居
  if (opts.expand !== false && candidates.size > 0) {
    const seeds = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, EXPAND_SEEDS)
    const seedScore = new Map(seeds.map((s) => [s.noteId, s.score]))
    const marks = seeds.map(() => '?').join(',')
    const edges = db
      .prepare(
        `SELECT src, dst FROM links
         WHERE dst IS NOT NULL AND src != dst AND type IN ('wikilink', 'semantic')
           AND (src IN (${marks}) OR dst IN (${marks}))`
      )
      .all(...seedScore.keys(), ...seedScore.keys()) as { src: number; dst: number }[]
    const bonus = new Map<number, Map<number, number>>() // 鄰居 → 種子 → 加分（同一對只算一次）
    for (const e of edges) {
      for (const [seed, other] of [
        [e.src, e.dst],
        [e.dst, e.src]
      ]) {
        const s = seedScore.get(seed)
        if (s === undefined || !allowed(other)) continue
        const m = bonus.get(other) ?? new Map<number, number>()
        m.set(seed, s * NEIGHBOR_FACTOR)
        bonus.set(other, m)
      }
    }
    for (const [id, m] of bonus) {
      const c = candidate(id)
      c.via.add('graph')
      for (const b of m.values()) c.score += b
    }
  }

  const hits = [...candidates.values()]
    .map((c) => ({ c, n: notes.get(c.noteId)! }))
    .sort((a, b) => b.c.score - a.c.score || (a.n.path < b.n.path ? -1 : 1))
    .slice(0, limit)
    .map(({ c, n }): RetrieveHit => {
      const { line, snippet } = describe(db, c, terms)
      return {
        path: n.path,
        title: n.title,
        score: Math.round(c.score * 1e5) / 1e5,
        line,
        snippet,
        via: (['fulltext', 'vector', 'graph'] as const).filter((v) => c.via.has(v))
      }
    })
  return { hits, vector: queryVector !== null }
}

/** 每個詞各自搜尋，依命中的詞數排序，同數時依各詞名次的 RRF 分數 */
function searchAny(db: DB, terms: readonly string[], limit: number): SearchHit[] {
  const found = new Map<string, { hit: SearchHit; count: number; score: number }>()
  for (const term of terms) {
    searchNotes(db, term, limit).forEach((hit, i) => {
      const f = found.get(hit.path) ?? { hit, count: 0, score: 0 }
      f.count++
      f.score += 1 / (RRF_K + i + 1)
      found.set(hit.path, f)
    })
  }
  return [...found.values()]
    .sort((a, b) => b.count - a.count || b.score - a.score)
    .slice(0, limit)
    .map((f) => f.hit)
}

/** 結果顯示的段落：向量命中的 chunk、全文摘要，或筆記的第一塊 */
function describe(
  db: DB,
  c: Candidate,
  terms: readonly string[]
): { line: number; snippet: RetrieveHit['snippet'] } {
  if (c.text !== null) return { line: c.line, snippet: highlight(c.text, terms) }
  if (c.snippet) return { line: c.line || 1, snippet: c.snippet }
  const first = db
    .prepare('SELECT line, text FROM chunks WHERE note_id = ? ORDER BY seq LIMIT 1')
    .get(c.noteId) as { line: number; text: string } | undefined
  return first
    ? { line: first.line, snippet: highlight(first.text, terms) }
    : { line: 1, snippet: [] }
}

function highlight(text: string, terms: readonly string[]): RetrieveHit['snippet'] {
  const t = text.trim()
  const ranges: Range[] = terms.flatMap((term) => findAll(t, term))
  const c = clip(t, ranges, SNIPPET_MAX)
  return toSegments(c.text, c.ranges)
}

/** 第一個包含任一查詢詞的行（1-based）；只有標題命中時為 1 */
export function firstMatchLine(body: string, terms: readonly string[]): number {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (terms.some((t) => findAll(lines[i], t).length > 0)) return i + 1
  }
  return 1
}
