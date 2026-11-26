// A fake Ollama for tests: embeddings are fixed vectors derived from the characters (more similar characters give more similar vectors)
import {
  OllamaError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type OllamaClient,
  type ToolDefinition
} from './ollama'

export const FAKE_DIM = 32

export function fakeVector(text: string): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0)
  for (const ch of text) v[ch.codePointAt(0)! % FAKE_DIM] += 1
  return v
}

export interface FakeOllama extends OllamaClient {
  online: boolean
  installed: string[]
  embedCalls: string[][]
  chatCalls: ChatMessage[][]
  /** numCtx received by each chat and chatTools call (in call order) */
  numCtx: (number | undefined)[]
  /** maxTokens received by each chat and chatTools call (in call order) */
  maxTokens: (number | undefined)[]
  /** Whether call n (from 0, counting chat and chatTools together) reports being cut off by the output limit */
  truncate: (n: number) => boolean
  /** chat replies (in call order); the last one repeats once they run out */
  replies: string[]
  /** chatTools replies (in call order); the last one repeats once they run out; when empty, the text from replies is returned */
  toolReplies: ChatResult[]
  /** The tool list each chatTools call received */
  toolsOffered: (readonly ToolDefinition[])[]
  /** Makes embed wait here until release() is called */
  hold(): void
  release(): void
}

export function fakeOllama(): FakeOllama {
  let gate: { promise: Promise<void>; resolve: () => void } | null = null
  const offline = (): OllamaError =>
    new OllamaError('Cannot connect to Ollama. Make sure it is running (ollama serve).', 'offline')
  const fake: FakeOllama = {
    online: true,
    installed: ['bge-m3:latest', 'qwen3:8b'],
    embedCalls: [],
    chatCalls: [],
    numCtx: [],
    maxTokens: [],
    truncate: () => false,
    replies: ['- 重點'],
    toolReplies: [],
    toolsOffered: [],
    hold() {
      let resolve!: () => void
      const promise = new Promise<void>((r) => (resolve = r))
      gate = { promise, resolve }
    },
    release() {
      gate?.resolve()
      gate = null
    },
    async version() {
      if (!fake.online) throw offline()
      return '0.35.1'
    },
    async models() {
      if (!fake.online) throw offline()
      return [...fake.installed]
    },
    async embed(_model, input, signal) {
      fake.embedCalls.push(input)
      if (gate) {
        // Like a real fetch, don't wait for the response when cancelled
        const aborted = new Promise<void>((r) => signal?.addEventListener('abort', () => r()))
        await Promise.race([gate.promise, aborted])
      }
      if (signal?.aborted) throw new OllamaError('Cancelled', 'aborted')
      if (!fake.online) throw offline()
      return input.map(fakeVector)
    },
    async chat(_model, messages, opts = {}) {
      if (!fake.online) throw offline()
      fake.chatCalls.push(messages)
      const call = record(opts)
      const reply = fake.replies[Math.min(fake.chatCalls.length - 1, fake.replies.length - 1)]
      for (const ch of reply) {
        if (opts.signal?.aborted) throw new OllamaError('Cancelled', 'aborted')
        opts.onDelta?.(ch)
        await Promise.resolve()
      }
      if (fake.truncate(call)) opts.onTruncated?.()
      return reply
    },
    async chatTools(_model, messages, tools, opts = {}) {
      if (!fake.online) throw offline()
      fake.toolsOffered.push(tools)
      const call = record(opts)
      const n = fake.toolsOffered.length - 1
      const reply = fake.toolReplies.length
        ? fake.toolReplies[Math.min(n, fake.toolReplies.length - 1)]
        : { content: '', toolCalls: [] }
      // Copy it: the loop modifies messages
      fake.chatCalls.push(messages.map((m) => ({ ...m })))
      for (const ch of reply.content) {
        if (opts.signal?.aborted) throw new OllamaError('Cancelled', 'aborted')
        opts.onDelta?.(ch)
        await Promise.resolve()
      }
      if (fake.truncate(call)) opts.onTruncated?.()
      return reply
    }
  }
  /** Records the parameters and returns which call this is (from 0) */
  function record(opts: ChatOptions): number {
    fake.maxTokens.push(opts.maxTokens)
    return fake.numCtx.push(opts.numCtx) - 1
  }
  return fake
}
