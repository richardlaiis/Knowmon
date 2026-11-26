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
  it('parses lines split across chunks and a final line without a newline', async () => {
    const out: unknown[] = []
    await readNdjson(stream(['{"a":', '1}\n{"b":2}\n\n{"c', '":"中文"}']), (o) => out.push(o))
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: '中文' }])
  })

  it('handles a multi-byte character split between two chunks', async () => {
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
  it('version and downloaded models', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/api/version')
        ? json({ version: '0.35.1' })
        : json({ models: [{ name: 'qwen3:8b' }, { name: 'bge-m3:latest' }] })
    )
    const o = createOllama('http://host:11434/', fetch)
    expect(await o.version()).toBe('0.35.1')
    expect(await o.models()).toEqual(['bge-m3:latest', 'qwen3:8b'])
  })

  it('embed sends a batch', async () => {
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

  it('unreachable means an offline error', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const e = await rejection(createOllama('http://host', fetch).version())
    expect(e.kind).toBe('offline')
  })

  it('suggests ollama pull when the model is not downloaded', async () => {
    const { fetch } = fakeFetch(() => json({ error: "model 'bge-m3' not found" }, 404))
    const e = await rejection(createOllama('http://host', fetch).embed('bge-m3', ['x']))
    expect(e.kind).toBe('model')
    expect(e.message).toContain('ollama pull bge-m3')
  })

  it("other HTTP errors carry Ollama's message", async () => {
    const { fetch } = fakeFetch(() => json({ error: 'boom' }, 500))
    const e = await rejection(createOllama('http://host', fetch).models())
    expect(e).toMatchObject({ kind: 'http', message: 'Ollama error 500: boom' })
  })

  it('chat streams chunks and returns the full text, with thinking off', async () => {
    const lines = [
      { message: { role: 'assistant', content: 'Key' } },
      { message: { role: 'assistant', content: ' points' } },
      { message: { role: 'assistant', content: '' }, done: true }
    ]
    const { fetch, calls } = fakeFetch(
      () => new Response(stream(lines.map((l) => JSON.stringify(l) + '\n')))
    )
    const deltas: string[] = []
    const out = await createOllama('http://host', fetch).chat(
      'qwen3:8b',
      [{ role: 'user', content: 'Summarize' }],
      { onDelta: (d) => deltas.push(d) }
    )
    expect(out).toBe('Key points')
    expect(deltas).toEqual(['Key', ' points'])
    expect(calls[0].body).toMatchObject({ model: 'qwen3:8b', stream: true, think: false })
  })

  it('resends without think when the model does not support it', async () => {
    const { fetch, calls } = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init.body))
      if ('think' in body) return json({ error: '"llama3" does not support thinking' }, 400)
      return new Response(stream([JSON.stringify({ message: { content: 'ok' } }) + '\n']))
    })
    const out = await createOllama('http://host', fetch).chat('llama3', [])
    expect(out).toBe('ok')
    expect(calls).toHaveLength(2)
  })

  it('errors and cancellation mid-stream', async () => {
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

  it('chatTools sends tool definitions and num_ctx, returning text and tool calls', async () => {
    const lines = [
      { message: { role: 'assistant', content: 'Let me search' } },
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { index: 0, name: 'search_notes', arguments: { query: 'habits' } } },
            // Some models send arguments as a JSON string
            { function: { name: 'get_note', arguments: '{"path":"Atomic Habits"}' } },
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
      [{ role: 'user', content: 'Find' }],
      tools,
      { onDelta: (d) => deltas.push(d), numCtx: 16384, temperature: 0.2 }
    )
    expect(out).toEqual({
      content: 'Let me search',
      toolCalls: [
        { name: 'search_notes', arguments: { query: 'habits' } },
        { name: 'get_note', arguments: { path: 'Atomic Habits' } },
        { name: 'broken', arguments: {} }
      ]
    })
    expect(deltas).toEqual(['Let me search'])
    expect(calls[0].body).toMatchObject({
      tools,
      think: false,
      options: { temperature: 0.2, num_ctx: 16384 }
    })
  })

  it('sends the output limit as num_predict (not when unset); done_reason length reports truncation', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream([
            JSON.stringify({ message: { content: 'Half' } }) + '\n',
            JSON.stringify({ message: { content: '' }, done: true, done_reason: 'length' }) + '\n'
          ])
        )
    )
    let truncated = 0
    const text = await createOllama('http://host', fetch).chat(
      'qwen3:8b',
      [{ role: 'user', content: 'q' }],
      { numCtx: 4096, maxTokens: 256, onTruncated: () => truncated++ }
    )
    expect(text).toBe('Half')
    expect(truncated).toBe(1)
    expect(calls[0].body).toMatchObject({ options: { num_ctx: 4096, num_predict: 256 } })

    const { fetch: done, calls: doneCalls } = fakeFetch(
      () =>
        new Response(
          stream([JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })])
        )
    )
    await createOllama('http://host', done).chat('qwen3:8b', [{ role: 'user', content: 'q' }], {
      numCtx: 4096,
      onTruncated: () => truncated++
    })
    expect(truncated).toBe(1)
    expect(doneCalls[0].body).toMatchObject({ options: { num_ctx: 4096 } })
    expect((doneCalls[0].body as { options: object }).options).not.toHaveProperty('num_predict')
  })

  it('strips tool call id, extra and tool_call_id, which only cloud APIs use, before sending', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(stream([JSON.stringify({ message: { content: 'ok' }, done: true })]))
    )
    await createOllama('http://host', fetch).chatTools(
      'qwen3:8b',
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', extra: { x: 1 }, function: { name: 'a', arguments: {} } }]
        },
        { role: 'tool', tool_name: 'a', tool_call_id: 'c1', content: 'r' }
      ],
      []
    )
    expect((calls[0].body as { messages: unknown }).messages).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: {} } }] },
      { role: 'tool', tool_name: 'a', content: 'r' }
    ])
  })

  it('sends no tools parameter without tools; recognizes models that do not support tools', async () => {
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
