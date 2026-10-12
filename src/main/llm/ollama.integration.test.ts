// 與真的 Ollama 連線的整合測試，只在 OLLAMA_IT=1 時執行：
//   OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts
// 需要先 ollama pull bge-m3 與 qwen3:8b。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../../shared/llm'
import type { SummaryChunk } from '../../shared/types'
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
      onSummary: (c) => chunks.push(c)
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
})
