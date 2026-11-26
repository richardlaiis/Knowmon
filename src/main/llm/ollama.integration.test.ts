// Integration tests against a real Ollama, run only with OLLAMA_IT=1:
//   OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts
// Needs ollama pull bge-m3 and qwen3:8b first. To use another installed chat model:
//   OLLAMA_IT=1 OLLAMA_CHAT_MODEL=qwen3.5:2b npx vitest run src/main/llm/ollama.integration.test.ts
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
const { baseUrl, embedModel } = DEFAULT_LLM_SETTINGS
const chatModel = process.env.OLLAMA_CHAT_MODEL || DEFAULT_LLM_SETTINGS.chatModel
/** Settings for every service in these tests (only the chat model can differ from the defaults) */
const loadSettings = (): unknown => ({ chatModel })
/** A fixed "now" so time phrases such as 上週 ("last week") always mean the same dates in the sample vault */
const now = (): number => new Date(2026, 10, 26, 12).getTime()

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

describe.skipIf(!enabled)('Ollama (real connection)', () => {
  const client = createOllama(baseUrl)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-it-'))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('bge-m3: sentences with similar meaning are more similar than unrelated ones', async () => {
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
      `bge-m3 similarity: running/jogging ${related.toFixed(3)}, running/cooking ${unrelated.toFixed(3)}, running/English ${cosine(run, en).toFixed(3)}`
    )
    expect(related).toBeGreaterThan(unrelated + 0.1)
    expect(cosine(run, en)).toBeGreaterThan(unrelated)
  }, 120_000)

  it('test-vault: background embedding, semantic edges, hybrid retrieval, summaries', async () => {
    const root = path.join(tmp, 'vault')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const chunks: SummaryChunk[] = []
    const service = new LlmService({
      loadSettings,
      now,
      saveSettings: () => {},
      onStatus: () => {},
      onSummary: (c) => chunks.push(c),
      onAnswer: () => {},
      onAgent: () => {}
    })
    try {
      await service.attach(vault)
      const end = Date.now() + 300_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(service.status()).toMatchObject({ online: true, error: null })

      const edges = (await vault.graph()).edges.filter((e) => e.type === 'semantic')
      console.log(
        `Semantic edges (threshold ${vault.getSemanticSettings().semanticThreshold}):\n` +
          edges.map((e) => `  ${e.weight.toFixed(3)} ${e.source} – ${e.target}`).join('\n')
      )

      const search = async (query: string): Promise<string[]> => {
        const r = await service.retrieve(query)
        console.log(
          `Retrieval for "${query}":\n` +
            r.hits.map((h) => `  ${h.score.toFixed(4)} ${h.path} [${h.via.join(',')}]`).join('\n')
        )
        expect(r.vector).toBe(true)
        return r.hits.map((h) => h.path)
      }
      expect((await search('how to build better habits'))[0]).toBe('Books/Atomic Habits.md')
      // A Chinese query finds both the English book note and the Chinese one (cross-lingual vectors)
      const zh = (await search('培養好習慣的方法')).slice(0, 5)
      expect(zh).toContain('Books/Atomic Habits.md')
      expect(zh).toContain('中文/原子習慣讀書心得.md')

      const summarize = async (path: string, language?: 'en' | 'zh-TW'): Promise<string> => {
        const t0 = Date.now()
        const id = service.summarize({ path, language })
        while (!chunks.some((c) => c.id === id && c.done)) {
          if (Date.now() - t0 > 600_000) throw new Error('summary timeout')
          await new Promise((r) => setTimeout(r, 200))
        }
        const done = chunks.find((c) => c.id === id && c.done)!
        expect(done.error).toBeUndefined()
        const text = chunks
          .filter((c) => c.id === id)
          .map((c) => c.delta)
          .join('')
        console.log(
          `Summary of ${path} (${language ?? 'zh-TW'}, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${chatModel}):\n${text}`
        )
        expect(text.trim().length).toBeGreaterThan(0)
        expect(text).not.toContain('<think>')
        return text
      }
      await summarize('Books/Deep Work.md', 'en')
      // Over the direct-summary limit, so it's summarized in parts and then combined
      await summarize('Projects/Knowmon/Design notes.md', 'en')
      // Traditional Chinese summary of a Chinese note
      expect(await summarize('中文/原子習慣讀書心得.md')).toMatch(/[\u4e00-\u9fff]/)
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 1_200_000)

  it('test-vault: Q&A with citations, time ranges, no making things up when nothing is relevant', async () => {
    const root = path.join(tmp, 'vault-ask')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const answers: AnswerChunk[] = []
    const service = new LlmService({
      loadSettings,
      now,
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
        `Asked "${question}" (${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
          `  range ${JSON.stringify(first.range)}, sources: ${first.sources?.map((s) => `[${s.n}] ${s.path}`).join(', ')}\n` +
          text
      )
      return { text, done: mine.at(-1)!, first }
    }
    try {
      await service.attach(vault)
      const end = Date.now() + 300_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }

      const general = await ask('What are the key ideas of Deep Work?')
      expect(general.done.error).toBeUndefined()
      expect(general.first.sources?.some((s) => s.path === 'Books/Deep Work.md')).toBe(true)
      expect(general.done.cited?.length).toBeGreaterThan(0)
      const n = general.first.sources!.length
      expect(general.done.cited!.every((c) => c >= 1 && c <= n)).toBe(true)

      const dated = await ask('What did I do from 2026-10-14 to 2026-10-21?')
      expect(dated.first.range).toEqual({ from: '2026-10-14', to: '2026-10-21' })
      expect(
        dated.first.sources?.every((s) => s.date >= '2026-10-14' && s.date <= '2026-10-21')
      ).toBe(true)

      // A Chinese question with a relative time phrase: last week = 2026-11-16 – 2026-11-22
      const chinese = await ask('上週跑了幾公里？')
      expect(chinese.done.error).toBeUndefined()
      expect(chinese.first.range).toEqual({ from: '2026-11-16', to: '2026-11-22' })
      expect(chinese.text).toMatch(/[\u4e00-\u9fff]/)

      // Nothing relevant: just log the output and check by hand for anything made up
      await ask('How is the Schrödinger equation derived?')
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 600_000)

  it('test-vault: agent multi-step retrieval, with confirmation for creating notes and adding tags', async () => {
    const root = path.join(tmp, 'vault-agent')
    fs.cpSync(path.resolve(__dirname, '../../../test-vault'), root, {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.')
    })
    const vault = await Vault.open(root)
    const chunks: AgentChunk[] = []
    // Answer confirmations automatically, taking decisions in order
    let decisions: boolean[] = []
    const service: LlmService = new LlmService({
      loadSettings,
      now,
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
          `Agent "${task}" (${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
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
      const end = Date.now() + 300_000
      for (;;) {
        const s = service.status()
        if (!s.busy && s.embedded === s.total) break
        if (Date.now() > end) throw new Error(`embedding timeout: ${JSON.stringify(s)}`)
        await new Promise((r) => setTimeout(r, 200))
      }

      const read = await run(
        'Which notes did I write from 2026-11-02 to 2026-11-09, and what does each of them link to?'
      )
      const tools = read.steps.map((s) => s.tool)
      expect(tools.some((t) => t === 'list_notes_in_range' || t === 'search_notes')).toBe(true)
      expect(tools).toContain('get_neighbors')
      expect(read.steps.every((s) => s.status === 'done')).toBe(true)
      linksResolve(read.text)

      const before = new Set(vault.list().map((n) => n.path))
      const task =
        'Write a note comparing the key ideas of Atomic Habits and Deep Work, and save it in the Summaries folder'
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
        console.log(`Created ${proposal.path}:\n${proposal.content}`)
      }

      decisions = [true]
      const tagged = await run('Add the tag "milestone" to my 2026-11-02 journal entry')
      expect(tagged.steps.some((s) => s.tool === 'add_tags' && s.status === 'applied')).toBe(true)
      const journal = fs.readFileSync(path.join(root, 'Journal/2026-11-02.md'), 'utf8')
      expect(matter(journal, {}).data.tags).toContain('milestone')
    } finally {
      await service.dispose()
      await vault.close()
    }
  }, 2_400_000)
})
