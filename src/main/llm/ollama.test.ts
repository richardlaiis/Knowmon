import { describe, expect, it } from 'vitest'
import {
  createOllama,
  isNoToolsError,
  OllamaError,
  readNdjson,
  type ToolDefinition
} from './ollama'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function fakeFetch(handler: Handler): {
  fetch: typeof fetch
  calls: { url: string; body: unknown }[]
} {
  const calls: { url: string; body: unknown }[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    return handler(url, init)
  }) as typeof fetch
  return { fetch: f, calls }
}

function stream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p))
      c.close()
    }
  })
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function rejection(p: Promise<unknown>): Promise<OllamaError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(OllamaError)
    return e as OllamaError
  }
  throw new Error('expected rejection')
}

describe('readNdjson', () => {
  it('跨片段的行與最後沒有換行的一行都能解析', async () => {
    const out: unknown[] = []
    await readNdjson(stream(['{"a":', '1}\n{"b":2}\n\n{"c', '":"中文"}']), (o) => out.push(o))
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: '中文' }])
  })

  it('多位元組字元被切在兩個片段之間', async () => {
    const bytes = new TextEncoder().encode('{"t":"總結"}\n')
    const out: unknown[] = []
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8))
        c.enqueue(bytes.slice(8))
        c.close()
      }
    })
    await readNdjson(s, (o) => out.push(o))
    expect(out).toEqual([{ t: '總結' }])
  })
})

describe('createOllama', () => {
  it('version 與已下載的模型', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/api/version')
        ? json({ version: '0.35.1' })
        : json({ models: [{ name: 'qwen3:8b' }, { name: 'bge-m3:latest' }] })
    )
    const o = createOllama('http://host:11434/', fetch)
    expect(await o.version()).toBe('0.35.1')
    expect(await o.models()).toEqual(['bge-m3:latest', 'qwen3:8b'])
  })

  it('embed 批次送出', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        embeddings: [
          [1, 0],
          [0, 1]
        ]
      })
    )
    const o = createOllama('http://host:11434', fetch)
    expect(await o.embed('bge-m3', ['a', 'b'])).toEqual([
      [1, 0],
      [0, 1]
    ])
    expect(calls[0]).toEqual({
      url: 'http://host:11434/api/embed',
      body: { model: 'bge-m3', input: ['a', 'b'], truncate: true }
    })
    expect(await o.embed('bge-m3', [])).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('連不上時是 offline 錯誤', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const e = await rejection(createOllama('http://host', fetch).version())
    expect(e.kind).toBe('offline')
  })

  it('模型未下載時提示 ollama pull', async () => {
    const { fetch } = fakeFetch(() => json({ error: "model 'bge-m3' not found" }, 404))
    const e = await rejection(createOllama('http://host', fetch).embed('bge-m3', ['x']))
    expect(e.kind).toBe('model')
    expect(e.message).toContain('ollama pull bge-m3')
  })

  it('其他 HTTP 錯誤帶上 Ollama 的訊息', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'boom' }, 500))
    const e = await rejection(createOllama('http://host', fetch).models())
    expect(e).toMatchObject({ kind: 'http', message: 'Ollama error 500: boom' })
  })

  it('chat 串流片段並回傳全文，關閉思考', async () => {
    const lines = [
      { message: { role: 'assistant', content: '重' } },
      { message: { role: 'assistant', content: '點' } },
      { message: { role: 'assistant', content: '' }, done: true }
    ]
    const { fetch, calls } = fakeFetch(
      () => new Response(stream(lines.map((l) => JSON.stringify(l) + '\n')))
    )
    const deltas: string[] = []
    const out = await createOllama('http://host', fetch).chat(
      'qwen3:8b',
      [{ role: 'user', content: '總結' }],
      { onDelta: (d) => deltas.push(d) }
    )
    expect(out).toBe('重點')
    expect(deltas).toEqual(['重', '點'])
    expect(calls[0].body).toMatchObject({ model: 'qwen3:8b', stream: true, think: false })
  })

  it('模型不支援 think 參數時不帶參數重送', async () => {
    const { fetch, calls } = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init.body))
      if ('think' in body) return json({ error: '"llama3" does not support thinking' }, 400)
      return new Response(stream([JSON.stringify({ message: { content: 'ok' } }) + '\n']))
    })
    const out = await createOllama('http://host', fetch).chat('llama3', [])
    expect(out).toBe('ok')
    expect(calls).toHaveLength(2)
  })

  it('串流中的錯誤與取消', async () => {
    const { fetch } = fakeFetch(
      () => new Response(stream([JSON.stringify({ error: 'out of memory' }) + '\n']))
    )
    const e = await rejection(createOllama('http://host', fetch).chat('m', []))
    expect(e).toMatchObject({ kind: 'http', message: 'out of memory' })

    const ac = new AbortController()
    const slow = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const p = createOllama('http://host', slow.fetch).chat('m', [], { signal: ac.signal })
    ac.abort()
    expect((await rejection(p)).kind).toBe('aborted')
  })

  it('chatTools 送出工具定義與 num_ctx，回傳文字與工具呼叫', async () => {
    const lines = [
      { message: { role: 'assistant', content: '我先搜尋' } },
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { index: 0, name: 'search_notes', arguments: { query: '習慣' } } },
            // 有些模型的 arguments 是 JSON 字串
            { function: { name: 'get_note', arguments: '{"path":"原子習慣"}' } },
            { function: { name: 'broken', arguments: 'not json' } },
            { nothing: true }
          ]
        }
      },
      { message: { role: 'assistant', content: '' }, done: true }
    ]
    const { fetch, calls } = fakeFetch(
      () => new Response(stream(lines.map((l) => JSON.stringify(l) + '\n')))
    )
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'search_notes',
          description: 'd',
          parameters: { type: 'object', properties: {} }
        }
      }
    ]
    const deltas: string[] = []
    const out = await createOllama('http://host', fetch).chatTools(
      'qwen3:8b',
      [{ role: 'user', content: '找' }],
      tools,
      { onDelta: (d) => deltas.push(d), numCtx: 16384, temperature: 0.2 }
    )
    expect(out).toEqual({
      content: '我先搜尋',
      toolCalls: [
        { name: 'search_notes', arguments: { query: '習慣' } },
        { name: 'get_note', arguments: { path: '原子習慣' } },
        { name: 'broken', arguments: {} }
      ]
    })
    expect(deltas).toEqual(['我先搜尋'])
    expect(calls[0].body).toMatchObject({
      tools,
      think: false,
      options: { temperature: 0.2, num_ctx: 16384 }
    })
  })

  it('沒有工具時不送 tools 參數；模型不支援工具時可辨識', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(stream([JSON.stringify({ message: { content: 'ok' } }) + '\n']))
    )
    await createOllama('http://host', fetch).chatTools('m', [], [])
    expect(calls[0].body).not.toHaveProperty('tools')
    expect(calls[0].body).not.toHaveProperty('options')

    const bad = fakeFetch(() =>
      json({ error: 'registry.ollama.ai/library/gemma:2b does not support tools' }, 400)
    )
    const e = await rejection(createOllama('http://host', bad.fetch).chatTools('gemma:2b', [], []))
    expect(isNoToolsError(e)).toBe(true)
    expect(isNoToolsError(new OllamaError('x', 'http'))).toBe(false)
  })
})
