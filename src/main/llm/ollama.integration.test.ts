// 與真的 Ollama 連線的整合測試，只在 OLLAMA_IT=1 時執行：
//   OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts
// 需要先 ollama pull bge-m3 與 qwen3:8b。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../../shared/llm'
import matter from 'gray-matter'
import { createLinkResolver } from '../../shared/links'
import type { AgentChunk, AgentStep, AnswerChunk, SummaryChunk } from '../../shared/types'
import { Vault } from '../vault'
import { createOllama } from './ollama'
import { LlmService } from './service'

const enabled = process.env.OLLAMA_IT === '1'
const { baseUrl, embedModel, chatModel } = DEFAULT_LLM_SETTINGS

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / Math.sqrt(na * nb)
}

describe.skipIf(!enabled)('Ollama（實際連線）', () => {
  const client = createOllama(baseUrl)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-it-'))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('bge-m3：意思相近的句子比無關的句子相似', async () => {
    const [run, jog, cook, en] = await client.embed(embedModel, [
      '今天早上去河濱公園跑步五公里',
      '清晨慢跑了五公里，覺得很舒服',
      '晚餐煮了番茄炒蛋和味噌湯',
      'I went jogging for 5 km this morning'
    ])
    expect(run).toHaveLength(1024)
    const related = cosine(run, jog)
    const unrelated = cosine(run, cook)
    console.log(
      `bge-m3 相似度：跑步/慢跑 ${related.toFixed(3)}，跑步/料理 ${unrelated.toFixed(3)}，跑步/英文 ${cosine(run, en).toFixed(3)}`
    )
    expect(related).toBeGreaterThan(unrelated + 0.1)
    expect(cosine(run, en)).toBeGreaterThan(unrelated)
  }, 120_000)

  it('test-vault：背景 embedding、semantic 邊、混合檢索、總結', async () => {
    const root = path.join(tmp, 'vault')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const chunks: SummaryChunk[] = []
    const service = new LlmService({
      loadSettings: () => null,
      saveSettings: () => {},
      onStatus: () => {},
      onSummary: (c) => chunks.push(c),
      onAnswer: () => {},
      onAgent: () => {}
    })
    try {
      await service.attach(vault)
      const end = Date.now() + 120_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(service.status()).toMatchObject({ online: true, error: null })

      const edges = (await vault.graph()).edges.filter((e) => e.type === 'semantic')
      console.log(
        `semantic 邊（門檻 ${vault.getSemanticSettings().semanticThreshold}）：\n` +
          edges.map((e) => `  ${e.weight.toFixed(3)} ${e.source} – ${e.target}`).join('\n')
      )

      const r = await service.retrieve('培養好習慣的方法')
      console.log(
        '檢索「培養好習慣的方法」：\n' +
          r.hits.map((h) => `  ${h.score.toFixed(4)} ${h.path} [${h.via.join(',')}]`).join('\n')
      )
      expect(r.vector).toBe(true)
      expect(r.hits.length).toBeGreaterThan(0)

      const note = (await vault.list()).find((n) => n.path.includes('原子習慣')) ?? vault.list()[0]
      const t0 = Date.now()
      const id = service.summarize({ path: note.path })
      while (!chunks.some((c) => c.id === id && c.done)) {
        if (Date.now() - t0 > 180_000) throw new Error('summary timeout')
        await new Promise((r) => setTimeout(r, 200))
      }
      const done = chunks.find((c) => c.id === id && c.done)!
      expect(done.error).toBeUndefined()
      const text = chunks
        .filter((c) => c.id === id)
        .map((c) => c.delta)
        .join('')
      console.log(
        `總結「${note.title}」（${((Date.now() - t0) / 1000).toFixed(1)}s，${chatModel}）：\n${text}`
      )
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text).not.toContain('<think>')
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 300_000)

  it('test-vault：問答附引用、時間範圍、無相關筆記時不編造', async () => {
    const root = path.join(tmp, 'vault-ask')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const answers: AnswerChunk[] = []
    const service = new LlmService({
      loadSettings: () => null,
      saveSettings: () => {},
      onStatus: () => {},
      onSummary: () => {},
      onAnswer: (c) => answers.push(c),
      onAgent: () => {}
    })
    const ask = async (
      question: string
    ): Promise<{ text: string; done: AnswerChunk; first: AnswerChunk }> => {
      const t0 = Date.now()
      const id = service.ask({ question })
      while (!answers.some((c) => c.id === id && c.done)) {
        if (Date.now() - t0 > 180_000) throw new Error('answer timeout')
        await new Promise((r) => setTimeout(r, 200))
      }
      const mine = answers.filter((c) => c.id === id)
      const text = mine.map((c) => c.delta).join('')
      const first = mine[0]
      console.log(
        `問「${question}」（${((Date.now() - t0) / 1000).toFixed(1)}s）\n` +
          `  範圍 ${JSON.stringify(first.range)}，來源：${first.sources?.map((s) => `[${s.n}] ${s.path}`).join('、')}\n` +
          text
      )
      return { text, done: mine.at(-1)!, first }
    }
    try {
      await service.attach(vault)
      const end = Date.now() + 120_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }

      const general = await ask('深度工作的重點是什麼？')
      expect(general.done.error).toBeUndefined()
      expect(general.first.sources?.some((s) => s.path.includes('深度工作'))).toBe(true)
      expect(general.done.cited?.length).toBeGreaterThan(0)
      const n = general.first.sources!.length
      expect(general.done.cited!.every((c) => c >= 1 && c <= n)).toBe(true)

      const dated = await ask('2026-10-04 到 2026-10-06 之間做了什麼？')
      expect(dated.first.range).toEqual({ from: '2026-10-04', to: '2026-10-06' })
      expect(
        dated.first.sources?.every((s) => s.date >= '2026-10-04' && s.date <= '2026-10-06')
      ).toBe(true)

      const english = await ask('What are the key ideas of Atomic Habits?')
      expect(english.done.error).toBeUndefined()
      expect(english.text).toMatch(/[A-Za-z]{4,}/)

      // 無相關筆記：只記錄輸出，人工檢查是否編造
      await ask('薛丁格方程式怎麼推導？')
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 600_000)

  it('test-vault：agent 多步驟檢索、建立筆記與加標籤都要確認', async () => {
    const root = path.join(tmp, 'vault-agent')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const chunks: AgentChunk[] = []
    // 自動回覆確認：依序取用 decisions
    let decisions: boolean[] = []
    const service: LlmService = new LlmService({
      loadSettings: () => null,
      saveSettings: () => {},
      onStatus: () => {},
      onSummary: () => {},
      onAnswer: () => {},
      onAgent: (c) => {
        chunks.push(c)
        if (c.step?.status === 'confirm') {
          const approved = decisions.shift() ?? false
          setTimeout(() => service.confirm(c.id, c.step!.index, { approved }), 0)
        }
      }
    })
    const run = async (task: string): Promise<{ text: string; steps: AgentStep[] }> => {
      const t0 = Date.now()
      const id = service.agent({ task })
      const report = (): { text: string; steps: AgentStep[] } => {
        const mine = chunks.filter((c) => c.id === id)
        const byIndex = new Map<number, AgentStep>()
        for (const c of mine) if (c.step) byIndex.set(c.step.index, c.step)
        const steps = [...byIndex.values()]
        const text = mine.map((c) => c.delta).join('')
        console.log(
          `Agent「${task}」（${((Date.now() - t0) / 1000).toFixed(1)}s）\n` +
            steps
              .map((s) => `  [${s.status}] ${s.tool} ${JSON.stringify(s.args)} → ${s.label}`)
              .join('\n') +
            `\n${text}`
        )
        return { text, steps }
      }
      while (!chunks.some((c) => c.id === id && c.done)) {
        if (Date.now() - t0 > 600_000) {
          report()
          service.cancel(id)
          throw new Error('agent timeout')
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(chunks.filter((c) => c.id === id).at(-1)?.error).toBeUndefined()
      return report()
    }
    const linksResolve = (text: string): void => {
      const resolve = createLinkResolver(vault.list().map((n) => n.path))
      for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) expect(resolve(m[1]), m[1]).not.toBeNull()
    }
    try {
      await service.attach(vault)
      const end = Date.now() + 120_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }

      const read = await run('2026-10-04 到 2026-10-06 之間寫了哪些筆記？它們各自連到哪些筆記？')
      const tools = read.steps.map((s) => s.tool)
      expect(tools.some((t) => t === 'list_notes_in_range' || t === 'search_notes')).toBe(true)
      expect(tools).toContain('get_neighbors')
      expect(read.steps.every((s) => s.status === 'done')).toBe(true)
      linksResolve(read.text)

      const before = new Set(vault.list().map((n) => n.path))
      const task =
        '把「原子習慣」和「深度工作」兩篇筆記的重點整理成一篇比較筆記，存在「整理」資料夾'
      decisions = [false]
      const rejected = await run(task)
      expect(rejected.steps.some((s) => s.tool === 'create_note' && s.status === 'rejected')).toBe(
        true
      )
      expect(vault.list().map((n) => n.path)).toEqual([...before])

      decisions = [true]
      const created = await run(task)
      const applied = created.steps.find((s) => s.tool === 'create_note' && s.status === 'applied')
      expect(applied).toBeDefined()
      const proposal = applied!.proposal!
      expect(proposal.kind).toBe('create_note')
      if (proposal.kind === 'create_note') {
        expect(fs.readFileSync(path.join(root, proposal.path), 'utf8')).toBe(proposal.content)
        console.log(`建立的筆記 ${proposal.path}：\n${proposal.content}`)
      }

      decisions = [true]
      const tagged = await run('幫 2026-10-04 這篇日記加上「回顧」標籤')
      expect(tagged.steps.some((s) => s.tool === 'add_tags' && s.status === 'applied')).toBe(true)
      const diary = fs.readFileSync(path.join(root, '日記/2026-10-04.md'), 'utf8')
      expect(matter(diary, {}).data.tags).toContain('回顧')
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 2_400_000)
})
