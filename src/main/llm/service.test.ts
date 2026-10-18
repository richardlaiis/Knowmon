// LlmService 與 Vault 的整合：連線狀態、背景 embedding、semantic 邊、檢索、總結、問答（Ollama 用假的）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../../shared/llm'
import type {
  AgentChunk,
  AnswerChunk,
  LlmSettings,
  LlmStatus,
  SummaryChunk
} from '../../shared/types'
import { Vault } from '../vault'
import { OllamaError } from './ollama'
import { LlmService } from './service'
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

async function start(): Promise<{ v: Vault; s: LlmService }> {
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
    now: () => new Date(2026, 9, 14, 12).getTime()
  })
  await service.attach(vault)
  return { v: vault, s: service }
}

/** 等到條件成立（背景工作） */
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
  it('開啟 vault 後背景 embedding 所有有內容的筆記，並推送進度', async () => {
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

  it('筆記修改後重新 embedding，semantic 邊加入圖譜', async () => {
    const { v, s } = await start()
    await until(idle(s))
    await v.setSemanticSettings({ semanticThreshold: 0.6 }) // 假向量的相似度與 bge-m3 不同
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

  it('Ollama 沒開時顯示離線，其他功能照常；恢復後自動重試並繼續', async () => {
    ollama.online = false
    const { v, s } = await start()
    expect(s.status()).toMatchObject({ online: false, embedded: 0, total: 3 })
    expect(s.status().error).toContain('ollama serve')
    // 檢索退回全文
    const r = await s.retrieve('跑步')
    expect(r.vector).toBe(false)
    expect(r.hits.map((h) => h.path)).toContain('跑步.md')
    expect((await v.graph()).nodes).toHaveLength(4)

    ollama.online = true
    await until(() => s.status().online && idle(s)())
    expect(s.status()).toMatchObject({ error: null, embedded: 3 })
  })

  it('模型未下載時提示 ollama pull，不進行 embedding', async () => {
    ollama.installed = ['qwen3:8b']
    const { s } = await start()
    expect(s.status()).toMatchObject({ online: true, embedded: 0 })
    expect(s.status().error).toContain('ollama pull bge-m3')
    expect(ollama.embedCalls).toEqual([])
  })

  it('混合檢索用到向量', async () => {
    const { s } = await start()
    await until(idle(s))
    const r = await s.retrieve('番茄蛋')
    expect(r.vector).toBe(true)
    expect(r.hits[0]).toMatchObject({ path: '料理.md' })
    expect(r.hits[0].via).toContain('vector')
  })

  it('設定會儲存；換 embedding 模型時全部重算', async () => {
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

  it('總結筆記：串流片段，最後送出 done', async () => {
    ollama.replies = ['- 跑了五公里']
    const { s } = await start()
    const id = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    const mine = chunks.filter((c) => c.id === id)
    expect(mine.map((c) => c.delta).join('')).toBe('- 跑了五公里')
    expect(mine.at(-1)).toEqual({ id, delta: '', done: true })
    expect(ollama.chatCalls[0][1].content).toContain('早上跑步五公里')
  })

  it('總結選取文字只送出選取的部分', async () => {
    const { s } = await start()
    const id = s.summarize({ path: '跑步.md', selection: '只有這段' })
    await until(() => chunks.some((c) => c.id === id && c.done))
    const prompt = ollama.chatCalls[0][1].content
    expect(prompt).toContain('只有這段')
    expect(prompt).not.toContain('五公里')
  })

  it('依要求的語言選擇提示詞，預設繁體中文', async () => {
    const { s } = await start()
    const zh = s.summarize({ path: '跑步.md' })
    await until(() => chunks.some((c) => c.id === zh && c.done))
    const en = s.summarize({ path: '跑步.md', language: 'en' })
    await until(() => chunks.some((c) => c.id === en && c.done))
    expect(ollama.chatCalls[0][0].content).toContain('繁體中文')
    expect(ollama.chatCalls[1][0].content).toContain('in English')
    expect(ollama.chatCalls[1][1].content).toContain('早上跑步五公里')
  })

  it('空白筆記、離線與取消都會結束並帶上原因', async () => {
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

    it('先推送來源，再串流回答，結束時帶上實際引用的編號', async () => {
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

    it('從問題解析時間範圍；只有時間時列出範圍內的筆記', async () => {
      write('日記/2026-09-03.md', '讀完一本書。')
      write('日記/2026-10-02.md', '去爬山。')
      const { s } = await start()
      await until(idle(s))
      const id = s.ask({ question: '上個月寫了什麼？' })
      await until(answered(id))
      expect(mine(id)[0].range).toEqual({ from: '2026-09-01', to: '2026-09-30' })
      expect(mine(id)[0].sources?.map((x) => x.path)).toEqual(['日記/2026-09-03.md'])
      expect(ollama.chatCalls[0].at(-1)!.content).toContain('時間範圍：2026-09-01 – 2026-09-30')

      // 使用者取消範圍（null）時不篩選
      const all = s.ask({ question: '上個月 爬山', range: null })
      await until(answered(all))
      expect(mine(all)[0].range).toBeNull()
      expect(mine(all)[0].sources?.map((x) => x.path)).toContain('日記/2026-10-02.md')
    })

    it('找不到來源時不呼叫模型', async () => {
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

    it('追問附上之前的對話；沒有關鍵字時沿用前一個問題檢索', async () => {
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

    it('取消、離線與空白問題', async () => {
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
      // 離線時檢索退回全文，仍然推送來源
      expect(mine(offline)[0]).toMatchObject({ vector: false })
      expect(mine(offline)[0].sources?.[0].path).toBe('跑步.md')

      expect(() => s.ask({ question: '  ' })).toThrow('empty')
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

    it('執行工具、推送步驟與文字，結束時送出 done', async () => {
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
      // 系統提示詞帶上今天的日期（now 注入）
      expect(ollama.chatCalls[0][0].content).toContain('2026-10-14')
    })

    it('寫入要等使用者確認：Apply 後才建立筆記', async () => {
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

    it('Reject 與停止都不寫入；重複或過期的確認被忽略', async () => {
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

    it('離線、模型不支援工具與空白任務', async () => {
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

  it('換 vault 時停止舊的 embedding', async () => {
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
