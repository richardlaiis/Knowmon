// LlmService integrated with Vault: connection status, background embedding, semantic edges, retrieval, summaries, Q&A (with a fake Ollama)
// The sample notes are Chinese on purpose: summaries default to zh-TW, Chinese questions exercise keyword extraction and
// time phrases (上個月), and the fake embeddings are character-based, so the semantic tests rely on shared CJK characters.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_LIMITS, DEFAULT_LLM_SETTINGS } from '../../shared/llm'
import type {
  AgentChunk,
  AnswerChunk,
  LlmSettings,
  LlmStatus,
  SummaryChunk
} from '../../shared/types'
import { Vault } from '../vault'
import { TRUNCATED_NOTICE } from './ask'
import { LlmError, OllamaError } from './ollama'
import { memoryKeyStore } from './secrets'
import { LlmService, type LlmServiceOptions } from './service'
import { fakeOllama, type FakeOllama } from './test-utils'

let root: string
let vault: Vault | null = null
let service: LlmService | null = null
let ollama: FakeOllama
let saved: LlmSettings | null
let statuses: LlmStatus[]
let chunks: SummaryChunk[]
let answers: AnswerChunk[]
let agentChunks: AgentChunk[]

function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), content)
}

async function start(extra: Partial<LlmServiceOptions> = {}): Promise<{ v: Vault; s: LlmService }> {
  vault = await Vault.open(root)
  service = new LlmService({
    loadSettings: () => saved,
    saveSettings: (s) => (saved = s),
    onStatus: (s) => statuses.push(s),
    onSummary: (c) => chunks.push(c),
    onAnswer: (c) => answers.push(c),
    onAgent: (c) => agentChunks.push(c),
    createClient: () => ollama,
    retryMs: 20,
    now: () => new Date(2026, 9, 14, 12).getTime(),
    ...extra
  })
  await service.attach(vault)
  return { v: vault, s: service }
}

/** Waits until a condition holds (for background work) */
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const idle = (s: LlmService): (() => boolean) => {
  return () => {
    const st = s.status()
    return !st.busy && st.embedded === st.total
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-llm-'))
  ollama = fakeOllama()
  saved = null
  statuses = []
  chunks = []
  answers = []
  agentChunks = []
  write('跑步.md', '# 跑步\n\n早上跑步五公里。')
  write('慢跑.md', '早上慢跑五公里。')
  write('料理.md', '晚餐煮了番茄炒蛋。')
  write('空白.md', '')
})

afterEach(async () => {
  await service?.dispose()
  await vault?.close()
  service = null
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('LlmService', () => {
  it('embeds every note with content in the background after opening a vault, pushing progress', async () => {
    const { s } = await start()
    await until(idle(s))
    expect(s.status()).toMatchObject({
      online: true,
      error: null,
      embedded: 3,
      total: 3,
      busy: false,
      settings: DEFAULT_LLM_SETTINGS
    })
    expect(statuses.some((st) => st.busy)).toBe(true)
    expect(statuses.at(-1)).toMatchObject({ embedded: 3, busy: false })
  })

  it('re-embeds after a note changes, and semantic edges join the graph', async () => {
    const { v, s } = await start()
    await until(idle(s))
    await v.setSemanticSettings({ semanticThreshold: 0.6 }) // fake vectors have different similarities from bge-m3
    const semantic = async (): Promise<string[]> =>
      (await v.graph()).edges
        .filter((e) => e.type === 'semantic')
        .map((e) => `${e.source}–${e.target}`)
    expect(await semantic()).toContain('慢跑.md–跑步.md')

    const before = ollama.embedCalls.length
    await v.write('料理.md', '早上跑步五公里後吃早餐。')
    await until(() => ollama.embedCalls.length > before && idle(s)())
    expect(await semantic()).toContain('料理.md–跑步.md')
  })

  it('shows offline when Ollama is not running while everything else works; retries automatically and continues after recovery', async () => {
    ollama.online = false
    const { v, s } = await start()
    expect(s.status()).toMatchObject({ online: false, embedded: 0, total: 3 })
    expect(s.status().error).toContain('ollama serve')
    // Retrieval falls back to full text
    const r = await s.retrieve('跑步')
    expect(r.vector).toBe(false)
    expect(r.hits.map((h) => h.path)).toContain('跑步.md')
    expect((await v.graph()).nodes).toHaveLength(4)

    ollama.online = true
    await until(() => s.status().online && idle(s)())
    expect(s.status()).toMatchObject({ error: null, embedded: 3 })
  })

  it('suggests ollama pull when the model is not downloaded, without embedding', async () => {
    ollama.installed = ['qwen3:8b']
    const { s } = await start()
    expect(s.status()).toMatchObject({ online: true, embedded: 0 })
    expect(s.status().error).toContain('ollama pull bge-m3')
    expect(ollama.embedCalls).toEqual([])
  })

  it('hybrid retrieval uses vectors', async () => {
    const { s } = await start()
    await until(idle(s))
    const r = await s.retrieve('番茄蛋')
    expect(r.vector).toBe(true)
    expect(r.hits[0]).toMatchObject({ path: '料理.md' })
    expect(r.hits[0].via).toContain('vector')
  })

  it('settings are saved; changing the embedding model recomputes everything', async () => {
    ollama.installed.push('nomic-embed-text:latest')
    const { s } = await start()
    await until(idle(s))
    const calls = ollama.embedCalls.length
    const st = await s.setSettings({ embedModel: 'nomic-embed-text', baseUrl: 'ftp://bad' })
    expect(st.settings).toEqual({ ...DEFAULT_LLM_SETTINGS, embedModel: 'nomic-embed-text' })
    expect(saved).toEqual(st.settings)
    await until(() => ollama.embedCalls.length > calls && idle(s)())
    expect(s.status().embedded).toBe(3)
  })

  it('summarizing a note streams chunks, then sends done', async () => {
    ollama.replies = ['- 跑了五公里']
    const { s } = await start()
    const id = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    const mine = chunks.filter((c) => c.id === id)
    expect(mine.map((c) => c.delta).join('')).toBe('- 跑了五公里')
    expect(mine.at(-1)).toEqual({ id, delta: '', done: true })
    expect(ollama.chatCalls[0][1].content).toContain('早上跑步五公里')
  })

  it('summarizing a selection sends only the selected part', async () => {
    const { s } = await start()
    const id = s.summarize({ path: '跑步.md', selection: '只有這段' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    const prompt = ollama.chatCalls[0][1].content
    expect(prompt).toContain('只有這段')
    expect(prompt).not.toContain('五公里')
  })

  it('picks the prompt by the requested language, Traditional Chinese by default', async () => {
    const { s } = await start()
    const zh = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === zh && c.done))
    const en = s.summarize({ path: '跑步.md', language: 'en' })
    await until(() => chunks.some((c) => c.id === en && c.done))
    expect(ollama.chatCalls[0][0].content).toContain('繁體中文')
    expect(ollama.chatCalls[1][0].content).toContain('in English')
    expect(ollama.chatCalls[1][1].content).toContain('早上跑步五公里')
  })

  it('empty notes, offline and cancellation all finish with a reason', async () => {
    ollama.replies = ['很長的回覆'.repeat(50)]
    const { s } = await start()
    const empty = s.summarize({ path: '空白.md' })
    await until(() => chunks.some((c) => c.id === empty && c.done))
    expect(chunks.find((c) => c.id === empty && c.done)?.error).toContain('empty')

    const cancelled = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === cancelled && !c.done))
    s.cancel(cancelled)
    await until(() => chunks.some((c) => c.id === cancelled && c.done))
    expect(chunks.find((c) => c.id === cancelled && c.done)?.error).toBeUndefined()

    ollama.online = false
    const offline = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === offline && c.done))
    expect(chunks.find((c) => c.id === offline && c.done)?.error).toContain('ollama serve')

    expect(() => s.summarize({ path: '不存在.md' })).toThrow('not found')
  })

  describe('ask', () => {
    const answered = (id: string): (() => boolean) => {
      return () => answers.some((c) => c.id === id && c.done)
    }
    const mine = (id: string): AnswerChunk[] => answers.filter((c) => c.id === id)
    const text = (id: string): string =>
      mine(id)
        .map((c) => c.delta)
        .join('')

    it('pushes the sources first, then streams the answer, ending with the numbers actually cited', async () => {
      ollama.replies = ['早上跑步五公里 [1]，另一篇 [9] 不存在。']
      const { s } = await start()
      await until(idle(s))
      const id = s.ask({ question: '跑步 跑了多遠？' })
      await until(answered(id))
      const first = mine(id)[0]
      expect(first.sources?.[0]).toMatchObject({ n: 1, path: '跑步.md', title: '跑步' })
      expect(first).toMatchObject({ range: null, vector: true })
      expect(text(id)).toBe('早上跑步五公里 [1]，另一篇  不存在。')
      expect(mine(id).at(-1)).toEqual({ id, delta: '', done: true, cited: [1] })
      const prompt = ollama.chatCalls[0].at(-1)!.content
      expect(prompt).toContain('[1] 跑步')
      expect(prompt).toContain('早上跑步五公里')
      expect(prompt).toContain('問題：跑步 跑了多遠？')
    })

    it('parses the time range from the question; lists the notes in the range when there is only a time', async () => {
      write('日記/2026-09-03.md', '讀完一本書。')
      write('日記/2026-10-02.md', '去爬山。')
      const { s } = await start()
      await until(idle(s))
      const id = s.ask({ question: '上個月寫了什麼？' })
      await until(answered(id))
      expect(mine(id)[0].range).toEqual({ from: '2026-09-01', to: '2026-09-30' })
      expect(mine(id)[0].sources?.map((x) => x.path)).toEqual(['日記/2026-09-03.md'])
      expect(ollama.chatCalls[0].at(-1)!.content).toContain('時間範圍：2026-09-01 – 2026-09-30')

      // No filter when the user removed the range (null)
      const all = s.ask({ question: '上個月 爬山', range: null })
      await until(answered(all))
      expect(mine(all)[0].range).toBeNull()
      expect(mine(all)[0].sources?.map((x) => x.path)).toContain('日記/2026-10-02.md')
    })

    it('does not call the model when no sources are found', async () => {
      const { s } = await start()
      const id = s.ask({
        question: 'What about quantum physics?',
        range: { from: '2001-01-01', to: '2001-12-31' }
      })
      await until(answered(id))
      expect(mine(id)[0].sources).toEqual([])
      expect(text(id)).toBe('No relevant notes were found between 2001-01-01 and 2001-12-31.')
      expect(ollama.chatCalls).toHaveLength(0)
    })

    it('follow-ups include the earlier conversation; without keywords, the previous question is used for retrieval', async () => {
      const { s } = await start()
      await until(idle(s))
      const id = s.ask({
        question: '那呢？',
        history: [
          { role: 'user', content: '料理 煮了什麼' },
          { role: 'assistant', content: '番茄炒蛋 [1]' }
        ]
      })
      await until(answered(id))
      expect(mine(id)[0].sources?.[0].path).toBe('料理.md')
      const messages = ollama.chatCalls[0]
      expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
      expect(messages[2].content).toBe('番茄炒蛋')
    })

    it('cancellation, offline and blank questions', async () => {
      ollama.replies = ['很長的回答'.repeat(50)]
      const { s } = await start()
      await until(idle(s))
      const cancelled = s.ask({ question: '跑步' })
      await until(() => answers.some((c) => c.id === cancelled && c.delta))
      s.cancel(cancelled)
      await until(answered(cancelled))
      expect(mine(cancelled).at(-1)?.error).toBeUndefined()

      ollama.online = false
      const offline = s.ask({ question: '跑步' })
      await until(answered(offline))
      expect(mine(offline).at(-1)?.error).toContain('ollama serve')
      // Offline, retrieval falls back to full text and sources are still pushed
      expect(mine(offline)[0]).toMatchObject({ vector: false })
      expect(mine(offline)[0].sources?.[0].path).toBe('跑步.md')

      expect(() => s.ask({ question: '  ' })).toThrow('empty')
    })
  })

  it('summaries, Q&A and the agent all send the same num_ctx (Ollama reloads the model when it differs)', async () => {
    ollama.toolReplies = [
      { content: '', toolCalls: [{ name: 'search_notes', arguments: { query: '跑步' } }] },
      { content: '五公里。', toolCalls: [] }
    ]
    const { s } = await start()
    await until(idle(s))
    const sum = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === sum && c.done))
    const ask = s.ask({ question: '跑步 跑了多遠？' })
    await until(() => answers.some((c) => c.id === ask && c.done))
    const task = s.agent({ task: '我跑了多遠？' })
    await until(() => agentChunks.some((c) => c.id === task && c.done))
    expect(ollama.numCtx).toHaveLength(4)
    expect(ollama.numCtx.every((n) => n === DEFAULT_CHAT_LIMITS.contextTokens)).toBe(true)
  })

  describe('context length and max output', () => {
    const text = (list: { id: string; delta: string }[], id: string): string =>
      list
        .filter((c) => c.id === id)
        .map((c) => c.delta)
        .join('')

    it('the configured context and output limit go to summaries, Q&A and the agent (still identical across them)', async () => {
      saved = {
        ...DEFAULT_LLM_SETTINGS,
        ollamaLimits: { contextTokens: 16384, maxOutputTokens: 500 }
      }
      const { s } = await start()
      await until(idle(s))
      const sum = s.summarize({ path: '跑步.md' })
      await until(() => chunks.some((c) => c.id === sum && c.done))
      const ask = s.ask({ question: '跑步 跑了多遠？' })
      await until(() => answers.some((c) => c.id === ask && c.done))
      const task = s.agent({ task: '我跑了多遠？' })
      await until(() => agentChunks.some((c) => c.id === task && c.done))
      expect(ollama.numCtx).toEqual([16384, 16384, 16384])
      expect(ollama.maxTokens).toEqual([500, 500, 500])

      // Changes take effect immediately; no output limit is sent when there is none
      await s.setSettings({ ollamaLimits: { contextTokens: 4096, maxOutputTokens: null } })
      const again = s.summarize({ path: '跑步.md' })
      await until(() => chunks.some((c) => c.id === again && c.done))
      expect(ollama.numCtx.at(-1)).toBe(4096)
      expect(ollama.maxTokens.at(-1)).toBeUndefined()
    })

    it('a smaller context shrinks the character budgets: a long note is summarized in parts', async () => {
      write(
        '長.md',
        '# 長\n\n' +
          Array.from({ length: 40 }, (_, i) => `第 ${i} 段。` + '字'.repeat(90)).join('\n\n')
      )
      saved = {
        ...DEFAULT_LLM_SETTINGS,
        ollamaLimits: { contextTokens: 2048, maxOutputTokens: null }
      }
      const { s } = await start()
      await until(idle(s))
      const id = s.summarize({ path: '長.md' })
      await until(() => chunks.some((c) => c.id === id && c.done))
      // About 4000 characters: summarized directly (one call) at 8192, split and combined at 2048 (3000-character limit, 1500 per part)
      expect(ollama.chatCalls.length).toBeGreaterThan(2)
    })

    it('appends a notice when the final answer is cut off; no notice when intermediate parts of a split summary are', async () => {
      write('長.md', Array.from({ length: 40 }, () => '字'.repeat(400)).join('\n\n'))
      ollama.truncate = () => true
      const { s } = await start()
      await until(idle(s))
      const sum = s.summarize({ path: '跑步.md' })
      await until(() => chunks.some((c) => c.id === sum && c.done))
      expect(text(chunks, sum)).toBe('- 重點' + TRUNCATED_NOTICE['zh-TW'])
      const en = s.summarize({ path: '跑步.md', language: 'en' })
      await until(() => chunks.some((c) => c.id === en && c.done))
      expect(text(chunks, en)).toContain(TRUNCATED_NOTICE.en)

      const ask = s.ask({ question: '跑步 跑了多遠？' })
      await until(() => answers.some((c) => c.id === ask && c.done))
      expect(text(answers, ask).endsWith(TRUNCATED_NOTICE['zh-TW'])).toBe(true)

      // Only the last (combine) call counts
      const first = ollama.numCtx.length
      ollama.truncate = (n) => n === first
      const long = s.summarize({ path: '長.md' })
      await until(() => chunks.some((c) => c.id === long && c.done))
      expect(ollama.numCtx.length - first).toBeGreaterThan(2)
      expect(text(chunks, long)).not.toContain(TRUNCATED_NOTICE['zh-TW'].trim())
    })

    it('agent: a notice only when the final answer is cut off', async () => {
      ollama.toolReplies = [
        { content: '', toolCalls: [{ name: 'search_notes', arguments: { query: '跑步' } }] },
        { content: '五公里。', toolCalls: [] }
      ]
      const { s } = await start()
      await until(idle(s))
      ollama.truncate = (n) => n === 0
      const a = s.agent({ task: '我跑了多遠？' })
      await until(() => agentChunks.some((c) => c.id === a && c.done))
      expect(text(agentChunks, a)).toBe('五公里。')

      // Once the tool replies run out the last one repeats (a direct answer), so there's only one call this time
      const base = ollama.numCtx.length
      ollama.truncate = (n) => n === base
      const b = s.agent({ task: '我跑了多遠？' })
      await until(() => agentChunks.some((c) => c.id === b && c.done))
      expect(text(agentChunks, b)).toBe('五公里。' + TRUNCATED_NOTICE['zh-TW'])
    })
  })

  describe('agent', () => {
    const mine = (id: string): AgentChunk[] => agentChunks.filter((c) => c.id === id)
    const finished = (id: string) => (): boolean => mine(id).some((c) => c.done)
    const waiting = (id: string) => (): boolean =>
      mine(id).some((c) => c.step?.status === 'confirm')
    const create = {
      content: '',
      toolCalls: [{ name: 'create_note', arguments: { path: '整理.md', content: '見 [[跑步]]' } }]
    }

    it('runs tools and pushes steps and text, sending done at the end', async () => {
      ollama.toolReplies = [
        { content: '', toolCalls: [{ name: 'search_notes', arguments: { query: '跑步' } }] },
        { content: '[[跑步]] 是早上跑五公里。', toolCalls: [] }
      ]
      const { s } = await start()
      await until(idle(s))
      const id = s.agent({ task: '我跑了多遠？' })
      await until(finished(id))
      const steps = mine(id).flatMap((c) => (c.step ? [c.step] : []))
      expect(steps.map((x) => x.status)).toEqual(['running', 'done'])
      expect(steps[1].notes.map((n) => n.path)).toContain('跑步.md')
      expect(
        mine(id)
          .map((c) => c.delta)
          .join('')
      ).toBe('[[跑步]] 是早上跑五公里。')
      expect(mine(id).at(-1)).toMatchObject({ done: true })
      expect(mine(id).at(-1)?.error).toBeUndefined()
      // The system prompt includes today's date (with now injected)
      expect(ollama.chatCalls[0][0].content).toContain('2026-10-14')
    })

    it('writes wait for the user: the note is created only after Apply', async () => {
      ollama.toolReplies = [create, { content: '已建立。', toolCalls: [] }]
      const { s } = await start()
      const id = s.agent({ task: '建立整理筆記' })
      await until(waiting(id))
      expect(fs.existsSync(path.join(root, '整理.md'))).toBe(false)
      s.confirm(id, 0, { approved: true })
      await until(finished(id))
      expect(fs.readFileSync(path.join(root, '整理.md'), 'utf8')).toBe('見 [[跑步]]')
      expect(
        mine(id)
          .filter((c) => c.step)
          .at(-1)?.step?.status
      ).toBe('applied')
    })

    it('Reject and stopping write nothing; duplicate or stale confirmations are ignored', async () => {
      ollama.toolReplies = [create, { content: '好的。', toolCalls: [] }]
      const { s } = await start()
      const rejected = s.agent({ task: '建立' })
      await until(waiting(rejected))
      s.confirm(rejected, 0, { approved: false })
      s.confirm(rejected, 0, { approved: true })
      await until(finished(rejected))
      expect(fs.existsSync(path.join(root, '整理.md'))).toBe(false)

      ollama.toolsOffered = []
      const stopped = s.agent({ task: '建立' })
      await until(waiting(stopped))
      s.cancel(stopped)
      await until(finished(stopped))
      s.confirm(stopped, 0, { approved: true })
      expect(mine(stopped).at(-1)?.error).toBeUndefined()
      expect(fs.existsSync(path.join(root, '整理.md'))).toBe(false)
    })

    it('offline, models without tool support, and blank tasks', async () => {
      const { s } = await start()
      ollama.online = false
      const offline = s.agent({ task: '跑步' })
      await until(finished(offline))
      expect(mine(offline).at(-1)?.error).toContain('ollama serve')

      ollama.online = true
      ollama.chatTools = async () => {
        throw new OllamaError('Ollama error 400: qwen2:0.5b does not support tools', 'http')
      }
      const noTools = s.agent({ task: '跑步' })
      await until(finished(noTools))
      expect(mine(noTools).at(-1)?.error).toContain('does not support tool calling')

      expect(() => s.agent({ task: ' ' })).toThrow('empty')
    })
  })

  it('stops the old embedding when switching vaults', async () => {
    ollama.hold()
    const { v, s } = await start()
    await until(() => s.status().busy)
    await s.attach(null)
    ollama.release()
    expect(s.status()).toMatchObject({ busy: false, embedded: 0, total: 0 })
    await v.close()
    vault = null
  })
})

describe('cloud chat providers', () => {
  let cloud: FakeOllama
  /** The error thrown by models() (simulating a bad key or an unreachable provider) */
  let cloudFail: LlmError | null
  let made: { provider: string; baseUrl: string; apiKey: string }[]
  let modelCalls: number

  beforeEach(() => {
    cloud = fakeOllama()
    cloud.installed = ['gpt-x', 'gpt-y']
    cloud.replies = ['- 雲端重點']
    cloudFail = null
    made = []
    modelCalls = 0
  })

  const startCloud = (
    settings: Partial<LlmSettings> = { provider: 'openai', cloudModels: { openai: 'gpt-x' } },
    keys: Record<string, string> = { openai: 'sk-secret' }
  ): Promise<{ v: Vault; s: LlmService }> => {
    saved = { ...DEFAULT_LLM_SETTINGS, ...settings }
    return start({
      keys: memoryKeyStore(keys),
      createCloudClient: (o) => {
        made.push(o)
        return {
          ...cloud,
          models: async () => {
            modelCalls++
            if (cloudFail) throw cloudFail
            return cloud.models()
          }
        }
      }
    })
  }

  it('cloud chat works while Ollama is offline; embeddings only show a notice and retrieval falls back to full text', async () => {
    ollama.online = false
    const { s } = await startCloud()
    expect(s.status()).toMatchObject({
      online: true,
      ollamaOnline: false,
      error: null,
      cloudModels: ['gpt-x', 'gpt-y'],
      apiKeys: { openai: true, gemini: false, custom: false },
      embedded: 0
    })
    expect(s.status().embedError).toContain('Ollama is offline')
    expect(made).toEqual([
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret' }
    ])
    expect(JSON.stringify(s.status())).not.toContain('sk-secret')

    const id = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    expect(
      chunks
        .filter((c) => c.id === id)
        .map((c) => c.delta)
        .join('')
    ).toBe('- 雲端重點')
    // The cloud doesn't get Ollama's num_ctx
    expect(cloud.numCtx).toEqual([undefined])
    expect(ollama.chatCalls).toHaveLength(0)
    expect((await s.retrieve('跑步')).vector).toBe(false)
  })

  it('in cloud mode embeddings still use Ollama, which only needs the embedding model', async () => {
    ollama.installed = ['bge-m3:latest']
    const { s } = await startCloud()
    await until(idle(s))
    expect(s.status()).toMatchObject({ online: true, error: null, embedError: null, embedded: 3 })
    expect(ollama.embedCalls.length).toBeGreaterThan(0)
    expect(cloud.embedCalls).toHaveLength(0)
  })

  it('asks for a key when there is none; works after setApiKey, and the key never appears in the status', async () => {
    const { s } = await startCloud(undefined, {})
    expect(s.status()).toMatchObject({ online: false, apiKeys: { openai: false } })
    expect(s.status().error).toBe('Add an API key for OpenAI in AI settings.')
    expect(() => s.summarize({ path: '跑步.md' })).toThrow('Add an API key')
    expect(modelCalls).toBe(0)

    const st = await s.setApiKey('openai', ' sk-new ')
    expect(st).toMatchObject({ online: true, error: null, apiKeys: { openai: true } })
    expect(made.at(-1)?.apiKey).toBe('sk-new')
    expect(JSON.stringify(st)).not.toContain('sk-new')

    await s.setApiKey('openai', null)
    expect(s.status()).toMatchObject({ online: false, apiKeys: { openai: false } })
  })

  it("setApiKey rejects unknown providers and keys that are too long or contain spaces; other providers' keys don't affect the current connection", async () => {
    const { s } = await startCloud()
    await expect(s.setApiKey('claude' as never, 'x')).rejects.toThrow('Unknown provider')
    await expect(s.setApiKey('openai', 'x'.repeat(501))).rejects.toThrow('too long')
    await expect(s.setApiKey('openai', 'sk a')).rejects.toThrow('invalid characters')
    const before = made.length
    expect((await s.setApiKey('gemini', 'AIza')).apiKeys).toEqual({
      openai: true,
      gemini: true,
      custom: false
    })
    expect(made.length).toBe(before)
  })

  it('no model chosen yet: lists models for the user to pick, and chat is unavailable', async () => {
    const { s } = await startCloud({ provider: 'gemini' }, { gemini: 'AIza' })
    expect(s.status()).toMatchObject({ online: false, cloudModels: ['gpt-x', 'gpt-y'] })
    expect(s.status().error).toBe('Choose a Google Gemini model in AI settings.')
    expect(made[0].baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')

    await s.setSettings({ cloudModels: { gemini: 'gpt-y' } })
    expect(s.status()).toMatchObject({ online: true, error: null })
  })

  it('a bad key is not retried; an unreachable provider is retried until it recovers', async () => {
    cloudFail = new LlmError('OpenAI rejected the API key (401)', 'auth')
    const { s } = await startCloud()
    expect(s.status()).toMatchObject({ online: false, error: 'OpenAI rejected the API key (401)' })
    const calls = modelCalls
    await new Promise((r) => setTimeout(r, 80))
    expect(modelCalls).toBe(calls)

    cloudFail = new LlmError('Cannot connect to api.openai.com.', 'offline')
    await s.retry()
    expect(s.status().online).toBe(false)
    cloudFail = null
    await until(() => s.status().online)
    expect(s.status().error).toBeNull()
  })

  it('a provider without /models (another HTTP error) can still chat, just without a model list', async () => {
    cloudFail = new LlmError('Custom API error 404', 'http')
    const { s } = await startCloud(
      {
        provider: 'custom',
        customBaseUrl: 'http://localhost:1234/v1',
        cloudModels: { custom: 'm' }
      },
      { custom: 'k' }
    )
    expect(s.status()).toMatchObject({ online: true, error: null, cloudModels: [] })
    expect(made[0].baseUrl).toBe('http://localhost:1234/v1')
  })

  it('asks for the address when custom has none', async () => {
    const { s } = await startCloud(
      { provider: 'custom', cloudModels: { custom: 'm' } },
      { custom: 'k' }
    )
    expect(s.status().error).toBe('Enter the API address of the custom provider in AI settings.')
  })

  it('switching providers rebuilds the client; switching back to Ollama uses Ollama with num_ctx', async () => {
    const { s } = await startCloud()
    await s.setApiKey('gemini', 'AIza')
    await s.setSettings({ provider: 'gemini', cloudModels: { openai: 'gpt-x', gemini: 'gpt-y' } })
    expect(made.at(-1)).toMatchObject({ provider: 'gemini', apiKey: 'AIza' })
    expect(saved?.provider).toBe('gemini')

    await s.setSettings({ provider: 'ollama' })
    expect(s.status()).toMatchObject({ online: true, cloudModels: [], embedError: null })
    const id = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    expect(ollama.numCtx).toEqual([DEFAULT_CHAT_LIMITS.contextTokens])
  })

  it('the cloud uses its own pair: sends the output limit but no num_ctx', async () => {
    const { s } = await startCloud({
      provider: 'openai',
      cloudModels: { openai: 'gpt-x' },
      ollamaLimits: { contextTokens: 4096, maxOutputTokens: 256 },
      cloudLimits: { contextTokens: 131072, maxOutputTokens: 2000 }
    })
    const id = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    expect(cloud.numCtx).toEqual([undefined])
    expect(cloud.maxTokens).toEqual([2000])

    await s.setSettings({ provider: 'ollama' })
    const again = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === again && c.done))
    expect(ollama.numCtx).toEqual([4096])
    expect(ollama.maxTokens).toEqual([256])
  })

  it("the agent uses the cloud model's tool calls; the tool call id goes back in the next step", async () => {
    cloud.toolReplies = [
      {
        content: '',
        toolCalls: [{ name: 'search_notes', arguments: { query: '跑步' }, id: 'call_9' }]
      },
      { content: '跑了五公里。', toolCalls: [] }
    ]
    const { s } = await startCloud()
    const id = s.agent({ task: '我跑了多遠？' })
    await until(() => agentChunks.some((c) => c.id === id && c.done))
    expect(agentChunks.filter((c) => c.id === id).at(-1)).toEqual({ id, delta: '', done: true })
    const second = cloud.chatCalls[1]
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_9' })
    expect(ollama.toolsOffered).toHaveLength(0)
  })

  it('gives a clear message when a cloud model does not support tools', async () => {
    cloud.chatTools = async () => {
      throw new LlmError('OpenAI error 400: tools are not supported for this model', 'http')
    }
    const { s } = await startCloud()
    const id = s.agent({ task: '找筆記' })
    await until(() => agentChunks.some((c) => c.id === id && c.done))
    expect(agentChunks.filter((c) => c.id === id).at(-1)?.error).toBe(
      'The chat model gpt-x does not support tool calling. Choose a model with tool support in Settings.'
    )
  })
})
