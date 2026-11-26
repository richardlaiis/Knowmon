// Fuzzy matching (shared by the Quick switcher and [[ autocompletion; pure functions)
import type { NoteSummary } from '../../../shared/types'

const BOUNDARY = /[\s/\\\-_.()[\]]/

/**
 * A match when the query's characters appear in order in text (case-insensitive, ignoring spaces in the query); higher scores are better, and null means no match.
 * Consecutive matches > matches at word starts/after separators > scattered matches; shorter text is better.
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
 * Sorts notes by query: titles take precedence over paths; with an empty query, recently opened notes come first, then by modification time.
 * recent holds recently opened paths, most recent first.
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
