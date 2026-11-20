// Ollama HTTP API client。只用 Node 內建的 fetch；fetch 可注入以便測試。
// https://github.com/ollama/ollama/blob/main/docs/api.md

/** auth：API key 錯誤（401/403）；rate：超過用量或頻率限制（429） */
export type LlmErrorKind = 'offline' | 'model' | 'timeout' | 'aborted' | 'http' | 'auth' | 'rate'
export type OllamaErrorKind = LlmErrorKind

/** Ollama 與雲端 client 共用的錯誤 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** 舊名稱：Ollama 是第一個 client，許多地方仍用這個名字 */
export const OllamaError = LlmError
export type OllamaError = LlmError

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** assistant 要求的工具呼叫（送回模型時原樣附上） */
  tool_calls?: {
    /** 雲端 API 的工具呼叫 id（Ollama 沒有；送給 Ollama 前去掉） */
    id?: string
    /** 服務商要求原樣帶回的資料（Gemini 的 thought signature）；送給 Ollama 前去掉 */
    extra?: unknown
    function: { name: string; arguments: Record<string, unknown> }
  }[]
  /** role = 'tool' 時：結果屬於哪個工具 */
  tool_name?: string
  /** role = 'tool' 時：對應的工具呼叫 id（雲端 API 用；送給 Ollama 前去掉） */
  tool_call_id?: string
}

/** Ollama 的工具定義（JSON schema） */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  /** 雲端 API 的工具呼叫 id */
  id?: string
  /** 服務商要求原樣帶回的資料（例如 Gemini 的 thought signature） */
  extra?: unknown
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
}

export interface ChatOptions {
  signal?: AbortSignal
  /** 串流回來的每個片段 */
  onDelta?: (text: string) => void
  temperature?: number
  /** context 長度（tokens）；不設時用模型的預設值。只有 Ollama 使用 */
  numCtx?: number
}

/** 對話用的 client：Ollama 或雲端（OpenAI 相容）服務 */
export interface ChatClient {
  /** 可用的模型名稱（Ollama：已下載的模型） */
  models(): Promise<string[]>
  /** 串流對話，回傳完整的回覆 */
  chat(model: string, messages: ChatMessage[], opts?: ChatOptions): Promise<string>
  /** 帶工具的串流對話：回傳文字與模型要求的工具呼叫 */
  chatTools(
    model: string,
    messages: ChatMessage[],
    tools: readonly ToolDefinition[],
    opts?: ChatOptions
  ): Promise<ChatResult>
}

export interface OllamaClient extends ChatClient {
  version(): Promise<string>
  embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]>
}

/** 模型不支援工具呼叫時 Ollama 回傳的錯誤 */
export const isNoToolsError = (e: unknown): boolean =>
  e instanceof OllamaError && e.kind === 'http' && /does not support tools/i.test(e.message)

export const CHECK_TIMEOUT_MS = 2_000
export const EMBED_TIMEOUT_MS = 60_000

type Fetch = typeof fetch

export function createOllama(baseUrl: string, fetchImpl: Fetch = fetch): OllamaClient {
  const url = (p: string): string => baseUrl.replace(/\/+$/, '') + p

  async function request(
    path: string,
    body: unknown | undefined,
    opts: { timeout?: number; signal?: AbortSignal; model?: string }
  ): Promise<Response> {
    const signals = [opts.signal, opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined]
    const signal = AbortSignal.any(signals.filter((s): s is AbortSignal => !!s))
    let res: Response
    try {
      res = await fetchImpl(url(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      })
    } catch (e) {
      throw toError(e, opts.signal)
    }
    if (!res.ok) {
      const detail = await res.text().then(errorText, () => '')
      if (res.status === 404 && opts.model) {
        throw new OllamaError(
          `Model "${opts.model}" is not installed. Run: ollama pull ${opts.model}`,
          'model'
        )
      }
      throw new OllamaError(`Ollama error ${res.status}${detail ? `: ${detail}` : ''}`, 'http')
    }
    return res
  }

  async function json<T>(res: Response, signal?: AbortSignal): Promise<T> {
    try {
      return (await res.json()) as T
    } catch (e) {
      throw toError(e, signal)
    }
  }

  return {
    async version() {
      const res = await request('/api/version', undefined, { timeout: CHECK_TIMEOUT_MS })
      return (await json<{ version: string }>(res)).version
    },

    async models() {
      const res = await request('/api/tags', undefined, { timeout: CHECK_TIMEOUT_MS })
      const data = await json<{ models?: { name: string }[] }>(res)
      return (data.models ?? []).map((m) => m.name).sort()
    },

    async embed(model, input, signal) {
      if (input.length === 0) return []
      const res = await request(
        '/api/embed',
        { model, input, truncate: true },
        { timeout: EMBED_TIMEOUT_MS, signal, model }
      )
      const data = await json<{ embeddings?: number[][] }>(res, signal)
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== input.length) {
        throw new OllamaError('Ollama returned an unexpected embedding response', 'http')
      }
      return data.embeddings
    },

    async chat(model, messages, opts = {}) {
      return (await stream(model, messages, undefined, opts)).content
    },

    chatTools(model, messages, tools, opts = {}) {
      return stream(model, messages, tools, opts)
    }
  }

  async function stream(
    model: string,
    messages: ChatMessage[],
    tools: readonly ToolDefinition[] | undefined,
    opts: ChatOptions
  ): Promise<ChatResult> {
    const options = {
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.numCtx === undefined ? {} : { num_ctx: opts.numCtx })
    }
    const send = (think: boolean): Promise<Response> =>
      request(
        '/api/chat',
        {
          model,
          messages: messages.map(toOllamaMessage),
          stream: true,
          ...(tools && tools.length > 0 ? { tools } : {}),
          // qwen3 等思考模型不輸出思考過程；不支援 think 的模型改用不帶參數重送
          ...(think ? { think: false } : {}),
          ...(Object.keys(options).length > 0 ? { options } : {})
        },
        { signal: opts.signal, model }
      )
    let res: Response
    try {
      res = await send(true)
    } catch (e) {
      if (!(e instanceof OllamaError && e.kind === 'http' && /think/i.test(e.message))) throw e
      res = await send(false)
    }
    let content = ''
    const toolCalls: ToolCall[] = []
    try {
      await readNdjson(res.body, (obj) => {
        const o = obj as {
          message?: { content?: string; tool_calls?: unknown[] }
          error?: string
        }
        if (o.error) throw new OllamaError(o.error, 'http')
        const delta = o.message?.content ?? ''
        if (delta) {
          content += delta
          opts.onDelta?.(delta)
        }
        for (const c of o.message?.tool_calls ?? []) {
          const call = toToolCall(c)
          if (call) toolCalls.push(call)
        }
      })
    } catch (e) {
      throw e instanceof OllamaError ? e : toError(e, opts.signal)
    }
    return { content, toolCalls }
  }
}

/** 去掉 Ollama 不認得的欄位（雲端 API 的工具呼叫 id 等）；同樣的輸入一律得到同樣的結果 */
export function toOllamaMessage(m: ChatMessage): ChatMessage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tool_call_id, tool_calls, ...rest } = m
  return tool_calls
    ? { ...rest, tool_calls: tool_calls.map((c) => ({ function: c.function })) }
    : rest
}

/** Ollama 回傳的工具呼叫；arguments 通常是物件，有些模型給 JSON 字串 */
function toToolCall(c: unknown): ToolCall | null {
  const f = (c as { function?: { name?: unknown; arguments?: unknown } })?.function
  if (!f || typeof f.name !== 'string') return null
  let args = f.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  return {
    name: f.name,
    arguments:
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
  }
}

/** 逐行解析 NDJSON 串流 */
export async function readNdjson(
  body: ReadableStream<Uint8Array> | null,
  onObject: (o: unknown) => void
): Promise<void> {
  if (!body) return
  const decoder = new TextDecoder()
  let buf = ''
  const flushLine = (line: string): void => {
    if (line.trim()) onObject(JSON.parse(line))
  }
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      flushLine(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  }
  flushLine(buf + decoder.decode())
}

function errorText(body: string): string {
  try {
    const e = JSON.parse(body).error
    return typeof e === 'string' ? e : body
  } catch {
    return body.slice(0, 200)
  }
}

function toError(e: unknown, userSignal?: AbortSignal): OllamaError {
  if (e instanceof OllamaError) return e
  const name = (e as { name?: string })?.name
  if (userSignal?.aborted) return new OllamaError('Cancelled', 'aborted')
  if (name === 'TimeoutError') return new OllamaError('Ollama did not respond in time', 'timeout')
  if (name === 'AbortError') return new OllamaError('Cancelled', 'aborted')
  return new OllamaError(
    'Cannot connect to Ollama. Make sure it is running (ollama serve).',
    'offline'
  )
}
