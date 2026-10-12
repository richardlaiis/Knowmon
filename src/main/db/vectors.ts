// chunk 與向量（sqlite-vec）。都只是索引：可從筆記重新切塊、重新 embedding。
//
// - chunks：筆記重新解析時整篇重寫（embedded = 0），由背景的 Embedder 補上向量。
// - vec_chunks（rowid = chunks.id）：每塊的向量。
// - vec_notes（rowid = notes.id）：整篇的向量 = 各塊向量正規化後的平均，semantic 邊用。
// 兩張向量表在第一次拿到 embedding 時才建立（維度取決於模型）；換模型時丟掉重算。
import type { Chunk } from '../indexer/chunk'
import type { DB } from '.'

export const MAX_KNN = 4096

export interface PendingChunk {
  id: number
  noteId: number
  title: string
  heading: string
  text: string
}

export interface ChunkHit {
  chunkId: number
  noteId: number
  line: number
  text: string
  distance: number
}

export interface VectorModel {
  model: string
  dim: number
}

/** sqlite-vec 是否已載入 */
export function vecAvailable(db: DB): boolean {
  try {
    db.prepare('SELECT vec_version()').get()
    return true
  } catch {
    return false
  }
}

function tableExists(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    { value: string } | undefined
  return row ? row.value : null
}

export function setMeta(db: DB, key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  else db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}

/** 目前向量表所用的模型與維度；尚未建立時為 null */
export function vectorModel(db: DB): VectorModel | null {
  const model = getMeta(db, 'embed_model')
  const dim = Number(getMeta(db, 'embed_dim'))
  if (!model || !dim || !tableExists(db, 'vec_chunks')) return null
  return { model, dim }
}

/** 丟掉所有向量，所有 chunk 標回未 embedding */
export function resetVectors(db: DB): void {
  db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS chunks_vec_delete;
      DROP TRIGGER IF EXISTS notes_vec_delete;
      DROP TABLE IF EXISTS vec_chunks;
      DROP TABLE IF EXISTS vec_notes;
      UPDATE chunks SET embedded = 0 WHERE embedded != 0;
    `)
    setMeta(db, 'embed_model', null)
    setMeta(db, 'embed_dim', null)
  })()
}

/** 確保向量表以這個模型與維度建立；模型或維度不同時先丟掉舊的。回傳是否重建了。 */
export function ensureVectorTables(db: DB, model: string, dim: number): boolean {
  const current = vectorModel(db)
  if (current && current.model === model && current.dim === dim) return false
  if (!Number.isInteger(dim) || dim <= 0) throw new Error(`Invalid embedding size: ${dim}`)
  resetVectors(db)
  db.transaction(() => {
    db.exec(`
      CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${dim}] distance_metric=cosine);
      CREATE VIRTUAL TABLE vec_notes USING vec0(embedding float[${dim}] distance_metric=cosine);
      CREATE TRIGGER chunks_vec_delete AFTER DELETE ON chunks BEGIN
        DELETE FROM vec_chunks WHERE rowid = old.id;
      END;
      CREATE TRIGGER notes_vec_delete AFTER DELETE ON notes BEGIN
        DELETE FROM vec_notes WHERE rowid = old.id;
      END;
    `)
    setMeta(db, 'embed_model', model)
    setMeta(db, 'embed_dim', String(dim))
  })()
  return true
}

/**
 * 以新的切塊取代某篇筆記原有的全部 chunk（舊的向量由 trigger 刪除，整篇向量也作廢）。
 * 與原本完全相同時（例如只是改名）保留原有的向量，回傳 false。
 */
export function setChunks(db: DB, noteId: number, chunks: readonly Chunk[]): boolean {
  const old = listChunks(db, noteId)
  const same =
    old.length === chunks.length &&
    old.every(
      (o, i) =>
        o.text === chunks[i].text && o.line === chunks[i].line && o.heading === chunks[i].heading
    )
  if (same) return false
  db.prepare('DELETE FROM chunks WHERE note_id = ?').run(noteId)
  if (tableExists(db, 'vec_notes')) {
    db.prepare('DELETE FROM vec_notes WHERE rowid = ?').run(BigInt(noteId))
  }
  const insert = db.prepare(
    'INSERT INTO chunks (note_id, seq, line, heading, text) VALUES (?, ?, ?, ?, ?)'
  )
  chunks.forEach((c, i) => insert.run(noteId, i, c.line, c.heading, c.text))
  return true
}

export function listChunks(
  db: DB,
  noteId: number
): { id: number; line: number; heading: string; text: string; embedded: boolean }[] {
  return (
    db
      .prepare(
        'SELECT id, line, heading, text, embedded FROM chunks WHERE note_id = ? ORDER BY seq'
      )
      .all(noteId) as {
      id: number
      line: number
      heading: string
      text: string
      embedded: number
    }[]
  ).map((r) => ({ ...r, embedded: r.embedded === 1 }))
}

/** 還沒有向量的 chunk，依筆記與順序 */
export function pendingChunks(db: DB, limit: number): PendingChunk[] {
  return db
    .prepare(
      `SELECT c.id AS id, c.note_id AS noteId, n.title AS title, c.heading AS heading, c.text AS text
       FROM chunks c JOIN notes n ON n.id = c.note_id
       WHERE c.embedded = 0
       ORDER BY c.note_id, c.seq
       LIMIT ?`
    )
    .all(limit) as PendingChunk[]
}

/**
 * 寫入 chunk 向量。已不存在（筆記在 embedding 途中被修改或刪除）或已有向量的 chunk 略過。
 * 筆記的全部 chunk 都有向量時更新整篇向量。回傳整篇向量有更新的筆記 id。
 */
export function storeEmbeddings(
  db: DB,
  items: readonly { id: number; vector: ArrayLike<number> }[]
): number[] {
  const find = db.prepare('SELECT note_id AS noteId FROM chunks WHERE id = ? AND embedded = 0')
  const insert = db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)')
  const mark = db.prepare('UPDATE chunks SET embedded = 1 WHERE id = ?')
  const pending = db.prepare('SELECT 1 FROM chunks WHERE note_id = ? AND embedded = 0 LIMIT 1')
  return db.transaction(() => {
    const touched = new Set<number>()
    for (const { id, vector } of items) {
      const row = find.get(id) as { noteId: number } | undefined
      if (!row) continue
      insert.run(BigInt(id), toBlob(vector))
      mark.run(id)
      touched.add(row.noteId)
    }
    const done: number[] = []
    for (const noteId of touched) {
      if (pending.get(noteId)) continue
      updateNoteVector(db, noteId)
      done.push(noteId)
    }
    return done
  })()
}

/** 整篇向量 = 各塊向量正規化後的平均（再正規化） */
function updateNoteVector(db: DB, noteId: number): void {
  const rows = db
    .prepare(
      `SELECT v.embedding AS embedding FROM chunks c JOIN vec_chunks v ON v.rowid = c.id
       WHERE c.note_id = ?`
    )
    .all(noteId) as { embedding: Buffer }[]
  db.prepare('DELETE FROM vec_notes WHERE rowid = ?').run(BigInt(noteId))
  if (rows.length === 0) return
  let sum: Float32Array | null = null
  for (const r of rows) {
    const v = normalize(fromBlob(r.embedding))
    if (!sum) sum = v
    else for (let i = 0; i < v.length; i++) sum[i] += v[i]
  }
  db.prepare('INSERT INTO vec_notes (rowid, embedding) VALUES (?, ?)').run(
    BigInt(noteId),
    toBlob(normalize(sum!))
  )
}

/** embedding 進度：有內容的筆記數，與其中全部 chunk 都有向量的筆記數 */
export function embedProgress(db: DB): { embedded: number; total: number } {
  const total = (
    db.prepare('SELECT COUNT(DISTINCT note_id) AS n FROM chunks').get() as { n: number }
  ).n
  const pending = (
    db.prepare('SELECT COUNT(DISTINCT note_id) AS n FROM chunks WHERE embedded = 0').get() as {
      n: number
    }
  ).n
  return { embedded: total - pending, total }
}

/** 與 vector 最接近的 k 個 chunk（cosine distance 由小到大） */
export function nearestChunks(db: DB, vector: ArrayLike<number>, k: number): ChunkHit[] {
  if (!vectorModel(db)) return []
  return db
    .prepare(
      `SELECT v.rowid AS chunkId, c.note_id AS noteId, c.line AS line, c.text AS text,
              v.distance AS distance
       FROM (SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ?) v
       JOIN chunks c ON c.id = v.rowid
       ORDER BY v.distance`
    )
    .all(toBlob(vector), Math.min(MAX_KNN, Math.max(1, k))) as ChunkHit[]
}

/** 有整篇向量的筆記 */
export function listNoteVectors(db: DB): { noteId: number; vector: Float32Array }[] {
  if (!vectorModel(db)) return []
  return (
    db.prepare('SELECT rowid AS noteId, embedding FROM vec_notes').all() as {
      noteId: number
      embedding: Buffer
    }[]
  ).map((r) => ({ noteId: r.noteId, vector: fromBlob(r.embedding) }))
}

/** 與 vector 最接近的 k 篇筆記 */
export function nearestNotes(
  db: DB,
  vector: ArrayLike<number>,
  k: number
): { noteId: number; distance: number }[] {
  if (!vectorModel(db)) return []
  return db
    .prepare(
      `SELECT rowid AS noteId, distance FROM vec_notes
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`
    )
    .all(toBlob(vector), Math.min(MAX_KNN, Math.max(1, k))) as {
    noteId: number
    distance: number
  }[]
}

function toBlob(v: ArrayLike<number>): Buffer {
  const f = v instanceof Float32Array ? v : Float32Array.from(v)
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength)
}

function fromBlob(b: Buffer): Float32Array {
  // 複製一份：Buffer 的 byteOffset 不一定是 4 的倍數
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  const out = new Float32Array(v.length)
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}
