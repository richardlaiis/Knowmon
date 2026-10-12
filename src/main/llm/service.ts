// LLM 服務：Ollama 連線狀態、背景 embedding、混合檢索、總結。
// Ollama 是可選的：連不上時狀態為離線、每隔一段時間重試，其餘功能照常。
import crypto from 'node:crypto'
import { cleanLlmSettings, sameModel } from '../../shared/llm'
import type {
  LlmSettings,
  LlmStatus,
  RetrieveOptions,
  RetrieveResult,
  SummaryChunk,
  SummaryRequest
} from '../../shared/types'
import { getNoteBody, getNoteByPath } from '../db'
import { embedProgress, vecAvailable, vectorModel } from '../db/vectors'
import { normalizeRel } from '../vault/paths'
import type { Vault } from '../vault'
import { Embedder } from './embedder'
import { createOllama, OllamaError, type OllamaClient } from './ollama'
import { retrieve } from './retrieve'
import { summarize, type Chat } from './summarize'

export const RETRY_MS = 30_000

export interface LlmServiceOptions {
  /** 讀取已存的設定（未設定的欄位用預設值） */
  loadSettings: () => unknown
  saveSettings: (s: LlmSettings) => void
  onStatus: (s: LlmStatus) => void
  onSummary: (c: SummaryChunk) => void
  /** 測試時注入假的 Ollama */
  createClient?: (baseUrl: string) => OllamaClient
  retryMs?: number
}

export class LlmService {
  private settings: LlmSettings
  private client: OllamaClient
  private online = false
  private error: string | null = null
  private models: string[] = []
  private vault: Vault | null = null
  private embedder: Embedder | null = null
  private offChunks: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private checking: Promise<void> | null = null
  private readonly summaries = new Map<string, AbortController>()
  private disposed = false

  constructor(private readonly opts: LlmServiceOptions) {
    this.settings = cleanLlmSettings(opts.loadSettings())
    this.client = this.makeClient()
  }

  /** 換 vault（null = 關閉）。舊的 Embedder 會先停下來。 */
  async attach(vault: Vault | null): Promise<void> {
    await this.detach()
    this.vault = vault
    if (!vault) return this.emit()
    // 離線時不喚醒，等重試成功後再一起處理
    this.offChunks = vault.onChunksChanged(() => {
      if (this.online) this.embedder?.wake()
    })
    this.embedder = this.makeEmbedder(vault)
    await this.check()
  }

  status(): LlmStatus {
    const progress = this.vault ? embedProgress(this.vault.db) : { embedded: 0, total: 0 }
    const embedError = this.embedder?.error
    return {
      online: this.online,
      error:
        this.error ??
        (embedError ? errorMessage(embedError) : null) ??
        (this.vault && !vecAvailable(this.vault.db)
          ? 'Vector search is unavailable on this platform (sqlite-vec failed to load).'
          : null),
      models: [...this.models],
      settings: { ...this.settings },
      embedded: progress.embedded,
      total: progress.total,
      busy: this.embedder?.busy ?? false
    }
  }

  /** 重新檢查連線並恢復 embedding */
  async retry(): Promise<LlmStatus> {
    await this.check()
    return this.status()
  }

  async setSettings(change: Partial<LlmSettings>): Promise<LlmStatus> {
    const next = cleanLlmSettings(change, this.settings)
    const prev = this.settings
    this.settings = next
    this.opts.saveSettings(next)
    if (next.baseUrl !== prev.baseUrl) this.client = this.makeClient()
    if (next.embedModel !== prev.embedModel && this.vault) {
      // 換 embedding 模型：所有向量重算
      await this.embedder?.stop()
      this.embedder = this.makeEmbedder(this.vault)
      this.vault.markSemanticDirty()
    }
    await this.check()
    return this.status()
  }

  async retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
    const vault = this.requireVault()
    let queryVector: number[] | null = null
    const vm = vectorModel(vault.db)
    if (this.online && vm && sameModel(vm.model, this.settings.embedModel) && query.trim()) {
      try {
        ;[queryVector] = await this.client.embed(this.settings.embedModel, [query.trim()])
      } catch (e) {
        // 退回只用全文；離線時順便更新狀態
        if (e instanceof OllamaError && e.kind === 'offline') void this.check()
      }
    }
    return retrieve(vault.db, query, queryVector, opts)
  }

  /** 開始串流總結，回傳 request id；結果經 onSummary 推送 */
  summarize(req: SummaryRequest): string {
    const vault = this.requireVault()
    const path = normalizeRel(String(req.path ?? ''))
    const note = getNoteByPath(vault.db, path)
    if (!note) throw new Error(`Note not found: ${path}`)
    const selection = typeof req.selection === 'string' ? req.selection : ''
    const text = selection.trim() ? selection : (getNoteBody(vault.db, note.id) ?? '')

    const id = crypto.randomUUID()
    const ac = new AbortController()
    this.summaries.set(id, ac)
    const send = (c: Omit<SummaryChunk, 'id'>): void => {
      if (!this.disposed) this.opts.onSummary({ id, ...c })
    }
    const model = this.settings.chatModel
    const chat: Chat = (messages, onDelta) =>
      this.client.chat(model, messages, { signal: ac.signal, onDelta, temperature: 0.3 })
    // 先回傳 id，讓 renderer 能對上之後推送的片段
    setImmediate(() => {
      summarize(
        chat,
        selection.trim() ? 'selection' : 'note',
        note.title,
        text,
        (delta) => send({ delta, done: false }),
        req.language === 'en' ? 'en' : 'zh-TW'
      )
        .then(() => send({ delta: '', done: true }))
        .catch((e) => {
          if (ac.signal.aborted) send({ delta: '', done: true })
          else send({ delta: '', done: true, error: errorMessage(e) })
          if (e instanceof OllamaError && e.kind === 'offline') void this.check()
        })
        .finally(() => this.summaries.delete(id))
    })
    return id
  }

  cancel(id: string): void {
    this.summaries.get(id)?.abort()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const ac of this.summaries.values()) ac.abort()
    await this.detach()
  }

  // ---- 內部 ----

  private async detach(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.offChunks?.()
    this.offChunks = null
    await this.embedder?.stop()
    this.embedder = null
    this.vault = null
  }

  private requireVault(): Vault {
    if (!this.vault) throw new Error('No vault is open')
    return this.vault
  }

  private makeClient(): OllamaClient {
    return (this.opts.createClient ?? createOllama)(this.settings.baseUrl)
  }

  private makeEmbedder(vault: Vault): Embedder {
    const model = this.settings.embedModel
    const embedder: Embedder = new Embedder({
      db: vault.db,
      model,
      embed: (texts, signal) => this.client.embed(model, texts, signal),
      onNotesEmbedded: () => vault.markSemanticDirty(),
      onChange: () => {
        if (this.embedder !== embedder) return
        const e = embedder.error
        if (e instanceof OllamaError && (e.kind === 'offline' || e.kind === 'timeout')) {
          this.online = false
          this.scheduleRetry()
        }
        this.emit()
      }
    })
    return embedder
  }

  /** 檢查 Ollama 是否可用、模型是否已下載；可用時恢復 embedding，否則稍後重試 */
  private check(): Promise<void> {
    this.checking ??= this.checkNow().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async checkNow(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      await this.client.version()
      this.models = await this.client.models()
      this.online = true
      const missing = [this.settings.embedModel, this.settings.chatModel].filter(
        (m) => !this.models.some((x) => sameModel(x, m))
      )
      this.error = missing.length
        ? `Not installed: ${missing.join(', ')}. Run: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}`
        : null
      if (this.embedder && !missing.includes(this.settings.embedModel)) {
        this.embedder.error = null
        this.embedder.wake()
      }
    } catch (e) {
      this.online = false
      this.models = []
      this.error = errorMessage(e)
      this.scheduleRetry()
    }
    this.emit()
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed || !this.vault) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.check()
    }, this.opts.retryMs ?? RETRY_MS)
  }

  private emit(): void {
    if (!this.disposed) this.opts.onStatus(this.status())
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
