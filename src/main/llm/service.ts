// LLM service: Ollama connection status, background embedding, hybrid retrieval, summaries, Q&A.
// Ollama is optional: when it can't be reached, the status is offline and it retries periodically, and everything else works.
// Chat (summaries, Q&A, Agent) can use a cloud provider (OpenAI-compatible API) instead; embeddings always use Ollama.
import crypto from 'node:crypto'
import {
  activeChatLimits,
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
  planQuery,
  TRUNCATED_NOTICE
} from './ask'
import { chatBudget, type ChatBudget } from './budget'
import { retrieve } from './retrieve'
import { summarize, type Chat } from './summarize'

export const RETRY_MS = 30_000

export interface LlmServiceOptions {
  /** Reads the saved settings (missing fields use the defaults) */
  loadSettings: () => unknown
  saveSettings: (s: LlmSettings) => void
  onStatus: (s: LlmStatus) => void
  onSummary: (c: SummaryChunk) => void
  onAnswer: (c: AnswerChunk) => void
  onAgent: (c: AgentChunk) => void
  /** A fake Ollama injected in tests */
  createClient?: (baseUrl: string) => OllamaClient
  /** Cloud provider client; a fake is injected in tests */
  createCloudClient?: (o: {
    provider: CloudProvider
    baseUrl: string
    apiKey: string
  }) => ChatClient
  /** Storage for API keys; memory only when not provided */
  keys?: KeyStore
  retryMs?: number
  /** The current time for parsing time phrases such as 「上個月」 "last month" (for tests) */
  now?: () => number
}

export class LlmService {
  private settings: LlmSettings
  private client: OllamaClient
  /** Ollama is online (embeddings; also chat when provider = ollama) */
  private ollamaOnline = false
  /** Ollama problems (offline, model not downloaded) */
  private error: string | null = null
  private models: string[] = []
  private readonly keys: KeyStore
  /** Cloud chat client; cleared when settings or keys change and rebuilt on next use */
  private cloud: ChatClient | null = null
  private cloudOnline = false
  private cloudError: string | null = null
  private cloudModels: string[] = []
  private cloudRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** Incremented on every cloud check; results are discarded if settings changed mid-check */
  private cloudCheck = 0
  private vault: Vault | null = null
  private embedder: Embedder | null = null
  private offChunks: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private checking: Promise<void> | null = null
  private readonly requests = new Map<string, AbortController>()
  /** Write proposals waiting for the user's confirmation: `${request id}:${step}` → reply */
  private readonly confirmations = new Map<string, (d: AgentDecision) => void>()
  private disposed = false

  constructor(private readonly opts: LlmServiceOptions) {
    this.settings = cleanLlmSettings(opts.loadSettings())
    this.client = this.makeClient()
    this.keys = opts.keys ?? memoryKeyStore()
  }

  /** Switches vaults (null = close). The old Embedder is stopped first. */
  async attach(vault: Vault | null): Promise<void> {
    await this.detach()
    this.vault = vault
    if (!vault) return this.emit()
    // Don't wake it while offline; it catches up once a retry succeeds
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
      // In cloud mode Ollama only handles embeddings, so its problems don't block chat
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

  /** Re-checks the connection and resumes embedding */
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
      // The embedding model changed: recompute every vector
      await this.embedder?.stop()
      this.embedder = this.makeEmbedder(this.vault)
      this.vault.markSemanticDirty()
    }
    await this.check()
    return this.status()
  }

  /** Saves a cloud provider's API key (null or an empty string = delete) and re-checks the current provider */
  async setApiKey(provider: CloudProvider, key: string | null): Promise<LlmStatus> {
    if (!isCloudProvider(provider)) throw new Error('Unknown provider.')
    const k = typeof key === 'string' ? key.trim() : ''
    if (k.length > API_KEY_MAX) throw new Error('The API key is too long.')
    // It goes into an HTTP header: only visible ASCII characters are allowed
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

  /** Starts a streaming summary and returns a request id; results are pushed through onSummary */
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
    const budget = this.budget()
    const language = req.language === 'en' ? 'en' : 'zh-TW'
    // When a summary is split, only the last call is shown on screen, so only check whether that one was cut off
    let truncated = false
    const chat: Chat = (messages, onDelta) => {
      truncated = false
      return client.chat(
        model,
        messages,
        this.chatOptions(ac.signal, onDelta, 0.3, () => (truncated = true))
      )
    }
    // Return the id first so the renderer can match the chunks pushed afterwards
    setImmediate(() => {
      summarize(
        chat,
        selection.trim() ? 'selection' : 'note',
        note.title,
        text,
        (delta) => send({ delta, done: false }),
        language,
        budget
      )
        .then(() => {
          if (truncated) send({ delta: TRUNCATED_NOTICE[language], done: false })
          send({ delta: '', done: true })
        })
        .catch((e) => {
          if (ac.signal.aborted) send({ delta: '', done: true })
          else send({ delta: '', done: true, error: errorMessage(e) })
          this.onChatError(e)
        })
        .finally(() => this.requests.delete(id))
    })
    return id
  }

  /** Starts streaming an answer and returns a request id; sources and the answer are pushed through onAnswer */
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
    const budget = this.budget()
    let truncated = false
    const chat: Chat = (messages, onDelta) =>
      client.chat(
        model,
        messages,
        this.chatOptions(ac.signal, onDelta, 0.2, () => (truncated = true))
      )

    const run = async (): Promise<number[]> => {
      const plan = planQuery(question, history, req.range, (this.opts.now ?? Date.now)())
      const opts = { limit: ASK_SOURCES, ...(plan.range ?? {}) }
      let hits: RetrieveResult['hits'] = []
      let vector = false
      // Only a time and nothing to retrieve (「上個月寫了什麼？」 "what did I write last month?"): list the notes in the range directly
      if (plan.keywords.length > 0 || !plan.range) {
        const qv = await this.queryVector(vault, plan.vectorText)
        if (ac.signal.aborted) return []
        const r = retrieve(vault.db, plan.vectorText, qv, opts, plan.keywords)
        hits = r.hits
        vector = r.vector
      }
      if (hits.length === 0 && plan.range) hits = notesInRange(vault.db, plan.range)
      const sources = gatherSources(vault.db, hits, budget.askContext, budget.askChunk)
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
      if (truncated) send({ delta: TRUNCATED_NOTICE[language], done: false })
      return result.cited
    }

    // Return the id first so the renderer can match the chunks pushed afterwards
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

  /** Starts an agent task and returns a request id; steps and text are pushed through onAgent */
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
    const budget = this.budget()
    const now = (this.opts.now ?? Date.now)()
    const ctx: ToolContext = {
      vault,
      now,
      queryVector: (text) => this.queryVector(vault, text),
      noteChars: budget.noteChars
    }
    // The task ends when the model answers directly (no tool calls), so the last call is the final answer
    let truncated = false
    const chat: ToolChat = (messages, tools, onDelta) => {
      truncated = false
      return client.chatTools(
        model,
        messages,
        tools ?? [],
        this.chatOptions(ac.signal, onDelta, 0.2, () => (truncated = true))
      )
    }
    const confirm = (step: { index: number }): Promise<AgentDecision> =>
      new Promise((resolve) => {
        const key = `${id}:${step.index}`
        const done = (d: AgentDecision): void => {
          this.confirmations.delete(key)
          ac.signal.removeEventListener('abort', onAbort)
          resolve(d)
        }
        // Stopping, switching vaults or closing the app: counts as rejected, nothing is written
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
          signal: ac.signal,
          budget
        },
        agentMessages(task, history, language, now),
        language
      )

    // Return the id first so the renderer can match the chunks pushed afterwards
    setImmediate(() => {
      run()
        .then(() => {
          if (truncated) send({ delta: TRUNCATED_NOTICE[language], done: false })
          send({ delta: '', done: true })
        })
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

  /** Answers an agent write proposal; ignored when nothing is waiting any more (stopped, or answered twice) */
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

  // ---- Internals ----

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

  /** The query vector; null when offline, vectors aren't built yet or the model differs (retrieval falls back to full text) */
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
      // While offline, also update the status
      if (e instanceof OllamaError && e.kind === 'offline') void this.checkOllama()
      return null
    }
  }

  /** The client and model currently used for chat; throws a user-facing error when a cloud provider is missing its key, address or model */
  private chatTarget(): { client: ChatClient; model: string } {
    const s = this.settings
    if (s.provider === 'ollama') return { client: this.client, model: s.chatModel }
    const problem = this.cloudProblem()
    if (problem) throw new Error(problem)
    this.cloud ??= this.makeCloudClient(s.provider)
    return { client: this.cloud, model: activeChatModel(s) }
  }

  /** What the cloud provider is missing (key, custom address, model); null when everything is set */
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
      : createOpenAiCompatible({
          baseUrl,
          apiKey,
          label: PROVIDER_LABELS[provider],
          maxTokensParam: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'
        })
  }

  /** The current provider's character budgets (scaled by the configured context length) */
  private budget(): ChatBudget {
    return chatBudget(activeChatLimits(this.settings).contextTokens)
  }

  /**
   * The current provider's context length and output limit. num_ctx is sent only to Ollama (the cloud has no such parameter);
   * summaries, Q&A and the agent use the same value, otherwise Ollama reloads the model and clears its prompt cache.
   */
  private chatOptions(
    signal: AbortSignal,
    onDelta: ((text: string) => void) | undefined,
    temperature: number,
    onTruncated: () => void
  ): ChatOptions {
    const limits = activeChatLimits(this.settings)
    return {
      signal,
      onDelta,
      temperature,
      onTruncated,
      ...(this.settings.provider === 'ollama' ? { numCtx: limits.contextTokens } : {}),
      ...(limits.maxOutputTokens === null ? {} : { maxTokens: limits.maxOutputTokens })
    }
  }

  /** Updates the connection status when chat fails */
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

  /** Checks Ollama and the current cloud provider */
  private async check(): Promise<void> {
    await Promise.all([this.checkOllama(), this.checkCloud()])
  }

  /** Checks whether Ollama is available and the models are downloaded; resumes embedding when available, otherwise retries later */
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
      // In cloud mode Ollama only handles embeddings
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
   * Checks the cloud provider: when fully configured, lists models (which also confirms the key and connection).
   * A bad key isn't retried (the user needs to change the settings); unreachable or timed-out providers are retried periodically;
   * other errors (for example a provider without /models) count as available, just without a model list.
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
    // No need to connect without a key or address; without a model, still list models so the user can choose
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
    // The key and connection are fine, but no model has been chosen yet
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

/** The error when a cloud model doesn't support tool calling (each provider words it differently) */
const isCloudNoToolsError = (e: unknown): boolean =>
  e instanceof LlmError &&
  e.kind === 'http' &&
  /(does not support|not supported|unsupported)[^.]{0,40}(tools|tool use|function calling)|(tools|tool use|function calling)[^.]{0,40}(not supported|unsupported)/i.test(
    e.message
  )

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
