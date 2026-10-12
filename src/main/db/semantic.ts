// semantic 邊：整篇向量（vec_notes）相似度高的筆記相連。和時間邊一樣不做增量，讀取圖譜前整批重算。
//
// 1000 篇、1024 維時兩兩比較約 0.5 秒（vec0 逐篇 KNN 約 1.5 秒），所以在 JS 裡算，
// 每算完幾列就讓出 event loop，main process 的 IPC 不會被卡住。
import type { SemanticSettings } from '../../shared/types'
import type { DB } from '.'
import { listNoteVectors } from './vectors'

export interface SemanticPair {
  /** vectors 的索引，i < j */
  i: number
  j: number
  similarity: number
}

/** 每算這麼多個內積就讓出一次 event loop（約 10ms） */
const YIELD_EVERY = 20_000_000

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * 每篇取相似度最高的 maxPerNote 篇（≥ threshold），兩兩相連的聯集。
 * vectors 必須已正規化（內積 = cosine 相似度）。
 */
export async function semanticPairs(
  vectors: readonly Float32Array[],
  settings: SemanticSettings,
  pause: () => Promise<void> = nextTick
): Promise<SemanticPair[]> {
  const n = vectors.length
  const k = settings.semanticMaxPerNote
  // 每篇目前的前 k 名（相似度由大到小）
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

/** 以目前的整篇向量重算所有 semantic 邊。無方向：路徑字典序較小者為 src，權重為相似度。 */
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
  // 計算途中筆記可能被刪除或改名：寫入時以當下的 DB 為準
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
