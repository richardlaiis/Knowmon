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

/** One SSE event per object, followed by [DONE] */
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
  it('events split anywhere, CRLF, multi-line data, comments and [DONE]', async () => {
    const out: string[] = []
    await readSse(
      stream([': keep-alive\n\nda', 'ta: {"a":1}\r\n\r', '\ndata: x\ndata: y\n\ndata: [DONE]\n\n']),
      (d) => out.push(d)
    )
    expect(out).toEqual(['{"a":1}', 'x\ny'])
  })

  it('sends an event with no trailing blank line; handles split multi-byte characters', async () => {
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
  it('converts tool calls to the OpenAI format: arguments as a string, with id and extra_content sent back', () => {
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
            function: { name: 'search_notes', arguments: { query: 'running' } }
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
            function: { name: 'search_notes', arguments: '{"query":"running"}' },
            extra_content: { google: { thought_signature: 'sig' } }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_a', content: 'r' }
    ])
  })

  it('without ids, generates stable ids by position, matched by tool messages in order', () => {
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
    // The same input always gives the same result (prompt cache)
    expect(toOpenAiMessages(messages)).toEqual(out)
  })
})

describe('createOpenAiCompatible', () => {
  it('chat streams chunks with a Bearer key and temperature, without Ollama-only parameters', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([
              delta({ role: 'assistant' }),
              delta({ content: 'Key' }),
              delta({ content: ' points' })
            ])
          )
        )
    )
    const parts: string[] = []
    const text = await client(fetch).chat('gpt-x', [{ role: 'user', content: 'hi' }], {
      onDelta: (d) => parts.push(d),
      temperature: 0.3,
      numCtx: 8192
    })
    expect(text).toBe('Key points')
    expect(parts).toEqual(['Key', ' points'])
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
    expect(calls[0].body).toEqual({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.3
    })
  })

  it('models that reject temperature: resend without it', async () => {
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

  it('output limit: max_tokens by default, max_completion_tokens for OpenAI; nothing when unset', async () => {
    const ok = (): Response => new Response(stream(sse([delta({ content: 'ok' })])))
    const { fetch, calls } = fakeFetch(ok)
    await client(fetch).chat('m', [{ role: 'user', content: 'q' }], { maxTokens: 500 })
    await client(fetch).chat('m', [{ role: 'user', content: 'q' }])
    const openai = createOpenAiCompatible({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      label: 'OpenAI',
      maxTokensParam: 'max_completion_tokens',
      fetchImpl: fetch
    })
    await openai.chat('gpt-x', [{ role: 'user', content: 'q' }], { maxTokens: 700 })
    expect(calls.map((c) => c.body)).toMatchObject([
      { max_tokens: 500 },
      {},
      { max_completion_tokens: 700 }
    ])
    expect(calls[0].body).not.toHaveProperty('max_completion_tokens')
    expect(calls[1].body).not.toHaveProperty('max_tokens')
    expect(calls[2].body).not.toHaveProperty('max_tokens')
  })

  it('resends with the other name when a parameter name is rejected; works together with the temperature resend', async () => {
    const { fetch, calls } = fakeFetch((_u, init) => {
      const body = JSON.parse(String(init.body))
      if ('max_tokens' in body) {
        return json(
          {
            error: {
              message:
                "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
            }
          },
          400
        )
      }
      if ('temperature' in body) {
        return json({ error: { message: "Unsupported value: 'temperature'" } }, 400)
      }
      return new Response(stream(sse([delta({ content: 'ok' })])))
    })
    const text = await client(fetch).chat('o-mini', [{ role: 'user', content: 'q' }], {
      temperature: 0.2,
      maxTokens: 300
    })
    expect(text).toBe('ok')
    expect(calls).toHaveLength(3)
    expect(calls[2].body).toMatchObject({ max_completion_tokens: 300 })
    expect(calls[2].body).not.toHaveProperty('temperature')
  })

  it('both names rejected (for example the value exceeds the model limit): reports the first error without resending forever', async () => {
    const { fetch, calls } = fakeFetch((_u, init) => {
      const body = JSON.parse(String(init.body))
      const name = 'max_tokens' in body ? 'max_tokens' : 'max_completion_tokens'
      return json({ error: { message: `${name} is too large: 999999` } }, 400)
    })
    const e = await rejection(
      client(fetch).chat('m', [{ role: 'user', content: 'q' }], { maxTokens: 999999 })
    )
    expect(e.message).toContain('max_tokens is too large')
    expect(calls).toHaveLength(2)
  })

  it("reports truncation when finish_reason is 'length'", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([
              delta({ content: 'Half' }),
              { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }
            ])
          )
        )
    )
    let truncated = 0
    await client(fetch).chat('m', [{ role: 'user', content: 'q' }], {
      maxTokens: 256,
      onTruncated: () => truncated++
    })
    expect(truncated).toBe(1)

    const { fetch: done } = fakeFetch(
      () =>
        new Response(
          stream(sse([{ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }] }]))
        )
    )
    await client(done).chat('m', [{ role: 'user', content: 'q' }], {
      onTruncated: () => truncated++
    })
    expect(truncated).toBe(1)
  })

  it('chatTools sends tool definitions, accumulates split arguments, and keeps id and extra_content', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          stream(
            sse([
              delta({ content: 'Let me look' }),
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
              delta({ tool_calls: [{ index: 0, function: { arguments: 'ry":"running"}' } }] }),
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
    expect(res.content).toBe('Let me look')
    expect(res.toolCalls).toEqual([
      {
        name: 'search_notes',
        arguments: { query: 'running' },
        id: 'call_1',
        extra: { google: { thought_signature: 'sig' } }
      },
      { name: 'get_note', arguments: {}, id: 'call_2' }
    ])
    expect((calls[0].body as { tools: unknown }).tools).toEqual(TOOLS)
  })

  it('providers without index: one call each; no tools parameter without tools', async () => {
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

  it("classifies HTTP errors by status code with the provider's message (including Gemini's array format)", async () => {
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

  it('errors mid-stream, unreachable, cancelled', async () => {
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

  it("models: strips Gemini's models/ prefix, filters out non-chat models, sorts and dedupes", async () => {
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
