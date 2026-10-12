// Ollama HTTP API client。只用 Node 內建的 fetch；fetch 可注入以便測試。
// https://github.com/ollama/ollama/blob/main/docs/api.md

export type OllamaErrorKind = 'offline' | 'model' | 'timeout' | 'aborted' | 'http'

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly kind: OllamaErrorKind
  ) {
    super(message)
    this.name = 'OllamaError'
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  signal?: AbortSignal
  /** 串流回來的每個片段 */
  onDelta?: (text: string) => void
  temperature?: number
}

export interface OllamaClient {
  version(): Promise<string>
  /** 已下載的模型名稱 */
  models(): Promise<string[]>
  embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]>
  /** 串流對話，回傳完整的回覆 */
  chat(model: string, messages: ChatMessage[], opts?: ChatOptions): Promise<string>
}

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
      const send = (think: boolean): Promise<Response> =>
        request(
          '/api/chat',
          {
            model,
            messages,
            stream: true,
            // qwen3 等思考模型不輸出思考過程；不支援 think 的模型改用不帶參數重送
            ...(think ? { think: false } : {}),
            ...(opts.temperature === undefined
              ? {}
              : { options: { temperature: opts.temperature } })
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
      let out = ''
      try {
        await readNdjson(res.body, (obj) => {
          const o = obj as { message?: { content?: string }; error?: string }
          if (o.error) throw new OllamaError(o.error, 'http')
          const delta = o.message?.content ?? ''
          if (delta) {
            out += delta
            opts.onDelta?.(delta)
          }
        })
      } catch (e) {
        throw e instanceof OllamaError ? e : toError(e, opts.signal)
      }
      return out
    }
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
