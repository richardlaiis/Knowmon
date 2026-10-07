// 反向連結：哪些筆記連到這篇，以及連結所在的那一行
import { linkKey } from '../../shared/links'
import type { Backlink } from '../../shared/types'
import { extractWikilinks } from '../indexer'
import { getNoteBody, getNoteByPath, type DB } from '.'
import { clip, toSegments } from './segments'

const collator = new Intl.Collator('zh-Hant', { numeric: true })
const CONTEXT_MAX = 200

export function getBacklinks(db: DB, path: string): Backlink[] {
  const note = getNoteByPath(db, path)
  if (!note) return []
  const rows = db
    .prepare(
      `SELECT l.src AS src, l.target AS target, n.path AS path, n.title AS title
       FROM links l JOIN notes n ON n.id = l.src
       WHERE l.dst = ? AND l.type = 'wikilink' AND l.src != ?`
    )
    .all(note.id, note.id) as { src: number; target: string; path: string; title: string }[]

  const sources = new Map<number, { path: string; title: string; keys: Set<string> }>()
  for (const r of rows) {
    const s = sources.get(r.src) ?? { path: r.path, title: r.title, keys: new Set<string>() }
    s.keys.add(linkKey(r.target))
    sources.set(r.src, s)
  }

  const out: Backlink[] = []
  for (const [id, s] of sources) {
    const body = getNoteBody(db, id) ?? ''
    const lines = body.split('\n')
    const byLine = new Map<number, [number, number][]>()
    for (const ref of extractWikilinks(body)) {
      if (!s.keys.has(linkKey(ref.target))) continue
      const ranges = byLine.get(ref.line) ?? []
      ranges.push([ref.from, ref.to])
      byLine.set(ref.line, ranges)
    }
    for (const [line, ranges] of byLine) {
      const c = clip(lines[line - 1].replace(/\r$/, ''), ranges, CONTEXT_MAX)
      out.push({ path: s.path, title: s.title, line, context: toSegments(c.text, c.ranges) })
    }
  }
  return out.sort((a, b) => collator.compare(a.path, b.path) || a.line - b.line)
}
