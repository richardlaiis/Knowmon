// LLM 服務：Ollama 連線狀態、背景 embedding、混合檢索、總結、問答。
// Ollama 是可選的：連不上時狀態為離線、每隔一段時間重試，其餘功能照常。
// 對話（總結、問答、Agent）可以改用雲端服務（OpenAI 相容 API）；embedding 一律走 Ollama。
import crypto from 'node:crypto'
import {
  activeChatModel,
  cleanLlmSettings,
  cloudBaseUrl,
  isCloudProvider,
  PROVIDER_LABELS,
  sameModel
} from '../../shared/llm'
import type {
  AgentChunk,
  AgentDecision,
  AgentRequest,
  AnswerChunk,
  AskRequest,
  CloudProvider,
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
import {
  createOllama,
  isNoToolsError,
  LlmError,
  OllamaError,
  type ChatClient,
  type ChatOptions,
  type OllamaClient
} from './ollama'
import { createOpenAiCompatible } from './openai'
import { API_KEY_MAX, memoryKeyStore, type KeyStore } from './secrets'
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
  /** 雲端服務的 client；測試時注入假的 */
  createCloudClient?: (o: {
    provider: CloudProvider
    baseUrl: string
    apiKey: string
  }) => ChatClient
  /** API key 的儲存；不給時只存在記憶體 */
  keys?: KeyStore
  retryMs?: number
  /** 解析「上個月」等時間片語用的現在時間（測試用） */
  now?: () => number
}

export class LlmService {
  private settings: LlmSettings
  private client: OllamaClient
  /** Ollama 在線（embedding；provider = ollama 時也是對話） */
  private ollamaOnline = false
  /** Ollama 的問題（離線、模型未下載） */
  private error: string | null = null
  private models: string[] = []
  private readonly keys: KeyStore
  /** 雲端對話的 client；設定或 key 改變時清掉，下次用到時重建 */
  private cloud: ChatClient | null = null
  private cloudOnline = false
  private cloudError: string | null = null
  private cloudModels: string[] = []
  private cloudRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** 每次檢查雲端服務都遞增；設定在檢查途中改變時，舊的結果不採用 */
  private cloudCheck = 0
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
    this.keys = opts.keys ?? memoryKeyStore()
  }

  /** 換 vault（null = 關閉）。舊的 Embedder 會先停下來。 */
  async attach(vault: Vault | null): Promise<void> {
    await this.detach()
    this.vault = vault
    if (!vault) return this.emit()
    // 離線時不喚醒，等重試成功後再一起處理
    this.offChunks = vault.onChunksChanged(() => {
      if (this.ollamaOnline) this.embedder?.wake()
    })
    this.embedder = this.makeEmbedder(vault)
    await this.check()
  }

  status(): LlmStatus {
    const progress = this.vault ? embedProgress(this.vault.db) : { embedded: 0, total: 0 }
    const embedError = this.embedder?.error
    const ollamaProblem =
      this.error ??
      (embedError ? errorMessage(embedError) : null) ??
      (this.vault && !vecAvailable(this.vault.db)
        ? 'Vector search is unavailable on this platform (sqlite-vec failed to load).'
        : null)
    const cloud = this.settings.provider !== 'ollama'
    return {
      online: cloud ? this.cloudOnline : this.ollamaOnline,
      ollamaOnline: this.ollamaOnline,
      // 雲端模式下 Ollama 只負責 embedding，它的問題不擋對話
      error: cloud ? this.cloudError : ollamaProblem,
      embedError: !cloud
        ? null
        : !this.ollamaOnline
          ? 'Ollama is offline, so semantic search and Semantic links are unavailable.'
          : ollamaProblem,
      models: [...this.models],
      cloudModels: cloud ? [...this.cloudModels] : [],
      apiKeys: {
        openai: !!this.keys.get('openai'),
        gemini: !!this.keys.get('gemini'),
        custom: !!this.keys.get('custom')
      },
      keyEncrypted: this.keys.encrypted(),
      settings: { ...this.settings, cloudModels: { ...this.settings.cloudModels } },
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
    if (
      next.provider !== prev.provider ||
      next.customBaseUrl !== prev.customBaseUrl ||
      activeChatModel(next) !== activeChatModel(prev)
    ) {
      this.cloud = null
    }
    if (next.embedModel !== prev.embedModel && this.vault) {
      // 換 embedding 模型：所有向量重算
      await this.embedder?.stop()
      this.embedder = this.makeEmbedder(this.vault)
      this.vault.markSemanticDirty()
    }
    await this.check()
    return this.status()
  }

  /** 儲存雲端服務的 API key（null 或空字串 = 刪除），重新檢查目前的服務 */
  async setApiKey(provider: CloudProvider, key: string | null): Promise<LlmStatus> {
    if (!isCloudProvider(provider)) throw new Error('Unknown provider.')
    const k = typeof key === 'string' ? key.trim() : ''
    if (k.length > API_KEY_MAX) throw new Error('The API key is too long.')
    // 會放進 HTTP header：只允許可見的 ASCII 字元
    if (k && !/^[\x21-\x7e]+$/.test(k)) throw new Error('The API key contains invalid characters.')
    this.keys.set(provider, k || null)
    if (provider === this.settings.provider) {
      this.cloud = null
      await this.checkCloud()
    } else this.emit()
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
    const { client, model } = this.chatTarget()
    const chat: Chat = (messages, onDelta) =>
      client.chat(model, messages, this.chatOptions(ac.signal, onDelta, 0.3))
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
          this.onChatError(e)
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
    const { client, model } = this.chatTarget()
    const chat: Chat = (messages, onDelta) =>
      client.chat(model, messages, this.chatOptions(ac.signal, onDelta, 0.2))

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
          this.onChatError(e)
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
    const { client, model } = this.chatTarget()
    const now = (this.opts.now ?? Date.now)()
    const ctx: ToolContext = { vault, now, queryVector: (text) => this.queryVector(vault, text) }
    const chat: ToolChat = (messages, tools, onDelta) =>
      client.chatTools(model, messages, tools ?? [], this.chatOptions(ac.signal, onDelta, 0.2))
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
          else if (isNoToolsError(e) || isCloudNoToolsError(e)) {
            const example = this.settings.provider === 'ollama' ? ' (for example qwen3:8b)' : ''
            send({
              delta: '',
              done: true,
              error: `The chat model ${model} does not support tool calling. Choose a model with tool support${example} in Settings.`
            })
          } else send({ delta: '', done: true, error: errorMessage(e) })
          this.onChatError(e)
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
    if (this.cloudRetryTimer) clearTimeout(this.cloudRetryTimer)
    this.cloudRetryTimer = null
    for (const ac of this.requests.values()) ac.abort()
    await this.detach()
  }

  // ---- 內部 ----

  private async detach(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.cloudRetryTimer) clearTimeout(this.cloudRetryTimer)
    this.cloudRetryTimer = null
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
    if (
      !this.ollamaOnline ||
      !vm ||
      !sameModel(vm.model, this.settings.embedModel) ||
      !text.trim()
    ) {
      return null
    }
    try {
      const [v] = await this.client.embed(this.settings.embedModel, [text.trim()])
      return v
    } catch (e) {
      // 離線時順便更新狀態
      if (e instanceof OllamaError && e.kind === 'offline') void this.checkOllama()
      return null
    }
  }

  /** 目前對話使用的 client 與模型；雲端服務缺 key、位址或模型時丟出給使用者看的錯誤 */
  private chatTarget(): { client: ChatClient; model: string } {
    const s = this.settings
    if (s.provider === 'ollama') return { client: this.client, model: s.chatModel }
    const problem = this.cloudProblem()
    if (problem) throw new Error(problem)
    this.cloud ??= this.makeCloudClient(s.provider)
    return { client: this.cloud, model: activeChatModel(s) }
  }

  /** 雲端服務缺少的設定（key、custom 位址、模型）；都齊全時為 null */
  private cloudProblem(): string | null {
    const p = this.settings.provider
    if (p === 'ollama') return null
    const label = PROVIDER_LABELS[p]
    if (!cloudBaseUrl(this.settings, p))
      return 'Enter the API address of the custom provider in AI settings.'
    if (!this.keys.get(p)) return `Add an API key for ${label} in AI settings.`
    if (!activeChatModel(this.settings)) return `Choose a ${label} model in AI settings.`
    return null
  }

  private makeCloudClient(provider: CloudProvider): ChatClient {
    const baseUrl = cloudBaseUrl(this.settings, provider)
    const apiKey = this.keys.get(provider) ?? ''
    return this.opts.createCloudClient
      ? this.opts.createCloudClient({ provider, baseUrl, apiKey })
      : createOpenAiCompatible({ baseUrl, apiKey, label: PROVIDER_LABELS[provider] })
  }

  /** Ollama 只有在本機時 num_ctx 才有意義；雲端服務不帶 */
  private chatOptions(
    signal: AbortSignal,
    onDelta: ((text: string) => void) | undefined,
    temperature: number
  ): ChatOptions {
    return {
      signal,
      onDelta,
      temperature,
      ...(this.settings.provider === 'ollama' ? { numCtx: CHAT_NUM_CTX } : {})
    }
  }

  /** 對話失敗時更新連線狀態 */
  private onChatError(e: unknown): void {
    if (!(e instanceof LlmError)) return
    if (this.settings.provider === 'ollama') {
      if (e.kind === 'offline') void this.checkOllama()
    } else if (e.kind === 'offline' || e.kind === 'timeout' || e.kind === 'auth') {
      void this.checkCloud()
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
          this.ollamaOnline = false
          this.scheduleRetry()
        }
        this.emit()
      }
    })
    return embedder
  }

  /** 檢查 Ollama 與目前的雲端服務 */
  private async check(): Promise<void> {
    await Promise.all([this.checkOllama(), this.checkCloud()])
  }

  /** 檢查 Ollama 是否可用、模型是否已下載；可用時恢復 embedding，否則稍後重試 */
  private checkOllama(): Promise<void> {
    this.checking ??= this.checkOllamaNow().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async checkOllamaNow(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      await this.client.version()
      this.models = await this.client.models()
      this.ollamaOnline = true
      // 雲端模式下 Ollama 只負責 embedding
      const needed =
        this.settings.provider === 'ollama'
          ? [this.settings.embedModel, this.settings.chatModel]
          : [this.settings.embedModel]
      const missing = needed.filter((m) => !this.models.some((x) => sameModel(x, m)))
      this.error = missing.length
        ? `Not installed: ${missing.join(', ')}. Run: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}`
        : null
      if (this.embedder && !missing.includes(this.settings.embedModel)) {
        this.embedder.error = null
        this.embedder.wake()
      }
    } catch (e) {
      this.ollamaOnline = false
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
      void this.checkOllama()
    }, this.opts.retryMs ?? RETRY_MS)
  }

  /**
   * 檢查雲端服務：設定齊全時列出模型（同時確認 key 與連線）。
   * key 錯誤不重試（使用者要改設定）；連不上、逾時每隔一段時間重試；
   * 其他錯誤（例如服務沒有 /models）視為可用，只是沒有模型清單。
   */
  private async checkCloud(): Promise<void> {
    if (this.cloudRetryTimer) clearTimeout(this.cloudRetryTimer)
    this.cloudRetryTimer = null
    const gen = ++this.cloudCheck
    const p = this.settings.provider
    if (p === 'ollama') {
      this.cloudOnline = false
      this.cloudError = null
      this.cloudModels = []
      return
    }
    // 缺 key 或位址時不必連線；沒選模型時仍要列出模型讓使用者選
    const problem = cloudBaseUrl(this.settings, p) && this.keys.get(p) ? null : this.cloudProblem()
    if (problem) {
      this.cloudOnline = false
      this.cloudError = problem
      this.cloudModels = []
      return this.emit()
    }
    this.cloud ??= this.makeCloudClient(p)
    let models: string[] = []
    let error: string | null = null
    let retry = false
    try {
      models = await this.cloud.models()
    } catch (e) {
      const kind = e instanceof LlmError ? e.kind : 'http'
      if (kind === 'auth' || kind === 'offline' || kind === 'timeout') error = errorMessage(e)
      retry = kind === 'offline' || kind === 'timeout'
    }
    if (gen !== this.cloudCheck) return
    // key 與連線都沒問題，但還沒選模型
    error ??= this.cloudProblem()
    this.cloudOnline = !error
    this.cloudError = error
    this.cloudModels = models
    if (retry && !this.disposed && this.vault) {
      this.cloudRetryTimer = setTimeout(() => {
        this.cloudRetryTimer = null
        void this.checkCloud()
      }, this.opts.retryMs ?? RETRY_MS)
    }
    this.emit()
  }

  private emit(): void {
    if (!this.disposed) this.opts.onStatus(this.status())
  }
}

/** 雲端模型不支援工具呼叫時的錯誤（各服務的訊息不同） */
const isCloudNoToolsError = (e: unknown): boolean =>
  e instanceof LlmError &&
  e.kind === 'http' &&
  /(does not support|not supported|unsupported)[^.]{0,40}(tools|tool use|function calling)|(tools|tool use|function calling)[^.]{0,40}(not supported|unsupported)/i.test(
    e.message
  )

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
