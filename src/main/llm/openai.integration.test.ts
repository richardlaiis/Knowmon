// Integration tests against real cloud providers, skipped by default. Enable each provider separately:
//   OPENAI_IT=1 OPENAI_API_KEY=sk-… OPENAI_MODEL=… npx vitest run src/main/llm/openai.integration.test.ts
//   GEMINI_IT=1 GEMINI_API_KEY=… GEMINI_MODEL=… npx vitest run src/main/llm/openai.integration.test.ts
//   CUSTOM_IT=1 CUSTOM_BASE_URL=http://127.0.0.1:11434/v1 CUSTOM_API_KEY=x CUSTOM_MODEL=qwen3:8b \
//     npx vitest run src/main/llm/openai.integration.test.ts
// (The last one uses Ollama's own OpenAI-compatible endpoint and needs no cloud account.)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CLOUD_BASE_URLS, DEFAULT_LLM_SETTINGS, PROVIDER_LABELS } from '../../shared/llm'
import type { AgentChunk, AgentStep, CloudProvider, LlmSettings } from '../../shared/types'
import { Vault } from '../vault'
import { createOpenAiCompatible } from './openai'
import { memoryKeyStore } from './secrets'
import { LlmService } from './service'

interface Target {
  provider: CloudProvider
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

const env = process.env
const TARGETS: Target[] = [
  {
    provider: 'openai',
    enabled: env.OPENAI_IT === '1',
    baseUrl: CLOUD_BASE_URLS.openai,
    apiKey: env.OPENAI_API_KEY ?? '',
    model: env.OPENAI_MODEL ?? ''
  },
  {
    provider: 'gemini',
    enabled: env.GEMINI_IT === '1',
    baseUrl: CLOUD_BASE_URLS.gemini,
    apiKey: env.GEMINI_API_KEY ?? '',
    model: env.GEMINI_MODEL ?? ''
  },
  {
    provider: 'custom',
    enabled: env.CUSTOM_IT === '1',
    baseUrl: env.CUSTOM_BASE_URL ?? '',
    apiKey: env.CUSTOM_API_KEY ?? '',
    model: env.CUSTOM_MODEL ?? ''
  }
]

const TEST_VAULT = path.resolve(__dirname, '../../../test-vault')

for (const t of TARGETS) {
  describe.skipIf(!t.enabled)(`${PROVIDER_LABELS[t.provider]} (real connection)`, () => {
    const client = createOpenAiCompatible({
      baseUrl: t.baseUrl,
      apiKey: t.apiKey,
      label: PROVIDER_LABELS[t.provider]
    })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-cloud-it-'))
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('is fully configured', () => {
      expect(t.apiKey, 'API key').not.toBe('')
      expect(t.model, 'model').not.toBe('')
      expect(t.baseUrl, 'base URL').not.toBe('')
    })

    it('lists models', async () => {
      const models = await client.models()
      console.log(`${t.provider}: ${models.length} models`, models.slice(0, 10))
      if (t.provider !== 'custom') expect(models.length).toBeGreaterThan(0)
    }, 30_000)

    it('streams chat', async () => {
      const parts: string[] = []
      const text = await client.chat(
        t.model,
        [{ role: 'user', content: 'Reply with exactly the word: pong' }],
        { onDelta: (d) => parts.push(d), temperature: 0 }
      )
      expect(text.toLowerCase()).toContain('pong')
      expect(parts.join('')).toBe(text)
    }, 60_000)

    it('test-vault: agent tool calls over two or more steps (Gemini needs the thought signature sent back)', async () => {
      const root = path.join(tmp, 'vault')
      fs.cpSync(TEST_VAULT, root, { recursive: true })
      const vault = await Vault.open(root)
      const chunks: AgentChunk[] = []
      let settings: LlmSettings = {
        ...DEFAULT_LLM_SETTINGS,
        provider: t.provider,
        cloudModels: { [t.provider]: t.model },
        customBaseUrl: t.provider === 'custom' ? t.baseUrl : ''
      }
      const service = new LlmService({
        loadSettings: () => settings,
        saveSettings: (s) => (settings = s),
        onStatus: () => {},
        onSummary: () => {},
        onAnswer: () => {},
        onAgent: (c) => chunks.push(c),
        keys: memoryKeyStore({ [t.provider]: t.apiKey })
      })
      try {
        await service.attach(vault)
        expect(service.status()).toMatchObject({ online: true, error: null })
        const id = service.agent({
          task: 'First search my notes about running, then open one of the results with get_note, and tell me in one sentence what it says.'
        })
        const end = Date.now() + 120_000
        while (!chunks.some((c) => c.id === id && c.done)) {
          if (Date.now() > end) throw new Error('timeout')
          await new Promise((r) => setTimeout(r, 100))
        }
        const mine = chunks.filter((c) => c.id === id)
        const steps = new Map<number, AgentStep>()
        for (const c of mine) if (c.step) steps.set(c.step.index, c.step)
        const answer = mine.map((c) => c.delta).join('')
        console.log(
          [...steps.values()].map((s) => `${s.tool} ${s.status}`),
          answer.slice(-300)
        )
        expect(mine.at(-1)?.error).toBeUndefined()
        expect(
          [...steps.values()].filter((s) => s.status === 'done').length
        ).toBeGreaterThanOrEqual(2)
        expect(answer.trim()).not.toBe('')
      } finally {
        await service.dispose()
        await vault.close()
      }
    }, 150_000)
  })
}
