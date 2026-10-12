// 背景 embedding：依序處理還沒有向量的 chunk，每批呼叫一次 Ollama。
//
// 不經過 Vault 的佇列：better-sqlite3 是同步的，寫入不會與其他操作交錯；
// embedding 途中筆記被修改或刪除時，舊 chunk 已不存在（id 不重複使用），storeEmbeddings 會略過。
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
  /** 這些筆記的整篇向量已更新（semantic 邊要重算） */
  onNotesEmbedded?: (noteIds: number[]) => void
  /** busy、error 或進度改變 */
  onChange?: () => void
}

export class Embedder {
  busy = false
  /** 上一輪停下來的原因（離線、模型未下載…）；下一次 wake 成功後清除 */
  error: unknown = null
  private stopped = false
  private readonly abort = new AbortController()
  private running: Promise<void> | null = null

  constructor(private readonly opts: EmbedderOptions) {
    // 換了 embedding 模型：舊向量作廢
    const current = vectorModel(opts.db)
    if (current && current.model !== opts.model) resetVectors(opts.db)
  }

  /** 有新的 chunk 或連線恢復時呼叫；已在執行時不重複啟動（迴圈每批都會重新查詢） */
  wake(): void {
    if (this.stopped || this.running) return
    this.running = this.run().finally(() => {
      this.running = null
    })
  }

  /** 等待目前這一輪結束（測試用） */
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
