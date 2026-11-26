// Ollama HTTP API client. Uses only Node's built-in fetch, which can be injected for tests.
// https://github.com/ollama/ollama/blob/main/docs/api.md

/** auth: bad API key (401/403); rate: usage or rate limit exceeded (429) */
export type LlmErrorKind = 'offline' | 'model' | 'timeout' | 'aborted' | 'http' | 'auth' | 'rate'
export type OllamaErrorKind = LlmErrorKind

/** Error shared by the Ollama and cloud clients */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** Old name: Ollama was the first client, and many places still use this name */
export const OllamaError = LlmError
export type OllamaError = LlmError

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool calls requested by the assistant (sent back to the model as is) */
  tool_calls?: {
    /** A cloud API's tool call id (Ollama has none; stripped before sending to Ollama) */
    id?: string
    /** Data the provider requires back verbatim (Gemini's thought signature); stripped before sending to Ollama */
    extra?: unknown
    function: { name: string; arguments: Record<string, unknown> }
  }[]
  /** When role = 'tool': which tool the result belongs to */
  tool_name?: string
  /** When role = 'tool': the matching tool call id (for cloud APIs; stripped before sending to Ollama) */
  tool_call_id?: string
}

/** Ollama tool definition (JSON schema) */
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
  /** A cloud API's tool call id */
  id?: string
  /** Data the provider requires back verbatim (for example Gemini's thought signature) */
  extra?: unknown
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
}

export interface ChatOptions {
  signal?: AbortSignal
  /** Each streamed chunk */
  onDelta?: (text: string) => void
  temperature?: number
  /** Context length (tokens); the model's default when unset. Only Ollama uses it */
  numCtx?: number
  /** Maximum tokens per reply; the model's default when unset */
  maxTokens?: number
  /** Called when the reply is cut off by maxTokens */
  onTruncated?: () => void
}

/** Client for chat: Ollama or a cloud (OpenAI-compatible) provider */
export interface ChatClient {
  /** Available model names (Ollama: downloaded models) */
  models(): Promise<string[]>
  /** Streaming chat; returns the full reply */
  chat(model: string, messages: ChatMessage[], opts?: ChatOptions): Promise<string>
  /** Streaming chat with tools: returns the text and the tool calls the model requested */
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

/** The error Ollama returns when a model doesn't support tool calling */
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
      ...(opts.numCtx === undefined ? {} : { num_ctx: opts.numCtx }),
      ...(opts.maxTokens === undefined ? {} : { num_predict: opts.maxTokens })
    }
    const send = (think: boolean): Promise<Response> =>
      request(
        '/api/chat',
        {
          model,
          messages: messages.map(toOllamaMessage),
          stream: true,
          ...(tools && tools.length > 0 ? { tools } : {}),
          // Thinking models such as qwen3 don't output their reasoning; models that don't support think are retried without the parameter
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
          done_reason?: string
        }
        if (o.error) throw new OllamaError(o.error, 'http')
        if (o.done_reason === 'length') opts.onTruncated?.()
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

/** Strips fields Ollama doesn't recognize (cloud API tool call ids and so on); the same input always gives the same result */
export function toOllamaMessage(m: ChatMessage): ChatMessage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tool_call_id, tool_calls, ...rest } = m
  return tool_calls
    ? { ...rest, tool_calls: tool_calls.map((c) => ({ function: c.function })) }
    : rest
}

/** A tool call returned by Ollama; arguments is usually an object, but some models send a JSON string */
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

/** Parses an NDJSON stream line by line */
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
