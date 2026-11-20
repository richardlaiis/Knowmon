// OpenAI 相容的 Chat Completions client（OpenAI、Gemini 的 OpenAI 相容端點、OpenRouter、LM Studio…）。
// 只用 Node 內建的 fetch；fetch 可注入以便測試。只負責對話，embedding 一律走 Ollama。
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

/** 列出模型（也用來檢查 key 與連線）的逾時 */
export const CLOUD_CHECK_TIMEOUT_MS = 5_000

export interface OpenAiCompatibleOptions {
  baseUrl: string
  apiKey: string
  /** 錯誤訊息中的服務名稱（例如 OpenAI） */
  label: string
  fetchImpl?: typeof fetch
}

/** 明顯不是對話用的模型（模型清單只當作建議，使用者仍可手動輸入） */
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
    const send = (temperature: boolean): Promise<Response> =>
      request(
        '/chat/completions',
        {
          model,
          messages: toOpenAiMessages(messages),
          stream: true,
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(temperature && opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : {})
        },
        { signal: opts.signal, model }
      )
    let res: Response
    try {
      res = await send(true)
    } catch (e) {
      // 推理模型（o 系列、gpt-5 等）只接受預設的 temperature：不帶參數重送
      if (
        !(e instanceof LlmError && e.kind === 'http' && /temperature/i.test(e.message)) ||
        opts.temperature === undefined
      ) {
        throw e
      }
      res = await send(false)
    }

    let content = ''
    const calls = new Map<number, { id?: string; name: string; args: string; extra?: unknown }>()
    try {
      await readSse(res.body, (data) => {
        const obj = JSON.parse(data) as {
          error?: unknown
          choices?: { delta?: { content?: unknown; tool_calls?: unknown[] } }[]
        }
        if (obj.error) throw new LlmError(`${o.label} error: ${errorMessage(obj.error)}`, 'http')
        const delta = obj.choices?.[0]?.delta
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
          // 沒有 index 的服務一次給完整的呼叫：各自當成新的一個
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
 * 內部的訊息格式（Ollama 風格：arguments 是物件、tool 訊息帶 tool_name）轉成 OpenAI 格式。
 * 工具呼叫沒有 id 時（不回傳 id 的服務）依位置產生固定的 id，之後的 tool 訊息依序對應。
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

/** 逐一取出 SSE 的 data（多行 data 以換行連接）；[DONE] 不回傳 */
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
    // 其他欄位（event:、id:、註解）不需要
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

/** OpenAI：{ error: { message } }；Gemini 有時是 [{ error: { message } }] */
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
