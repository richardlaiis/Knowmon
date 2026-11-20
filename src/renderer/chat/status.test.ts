import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../../shared/llm'
import type { LlmStatus } from '../../shared/types'
import { describeStatus } from './status'

const base: LlmStatus = {
  online: true,
  ollamaOnline: true,
  error: null,
  embedError: null,
  models: [],
  cloudModels: [],
  apiKeys: { openai: false, gemini: false, custom: false },
  keyEncrypted: true,
  settings: DEFAULT_LLM_SETTINGS,
  embedded: 3,
  total: 3,
  busy: false
}

describe('describeStatus', () => {
  it('依離線、錯誤、進行中、完成顯示', () => {
    expect(describeStatus(null).tone).toBe('off')
    expect(describeStatus({ ...base, online: false, error: 'x' })).toEqual({
      tone: 'off',
      label: 'AI offline'
    })
    expect(describeStatus({ ...base, error: 'Not installed: bge-m3' }).tone).toBe('warn')
    expect(describeStatus({ ...base, busy: true, embedded: 1 })).toEqual({
      tone: 'busy',
      label: 'Indexing 1/3'
    })
    expect(describeStatus(base)).toEqual({ tone: 'ok', label: 'AI ready' })
  })

  it('雲端模式：顯示服務名稱；Ollama 離線時不顯示 Indexing', () => {
    const cloud: LlmStatus = {
      ...base,
      ollamaOnline: false,
      embedded: 0,
      embedError: 'Ollama is offline',
      settings: { ...DEFAULT_LLM_SETTINGS, provider: 'openai', cloudModels: { openai: 'm' } }
    }
    expect(describeStatus(cloud)).toEqual({ tone: 'ok', label: 'AI ready · OpenAI' })
    expect(describeStatus({ ...cloud, ollamaOnline: true }).tone).toBe('busy')
    expect(describeStatus({ ...cloud, online: false, error: 'key' }).label).toBe('AI offline')
  })
})
