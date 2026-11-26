// Semantic edges: notes whose note vectors (vec_notes) are highly similar are linked. Like time edges, not incremental: recomputed in one batch before the graph is read.
//
// Comparing all pairs at 1000 notes and 1024 dimensions takes about 0.5 seconds (per-note vec0 KNN takes about 1.5 seconds), so it's computed in JS,
// yielding the event loop every few rows so the main process's IPC isn't blocked.
import type { SemanticSettings } from '../../shared/types'
import type { DB } from '.'
import { listNoteVectors } from './vectors'

export interface SemanticPair {
  /** Indexes into vectors, i < j */
  i: number
  j: number
  similarity: number
}

/** Yield the event loop after this many dot products (about 10ms) */
const YIELD_EVERY = 20_000_000

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * The union of each note's maxPerNote most similar notes (≥ threshold), linked pairwise.
 * vectors must be normalized (dot product = cosine similarity).
 */
export async function semanticPairs(
  vectors: readonly Float32Array[],
  settings: SemanticSettings,
  pause: () => Promise<void> = nextTick
): Promise<SemanticPair[]> {
  const n = vectors.length
  const k = settings.semanticMaxPerNote
  // Each note's current top k (similarity descending)
  const top: { other: number; sim: number }[][] = Array.from({ length: n }, () => [])
  const offer = (row: number, other: number, sim: number): void => {
    const list = top[row]
    if (list.length === k && sim <= list[k - 1].sim) return
    let at = list.length
    while (at > 0 && list[at - 1].sim < sim) at--
    list.splice(at, 0, { other, sim })
    if (list.length > k) list.pop()
  }

  let work = 0
  for (let i = 0; i < n; i++) {
    const a = vectors[i]
    for (let j = i + 1; j < n; j++) {
      const sim = dot(a, vectors[j])
      if (sim < settings.semanticThreshold) continue
      offer(i, j, sim)
      offer(j, i, sim)
    }
    work += (n - i) * a.length
    if (work >= YIELD_EVERY) {
      work = 0
      await pause()
    }
  }

  const pairs = new Map<string, SemanticPair>()
  top.forEach((list, row) => {
    for (const { other, sim } of list) {
      const [i, j] = row < other ? [row, other] : [other, row]
      pairs.set(`${i}-${j}`, { i, j, similarity: sim })
    }
  })
  return [...pairs.values()].sort((x, y) => x.i - y.i || x.j - y.j)
}

/** Recomputes all semantic edges from the current note vectors. Undirected: the path that sorts first is src, weighted by similarity. */
export async function rebuildSemanticLinks(
  db: DB,
  settings: SemanticSettings,
  pause?: () => Promise<void>
): Promise<void> {
  const notes = listNoteVectors(db)
  const pairs = await semanticPairs(
    notes.map((n) => n.vector),
    settings,
    pause
  )
  // Notes may be deleted or renamed mid-computation, so writes go by the DB at that moment
  const paths = new Map(
    (db.prepare('SELECT id, path FROM notes').all() as { id: number; path: string }[]).map((r) => [
      r.id,
      r.path
    ])
  )
  const insert = db.prepare(
    "INSERT INTO links (src, dst, type, weight) VALUES (?, ?, 'semantic', ?)"
  )
  db.transaction(() => {
    db.prepare("DELETE FROM links WHERE type = 'semantic'").run()
    for (const p of pairs) {
      const a = notes[p.i].noteId
      const b = notes[p.j].noteId
      const pa = paths.get(a)
      const pb = paths.get(b)
      if (pa === undefined || pb === undefined) continue
      const [src, dst] = pa < pb ? [a, b] : [b, a]
      insert.run(src, dst, Math.round(p.similarity * 1000) / 1000)
    }
  })()
}

function dot(a: Float32Array, b: Float32Array): number {
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  const n = a.length - (a.length % 4)
  let d = 0
  for (; d < n; d += 4) {
    s0 += a[d] * b[d]
    s1 += a[d + 1] * b[d + 1]
    s2 += a[d + 2] * b[d + 2]
    s3 += a[d + 3] * b[d + 3]
  }
  for (; d < a.length; d++) s0 += a[d] * b[d]
  return s0 + s1 + s2 + s3
}
