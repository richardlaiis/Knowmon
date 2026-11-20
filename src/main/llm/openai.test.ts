import { describe, expect, it } from 'vitest'
import { LlmError, type ChatMessage, type ToolDefinition } from './ollama'
import { createOpenAiCompatible, readSse, toOpenAiMessages } from './openai'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function fakeFetch(handler: Handler): {
  fetch: typeof fetch
  calls: { url: string; body: unknown; headers: Record<string, string> }[]
} {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>
    })
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
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

/** 每個物件一個 SSE 事件，最後加上 [DONE] */
const sse = (objs: unknown[]): string[] => [
  ...objs.map((o) => `data: ${JSON.stringify(o)}\n\n`),
  'data: [DONE]\n\n'
]

const delta = (d: unknown): unknown => ({ choices: [{ index: 0, delta: d }] })

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const client = (f: typeof fetch): ReturnType<typeof createOpenAiCompatible> =>
  createOpenAiCompatible({
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-test',
    label: 'OpenAI',
    fetchImpl: f
  })

async function rejection(p: Promise<unknown>): Promise<LlmError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(LlmError)
    return e as LlmError
  }
  throw new Error('expected rejection')
}

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search',
      parameters: { type: 'object', properties: { query: { type: 'string' } } }
    }
  }
]

describe('readSse', () => {
  it('事件切在任意位置、CRLF、多行 data、註解與 [DONE]', async () => {
    const out: string[] = []
    await readSse(
      stream([': keep-alive\n\nda', 'ta: {"a":1}\r\n\r', '\ndata: x\ndata: y\n\ndata: [DONE]\n\n']),
      (d) => out.push(d)
    )
    expect(out).toEqual(['{"a":1}', 'x\ny'])
  })

  it('最後沒有空行的事件也會送出；多位元組字元被切開', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"總結"}')
    const out: string[] = []
    await readSse(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes.slice(0, 13))
          c.enqueue(bytes.slice(13))
          c.close()
        }
      }),
      (d) => out.push(d)
    )
    expect(out).toEqual(['{"t":"總結"}'])
  })
})

describe('toOpenAiMessages', () => {
  it('工具呼叫轉成 OpenAI 格式：arguments 是字串、帶回 id 與 extra_content', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_a',
            extra: { google: { thought_signature: 'sig' } },
            function: { name: 'search_notes', arguments: { query: '跑步' } }
          }
        ]
      },
      { role: 'tool', tool_name: 'search_notes', tool_call_id: 'call_a', content: 'r' }
    ]
    expect(toOpenAiMessages(messages)).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'search_notes', arguments: '{"query":"跑步"}' },
            extra_content: { google: { thought_signature: 'sig' } }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_a', content: 'r' }
    ])
  })

  it('沒有 id 時依位置產生固定的 id，tool 訊息依序對應', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        tool_calls: [
          { function: { name: 'a', arguments: {} } },
          { function: { name: 'b', arguments: {} } }
        ]
      },
      { role: 'tool', tool_name: 'a', content: '1' },
      { role: 'tool', tool_name: 'b', content: '2' }
    ]
    const out = toOpenAiMessages(messages)
    expect(out[0].tool_calls?.map((c) => c.id)).toEqual(['call_0_0', 'call_0_1'])
    expect(out[0].content).toBe('x')
    expect(out.slice(1).map((m) => m.tool_call_id)).toEqual(['call_0_0', 'call_0_1'])
    // 同樣的輸入一律得到同樣的結果（prompt 快取）
    expect(toOpenAiMessages(messages)).toEqual(out)
  })
})

describe('createOpenAiCompatible', () => {
  it('chat 串流片段、帶 Bearer key 與 temperature，不帶 Ollama 專用參數', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([delta({ role: 'assistant' }), delta({ content: '重' }), delta({ content: '點' })])
          )
        )
    )
    const parts: string[] = []
    const text = await client(fetch).chat('gpt-x', [{ role: 'user', content: 'hi' }], {
      onDelta: (d) => parts.push(d),
      temperature: 0.3,
      numCtx: 8192
    })
    expect(text).toBe('重點')
    expect(parts).toEqual(['重', '點'])
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
    expect(calls[0].body).toEqual({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.3
    })
  })

  it('不接受 temperature 的模型：不帶參數重送', async () => {
    const { fetch, calls } = fakeFetch((_u, init) => {
      const body = JSON.parse(String(init.body))
      if ('temperature' in body) {
        return json(
          { error: { message: "Unsupported value: 'temperature' does not support 0.2" } },
          400
        )
      }
      return new Response(stream(sse([delta({ content: 'ok' })])))
    })
    const text = await client(fetch).chat('o-mini', [{ role: 'user', content: 'q' }], {
      temperature: 0.2
    })
    expect(text).toBe('ok')
    expect(calls).toHaveLength(2)
    expect(calls[1].body).not.toHaveProperty('temperature')
  })

  it('chatTools 送出工具定義，累積分段的參數，保留 id 與 extra_content', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([
              delta({ content: '我來找' }),
              delta({
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'search_notes', arguments: '{"que' },
                    extra_content: { google: { thought_signature: 'sig' } }
                  }
                ]
              }),
              delta({ tool_calls: [{ index: 0, function: { arguments: 'ry":"跑步"}' } }] }),
              delta({
                tool_calls: [
                  { index: 1, id: 'call_2', function: { name: 'get_note', arguments: 'not json' } }
                ]
              })
            ])
          )
        )
    )
    const res = await client(fetch).chatTools('gpt-x', [{ role: 'user', content: 'q' }], TOOLS)
    expect(res.content).toBe('我來找')
    expect(res.toolCalls).toEqual([
      {
        name: 'search_notes',
        arguments: { query: '跑步' },
        id: 'call_1',
        extra: { google: { thought_signature: 'sig' } }
      },
      { name: 'get_note', arguments: {}, id: 'call_2' }
    ])
    expect((calls[0].body as { tools: unknown }).tools).toEqual(TOOLS)
  })

  it('沒有 index 的服務：每個工具呼叫各自一個；沒有工具時不送 tools', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([
              delta({
                tool_calls: [
                  { id: 'a', function: { name: 'x', arguments: '{"n":1}' } },
                  { id: 'b', function: { name: 'y', arguments: { n: 2 } } }
                ]
              })
            ])
          )
        )
    )
    const res = await client(fetch).chatTools('m', [{ role: 'user', content: 'q' }], [])
    expect(res.toolCalls.map((c) => [c.name, c.arguments])).toEqual([
      ['x', { n: 1 }],
      ['y', { n: 2 }]
    ])
    expect(calls[0].body).not.toHaveProperty('tools')
  })

  it('HTTP 錯誤依狀態碼分類，帶上服務商的訊息（含 Gemini 的陣列格式）', async () => {
    const at = (status: number, body: unknown): typeof fetch =>
      fakeFetch(() => json(body, status)).fetch
    const msgs: ChatMessage[] = [{ role: 'user', content: 'q' }]

    const auth = await rejection(
      client(at(401, { error: { message: 'Incorrect API key' } })).chat('m', msgs)
    )
    expect(auth.kind).toBe('auth')
    expect(auth.message).toBe('OpenAI rejected the API key (401): Incorrect API key')
    expect(auth.message).not.toContain('sk-test')

    const rate = await rejection(
      client(at(429, [{ error: { message: 'Quota exceeded' } }])).chat('m', msgs)
    )
    expect(rate.kind).toBe('rate')
    expect(rate.message).toContain('Quota exceeded')

    const model = await rejection(
      client(at(404, { error: { message: 'nope' } })).chat('gpt-z', msgs)
    )
    expect(model.kind).toBe('model')
    expect(model.message).toContain('Model "gpt-z" is not available from OpenAI')

    const other = await rejection(client(at(500, 'boom')).chat('m', msgs))
    expect(other).toMatchObject({ kind: 'http' })
    expect(other.message).toContain('OpenAI error 500')
  })

  it('串流中的錯誤、連不上、取消', async () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'q' }]
    const mid = await rejection(
      client(
        fakeFetch(
          () =>
            new Response(
              stream([`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`])
            )
        ).fetch
      ).chat('m', msgs)
    )
    expect(mid).toMatchObject({ kind: 'http', message: 'OpenAI error: overloaded' })

    const offline = await rejection(
      client(
        fakeFetch(() => {
          throw new TypeError('fetch failed')
        }).fetch
      ).chat('m', msgs)
    )
    expect(offline.kind).toBe('offline')
    expect(offline.message).toContain('api.example.com')

    const ac = new AbortController()
    ac.abort()
    const aborted = await rejection(
      client(fakeFetch(() => json({})).fetch).chat('m', msgs, { signal: ac.signal })
    )
    expect(aborted.kind).toBe('aborted')
  })

  it('models：去掉 Gemini 的 models/ 前綴、過濾非對話模型、排序去重', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: [
          { id: 'models/gemini-2.5-flash' },
          { id: 'gpt-4.1' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'tts-1' },
          { id: 'dall-e-3' },
          { id: 'gpt-4.1' },
          { id: 42 }
        ]
      })
    )
    expect(await client(fetch).models()).toEqual(['gemini-2.5-flash', 'gpt-4.1'])
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
  })
})
