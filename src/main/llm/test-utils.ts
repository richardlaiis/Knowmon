// 測試用的假 Ollama：embedding 依字元產生固定向量（字元越相近，向量越相似）
import {
  OllamaError,
  type ChatMessage,
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
  /** chat 的回覆（依呼叫次序），用完後重複最後一個 */
  replies: string[]
  /** chatTools 的回覆（依呼叫次序），用完後重複最後一個；沒有時回傳 replies 的文字 */
  toolReplies: ChatResult[]
  /** chatTools 每次收到的工具清單 */
  toolsOffered: (readonly ToolDefinition[])[]
  /** 讓 embed 停在這裡，直到呼叫 release() */
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
        // 和真的 fetch 一樣，取消時不等回應
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
      const reply = fake.replies[Math.min(fake.chatCalls.length - 1, fake.replies.length - 1)]
      for (const ch of reply) {
        if (opts.signal?.aborted) throw new OllamaError('Cancelled', 'aborted')
        opts.onDelta?.(ch)
        await Promise.resolve()
      }
      return reply
    },
    async chatTools(_model, messages, tools, opts = {}) {
      if (!fake.online) throw offline()
      fake.toolsOffered.push(tools)
      const n = fake.toolsOffered.length - 1
      const reply = fake.toolReplies.length
        ? fake.toolReplies[Math.min(n, fake.toolReplies.length - 1)]
        : { content: '', toolCalls: [] }
      // 複製一份：迴圈會修改 messages
      fake.chatCalls.push(messages.map((m) => ({ ...m })))
      for (const ch of reply.content) {
        if (opts.signal?.aborted) throw new OllamaError('Cancelled', 'aborted')
        opts.onDelta?.(ch)
        await Promise.resolve()
      }
      return reply
    }
  }
  return fake
}
