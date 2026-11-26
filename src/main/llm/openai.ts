// Client for OpenAI-compatible Chat Completions (OpenAI, Gemini's OpenAI-compatible endpoint, OpenRouter, LM Studio…).
// Uses only Node's built-in fetch, which can be injected for tests. Chat only; embeddings always use Ollama.
// https://platform.openai.com/docs/api-reference/chat
// https://ai.google.dev/gemini-api/docs/openai
import {
  LlmError,
  type ChatClient,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type ToolCall,
  type ToolDefinition
} from './ollama'

/** Timeout for listing models (also used to check the key and connection) */
export const CLOUD_CHECK_TIMEOUT_MS = 5_000

export interface OpenAiCompatibleOptions {
  baseUrl: string
  apiKey: string
  /** Provider name used in error messages (for example OpenAI) */
  label: string
  /**
   * Name of the output limit parameter: newer OpenAI models only accept max_completion_tokens,
   * while most compatible providers only recognize max_tokens. Defaults to max_tokens; when rejected, resend once with the other name.
   */
  maxTokensParam?: MaxTokensParam
  fetchImpl?: typeof fetch
}

export type MaxTokensParam = 'max_tokens' | 'max_completion_tokens'

/** Models that are clearly not for chat (the model list is only a suggestion; users can still type a model) */
const NOT_CHAT =
  /embed|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|imagen|veo|aqa/i

export function createOpenAiCompatible(o: OpenAiCompatibleOptions): ChatClient {
  const fetchImpl = o.fetchImpl ?? fetch
  const url = (p: string): string => o.baseUrl.replace(/\/+$/, '') + p
  const host = ((): string => {
    try {
      return new URL(o.baseUrl).host
    } catch {
      return o.baseUrl
    }
  })()

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
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      })
    } catch (e) {
      throw toError(e, host, opts.signal)
    }
    if (!res.ok) {
      const detail = await res.text().then(errorText, () => '')
      throw httpError(o.label, res.status, detail, opts.model)
    }
    return res
  }

  async function stream(
    model: string,
    messages: ChatMessage[],
    tools: readonly ToolDefinition[] | undefined,
    opts: ChatOptions
  ): Promise<ChatResult> {
    let temperature = opts.temperature !== undefined
    let tokenParam: MaxTokensParam = o.maxTokensParam ?? 'max_tokens'
    let tokenError: LlmError | null = null
    const send = (): Promise<Response> =>
      request(
        '/chat/completions',
        {
          model,
          messages: toOpenAiMessages(messages),
          stream: true,
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(temperature ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens === undefined ? {} : { [tokenParam]: opts.maxTokens })
        },
        { signal: opts.signal, model }
      )
    // Each parameter is adjusted at most once, so at most three requests are sent
    const open = async (): Promise<Response> => {
      for (;;) {
        try {
          return await send()
        } catch (e) {
          if (!(e instanceof LlmError && e.kind === 'http')) throw e
          // Reasoning models (the o series, gpt-5 and so on) only accept the default temperature: resend without it
          if (temperature && /temperature/i.test(e.message)) {
            temperature = false
            continue
          }
          if (opts.maxTokens !== undefined && /max_(completion_)?tokens/i.test(e.message)) {
            // Still rejected after switching names: report the first error (usually the value exceeds the model's limit)
            if (tokenError) throw tokenError
            tokenError = e
            tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
            continue
          }
          throw e
        }
      }
    }
    const res = await open()

    let content = ''
    const calls = new Map<number, { id?: string; name: string; args: string; extra?: unknown }>()
    try {
      await readSse(res.body, (data) => {
        const obj = JSON.parse(data) as {
          error?: unknown
          choices?: {
            delta?: { content?: unknown; tool_calls?: unknown[] }
            finish_reason?: unknown
          }[]
        }
        if (obj.error) throw new LlmError(`${o.label} error: ${errorMessage(obj.error)}`, 'http')
        const delta = obj.choices?.[0]?.delta
        if (obj.choices?.[0]?.finish_reason === 'length') opts.onTruncated?.()
        if (typeof delta?.content === 'string' && delta.content) {
          content += delta.content
          opts.onDelta?.(delta.content)
        }
        for (const raw of delta?.tool_calls ?? []) {
          const c = raw as {
            index?: unknown
            id?: unknown
            function?: { name?: unknown; arguments?: unknown }
            extra_content?: unknown
          }
          // Providers without an index send whole calls at once: treat each as a new one
          const index = typeof c.index === 'number' ? c.index : 1_000_000 + calls.size
          const call = calls.get(index) ?? { name: '', args: '' }
          if (typeof c.id === 'string' && c.id) call.id = c.id
          if (typeof c.function?.name === 'string') call.name += c.function.name
          if (typeof c.function?.arguments === 'string') call.args += c.function.arguments
          else if (c.function?.arguments && typeof c.function.arguments === 'object') {
            call.args = JSON.stringify(c.function.arguments)
          }
          if (c.extra_content !== undefined) call.extra = c.extra_content
          calls.set(index, call)
        }
      })
    } catch (e) {
      throw e instanceof LlmError ? e : toError(e, host, opts.signal)
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([, c]) => ({
        name: c.name,
        arguments: parseArgs(c.args),
        ...(c.id ? { id: c.id } : {}),
        ...(c.extra !== undefined ? { extra: c.extra } : {})
      }))
    return { content, toolCalls }
  }

  return {
    async models() {
      const res = await request('/models', undefined, { timeout: CLOUD_CHECK_TIMEOUT_MS })
      let data: { data?: { id?: unknown }[] }
      try {
        data = (await res.json()) as typeof data
      } catch (e) {
        throw toError(e, host)
      }
      const ids = (Array.isArray(data.data) ? data.data : [])
        .map((m) => (typeof m?.id === 'string' ? m.id.replace(/^models\//, '') : ''))
        .filter((id) => id && !NOT_CHAT.test(id))
      return [...new Set(ids)].sort()
    },

    async chat(model, messages, opts = {}) {
      return (await stream(model, messages, undefined, opts)).content
    },

    chatTools(model, messages, tools, opts = {}) {
      return stream(model, messages, tools, opts)
    }
  }
}

interface OpenAiMessage {
  role: string
  content: string | null
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: unknown
  }[]
  tool_call_id?: string
}

/**
 * Converts the internal message format (Ollama style: arguments as an object, tool messages with tool_name) to OpenAI's.
 * Tool calls without an id (from providers that don't return ids) get a stable id by position, matched by later tool messages in order.
 */
export function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  let pending: string[] = []
  return messages.map((m, i) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const toolCalls = m.tool_calls.map((c, j) => ({
        id: c.id ?? `call_${i}_${j}`,
        type: 'function' as const,
        function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments) },
        ...(c.extra !== undefined ? { extra_content: c.extra } : {})
      }))
      pending = toolCalls.map((c) => c.id)
      return { role: 'assistant', content: m.content || null, tool_calls: toolCalls }
    }
    if (m.role === 'tool') {
      const id = m.tool_call_id ?? pending.shift() ?? `call_${i}`
      if (m.tool_call_id) pending = pending.filter((p) => p !== m.tool_call_id)
      return { role: 'tool', tool_call_id: id, content: m.content }
    }
    return { role: m.role, content: m.content }
  })
}

/** Yields each SSE data payload (multi-line data joined with newlines); [DONE] isn't returned */
export async function readSse(
  body: ReadableStream<Uint8Array> | null,
  onData: (data: string) => void
): Promise<void> {
  if (!body) return
  const decoder = new TextDecoder()
  let buf = ''
  let data: string[] = []
  const dispatch = (): void => {
    if (data.length === 0) return
    const d = data.join('\n')
    data = []
    if (d.trim() && d.trim() !== '[DONE]') onData(d)
  }
  const line = (raw: string): void => {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (l === '') return dispatch()
    if (l.startsWith('data:')) data.push(l.slice(l.startsWith('data: ') ? 6 : 5))
    // Other fields (event:, id:, comments) aren't needed
  }
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      line(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  }
  buf += decoder.decode()
  if (buf) line(buf)
  dispatch()
}

function parseArgs(s: string): Record<string, unknown> {
  if (!s.trim()) return {}
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** OpenAI: { error: { message } }; Gemini sometimes sends [{ error: { message } }] */
function errorText(body: string): string {
  try {
    let v = JSON.parse(body)
    if (Array.isArray(v)) v = v[0]
    return v?.error ? errorMessage(v.error) : body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  const m = (e as { message?: unknown })?.message
  return typeof m === 'string' ? m : JSON.stringify(e).slice(0, 200)
}

function httpError(label: string, status: number, detail: string, model?: string): LlmError {
  const suffix = detail ? `: ${detail}` : ''
  if (status === 401 || status === 403) {
    return new LlmError(`${label} rejected the API key (${status})${suffix}`, 'auth')
  }
  if (status === 429) {
    return new LlmError(`${label} rate limit or quota exceeded${suffix}. Try again later.`, 'rate')
  }
  if (status === 404 && model) {
    return new LlmError(`Model "${model}" is not available from ${label}${suffix}`, 'model')
  }
  return new LlmError(`${label} error ${status}${suffix}`, 'http')
}

function toError(e: unknown, host: string, userSignal?: AbortSignal): LlmError {
  if (e instanceof LlmError) return e
  const name = (e as { name?: string })?.name
  if (userSignal?.aborted) return new LlmError('Cancelled', 'aborted')
  if (name === 'TimeoutError') return new LlmError(`${host} did not respond in time`, 'timeout')
  if (name === 'AbortError') return new LlmError('Cancelled', 'aborted')
  if (e instanceof SyntaxError) return new LlmError(`${host} returned an invalid response`, 'http')
  return new LlmError(`Cannot connect to ${host}. Check your internet connection.`, 'offline')
}
