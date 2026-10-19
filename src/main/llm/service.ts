// LLM 服務：Ollama 連線狀態、背景 embedding、混合檢索、總結、問答。
// Ollama 是可選的：連不上時狀態為離線、每隔一段時間重試，其餘功能照常。
import crypto from 'node:crypto'
import { cleanLlmSettings, sameModel } from '../../shared/llm'
import type {
  AgentChunk,
  AgentDecision,
  AgentRequest,
  AnswerChunk,
  AskRequest,
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
import { agentMessages, runAgent, type ToolChat } from './agent/loop'
import { applyProposal, runTool, TOOL_DEFINITIONS, type ToolContext } from './agent/tools'
import { createOllama, isNoToolsError, OllamaError, type OllamaClient } from './ollama'
import {
  answer,
  askMessages,
  ASK_SOURCES,
  toAskSource,
  detectLanguage,
  gatherSources,
  noSourcesMessage,
  notesInRange,
  planQuery
} from './ask'
import { retrieve } from './retrieve'
import { summarize, type Chat } from './summarize'

export const RETRY_MS = 30_000
/**
 * 所有對話（總結、問答、agent）共用的 context 長度（tokens）。
 * Ollama 的預設是 4096，問答的來源與 agent 的工具結果會被截掉開頭；
 * 而且 num_ctx 不同時 Ollama 會重新載入模型（約 10 秒）、清掉 prompt 快取，所以統一用同一個值。
 */
export const CHAT_NUM_CTX = 8_192

export interface LlmServiceOptions {
  /** 讀取已存的設定（未設定的欄位用預設值） */
  loadSettings: () => unknown
  saveSettings: (s: LlmSettings) => void
  onStatus: (s: LlmStatus) => void
  onSummary: (c: SummaryChunk) => void
  onAnswer: (c: AnswerChunk) => void
  onAgent: (c: AgentChunk) => void
  /** 測試時注入假的 Ollama */
  createClient?: (baseUrl: string) => OllamaClient
  retryMs?: number
  /** 解析「上個月」等時間片語用的現在時間（測試用） */
  now?: () => number
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
  private readonly requests = new Map<string, AbortController>()
  /** 等待使用者確認的寫入提案：`${request id}:${step}` → 回覆 */
  private readonly confirmations = new Map<string, (d: AgentDecision) => void>()
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
    return retrieve(vault.db, query, await this.queryVector(vault, query), opts)
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
    this.requests.set(id, ac)
    const send = (c: Omit<SummaryChunk, 'id'>): void => {
      if (!this.disposed) this.opts.onSummary({ id, ...c })
    }
    const model = this.settings.chatModel
    const chat: Chat = (messages, onDelta) =>
      this.client.chat(model, messages, {
        signal: ac.signal,
        onDelta,
        temperature: 0.3,
        numCtx: CHAT_NUM_CTX
      })
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
        .finally(() => this.requests.delete(id))
    })
    return id
  }

  /** 開始串流回答，回傳 request id；來源與回答經 onAnswer 推送 */
  ask(req: AskRequest): string {
    const vault = this.requireVault()
    const question = String(req.question ?? '').trim()
    if (!question) throw new Error('The question is empty.')
    const history = Array.isArray(req.history) ? req.history : []

    const id = crypto.randomUUID()
    const ac = new AbortController()
    this.requests.set(id, ac)
    const send = (c: Omit<AnswerChunk, 'id'>): void => {
      if (!this.disposed) this.opts.onAnswer({ id, ...c })
    }
    const model = this.settings.chatModel
    const chat: Chat = (messages, onDelta) =>
      this.client.chat(model, messages, {
        signal: ac.signal,
        onDelta,
        temperature: 0.2,
        numCtx: CHAT_NUM_CTX
      })

    const run = async (): Promise<number[]> => {
      const plan = planQuery(question, history, req.range, (this.opts.now ?? Date.now)())
      const opts = { limit: ASK_SOURCES, ...(plan.range ?? {}) }
      let hits: RetrieveResult['hits'] = []
      let vector = false
      // 只有時間、沒有可檢索的內容（「上個月寫了什麼？」）：直接列出範圍內的筆記
      if (plan.keywords.length > 0 || !plan.range) {
        const qv = await this.queryVector(vault, plan.vectorText)
        if (ac.signal.aborted) return []
        const r = retrieve(vault.db, plan.vectorText, qv, opts, plan.keywords)
        hits = r.hits
        vector = r.vector
      }
      if (hits.length === 0 && plan.range) hits = notesInRange(vault.db, plan.range)
      const sources = gatherSources(vault.db, hits)
      send({
        delta: '',
        done: false,
        sources: sources.map(toAskSource),
        range: plan.range,
        vector
      })
      const language = detectLanguage(question)
      if (sources.length === 0) {
        send({ delta: noSourcesMessage(language, plan.range), done: false })
        return []
      }
      const messages = askMessages(question, sources, history, plan.range, language)
      const result = await answer(chat, messages, sources, (delta) => send({ delta, done: false }))
      return result.cited
    }

    // 先回傳 id，讓 renderer 能對上之後推送的片段
    setImmediate(() => {
      run()
        .then((cited) => send({ delta: '', done: true, cited }))
        .catch((e) => {
          if (ac.signal.aborted) send({ delta: '', done: true })
          else send({ delta: '', done: true, error: errorMessage(e) })
          if (e instanceof OllamaError && e.kind === 'offline') void this.check()
        })
        .finally(() => this.requests.delete(id))
    })
    return id
  }

  /** 開始執行 agent 任務，回傳 request id；步驟與文字經 onAgent 推送 */
  agent(req: AgentRequest): string {
    const vault = this.requireVault()
    const task = String(req.task ?? '').trim()
    if (!task) throw new Error('The task is empty.')
    const history = Array.isArray(req.history) ? req.history : []

    const id = crypto.randomUUID()
    const ac = new AbortController()
    this.requests.set(id, ac)
    const send = (c: Omit<AgentChunk, 'id'>): void => {
      if (!this.disposed) this.opts.onAgent({ id, ...c })
    }
    const model = this.settings.chatModel
    const now = (this.opts.now ?? Date.now)()
    const ctx: ToolContext = { vault, now, queryVector: (text) => this.queryVector(vault, text) }
    const chat: ToolChat = (messages, tools, onDelta) =>
      this.client.chatTools(model, messages, tools ?? [], {
        signal: ac.signal,
        onDelta,
        temperature: 0.2,
        numCtx: CHAT_NUM_CTX
      })
    const confirm = (step: { index: number }): Promise<AgentDecision> =>
      new Promise((resolve) => {
        const key = `${id}:${step.index}`
        const done = (d: AgentDecision): void => {
          this.confirmations.delete(key)
          ac.signal.removeEventListener('abort', onAbort)
          resolve(d)
        }
        // 停止、換 vault、關閉 App：視為拒絕，什麼都不寫
        const onAbort = (): void => done({ approved: false })
        if (ac.signal.aborted) return onAbort()
        ac.signal.addEventListener('abort', onAbort)
        this.confirmations.set(key, done)
      })

    const language = detectLanguage(task)
    const run = (): Promise<void> =>
      runAgent(
        {
          chat,
          tools: {
            definitions: TOOL_DEFINITIONS,
            run: (name, args) => runTool(ctx, name, args),
            apply: (proposal, edited) => applyProposal(ctx, proposal, edited)
          },
          emit: (c) => send({ ...c, done: false }),
          confirm,
          signal: ac.signal
        },
        agentMessages(task, history, language, now),
        language
      )

    // 先回傳 id，讓 renderer 能對上之後推送的片段
    setImmediate(() => {
      run()
        .then(() => send({ delta: '', done: true }))
        .catch((e) => {
          if (ac.signal.aborted) send({ delta: '', done: true })
          else if (isNoToolsError(e)) {
            send({
              delta: '',
              done: true,
              error: `The chat model ${model} does not support tool calling. Choose a model with tool support (for example qwen3:8b) in Settings.`
            })
          } else send({ delta: '', done: true, error: errorMessage(e) })
          if (e instanceof OllamaError && e.kind === 'offline') void this.check()
        })
        .finally(() => this.requests.delete(id))
    })
    return id
  }

  /** 回覆 agent 的寫入提案；已經沒有在等待（停止、重複回覆）時忽略 */
  confirm(id: string, step: number, decision: AgentDecision): void {
    this.confirmations.get(`${id}:${step}`)?.(decision)
  }

  cancel(id: string): void {
    this.requests.get(id)?.abort()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const ac of this.requests.values()) ac.abort()
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

  /** 查詢向量；離線、向量尚未建好或模型不同時為 null（檢索退回全文） */
  private async queryVector(vault: Vault, text: string): Promise<number[] | null> {
    const vm = vectorModel(vault.db)
    if (!this.online || !vm || !sameModel(vm.model, this.settings.embedModel) || !text.trim()) {
      return null
    }
    try {
      const [v] = await this.client.embed(this.settings.embedModel, [text.trim()])
      return v
    } catch (e) {
      // 離線時順便更新狀態
      if (e instanceof OllamaError && e.kind === 'offline') void this.check()
      return null
    }
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
