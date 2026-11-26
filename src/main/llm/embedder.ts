// Background embedding: processes chunks without vectors in order, calling Ollama once per batch.
//
// It doesn't go through the Vault queue: better-sqlite3 is synchronous, so writes can't interleave with other operations;
// if a note is modified or deleted mid-embedding, its old chunks no longer exist (ids are never reused), and storeEmbeddings skips them.
import type { DB } from '../db'
import {
  ensureVectorTables,
  pendingChunks,
  resetVectors,
  storeEmbeddings,
  vectorModel
} from '../db/vectors'
import { embeddingText } from '../indexer/chunk'

export const EMBED_BATCH = 16

export interface EmbedderOptions {
  db: DB
  model: string
  embed: (texts: string[], signal: AbortSignal) => Promise<number[][]>
  batchSize?: number
  /** These notes' vectors were updated (semantic edges need recomputing) */
  onNotesEmbedded?: (noteIds: number[]) => void
  /** busy, error or progress changed */
  onChange?: () => void
}

export class Embedder {
  busy = false
  /** Why the last round stopped (offline, model not downloaded…); cleared after the next successful wake */
  error: unknown = null
  private stopped = false
  private readonly abort = new AbortController()
  private running: Promise<void> | null = null

  constructor(private readonly opts: EmbedderOptions) {
    // The embedding model changed: old vectors are invalid
    const current = vectorModel(opts.db)
    if (current && current.model !== opts.model) resetVectors(opts.db)
  }

  /** Called when there are new chunks or the connection is back; doesn't start again while running (the loop re-queries every batch) */
  wake(): void {
    if (this.stopped || this.running) return
    this.running = this.run().finally(() => {
      this.running = null
    })
  }

  /** Waits for the current round to finish (for tests) */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.abort.abort()
    await this.running
  }

  private async run(): Promise<void> {
    const { db, model, embed } = this.opts
    const size = this.opts.batchSize ?? EMBED_BATCH
    this.busy = true
    this.opts.onChange?.()
    try {
      for (;;) {
        if (this.stopped) return
        const batch = pendingChunks(db, size)
        if (batch.length === 0) break
        const vectors = await embed(
          batch.map((c) => embeddingText(c.title, c)),
          this.abort.signal
        )
        if (this.stopped) return
        ensureVectorTables(db, model, vectors[0].length)
        const done = storeEmbeddings(
          db,
          batch.map((c, i) => ({ id: c.id, vector: vectors[i] }))
        )
        if (done.length) this.opts.onNotesEmbedded?.(done)
        this.error = null
        this.opts.onChange?.()
      }
      this.error = null
    } catch (e) {
      if (!this.stopped) this.error = e
    } finally {
      this.busy = false
      if (!this.stopped) this.opts.onChange?.()
    }
  }
}
