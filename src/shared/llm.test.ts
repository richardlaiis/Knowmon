import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_SEMANTIC_SETTINGS,
  cleanLlmSettings,
  clampSemanticSettings,
  activeChatModel,
  cleanCustomBaseUrl,
  cloudBaseUrl,
  sameModel
} from './llm'

describe('clampSemanticSettings', () => {
  it('非物件或非數字時用預設值；超出範圍取邊界；門檻取到小數第二位', () => {
    expect(clampSemanticSettings(null)).toEqual(DEFAULT_SEMANTIC_SETTINGS)
    expect(clampSemanticSettings({ semanticThreshold: 'x', semanticMaxPerNote: NaN })).toEqual(
      DEFAULT_SEMANTIC_SETTINGS
    )
    expect(clampSemanticSettings({ semanticThreshold: 2, semanticMaxPerNote: 0 })).toEqual({
      semanticThreshold: 0.95,
      semanticMaxPerNote: 1
    })
    expect(clampSemanticSettings({ semanticThreshold: 0.7234, semanticMaxPerNote: 3.6 })).toEqual({
      semanticThreshold: 0.72,
      semanticMaxPerNote: 4
    })
  })
})

describe('cleanLlmSettings', () => {
  it('只接受非空字串與 http(s) 位址', () => {
    expect(cleanLlmSettings(undefined)).toEqual(DEFAULT_LLM_SETTINGS)
    expect(
      cleanLlmSettings({ baseUrl: 'http://gpu-box:11434/', chatModel: ' llama3 ', embedModel: '' })
    ).toEqual({
      ...DEFAULT_LLM_SETTINGS,
      baseUrl: 'http://gpu-box:11434',
      chatModel: 'llama3',
      embedModel: 'bge-m3'
    })
    expect(cleanLlmSettings({ baseUrl: 'file:///etc/passwd' }).baseUrl).toBe(
      DEFAULT_LLM_SETTINGS.baseUrl
    )
  })
})

describe('雲端服務設定', () => {
  it('provider 只接受已知的服務；模型去空白、空字串刪除；不修改 base', () => {
    const base = cleanLlmSettings({ provider: 'openai', cloudModels: { openai: ' gpt-x ' } })
    expect(base.provider).toBe('openai')
    expect(base.cloudModels).toEqual({ openai: 'gpt-x' })
    expect(cleanLlmSettings({ provider: 'claude' }, base).provider).toBe('openai')
    const next = cleanLlmSettings({ cloudModels: { openai: '', gemini: 'g', other: 'x' } }, base)
    expect(next.cloudModels).toEqual({ gemini: 'g' })
    expect(base.cloudModels).toEqual({ openai: 'gpt-x' })
    // 舊的 settings.json 沒有新欄位
    expect(cleanLlmSettings({ baseUrl: 'http://a:1' })).toMatchObject({
      provider: 'ollama',
      cloudModels: {},
      customBaseUrl: ''
    })
  })

  it('自訂 API 位址：https，或 loopback 的 http；不合法時保留原值，空字串清除', () => {
    expect(cleanCustomBaseUrl('https://openrouter.ai/api/v1/ ')).toBe(
      'https://openrouter.ai/api/v1'
    )
    expect(cleanCustomBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
    expect(cleanCustomBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1')
    expect(cleanCustomBaseUrl('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1')
    expect(cleanCustomBaseUrl('http://192.168.1.5:1234/v1')).toBeNull()
    expect(cleanCustomBaseUrl('http://localhost.evil.com/v1')).toBeNull()
    expect(cleanCustomBaseUrl('file:///etc/passwd')).toBeNull()
    expect(cleanCustomBaseUrl('not a url')).toBeNull()

    const s = cleanLlmSettings({ customBaseUrl: 'https://api.groq.com/openai/v1' })
    expect(cleanLlmSettings({ customBaseUrl: 'http://example.com' }, s).customBaseUrl).toBe(
      'https://api.groq.com/openai/v1'
    )
    expect(cleanLlmSettings({ customBaseUrl: ' ' }, s).customBaseUrl).toBe('')
  })

  it('目前的對話模型與 API 位址', () => {
    expect(activeChatModel(DEFAULT_LLM_SETTINGS)).toBe('qwen3:8b')
    const s = cleanLlmSettings({
      provider: 'gemini',
      cloudModels: { gemini: 'gemini-x' },
      customBaseUrl: 'https://x.test/v1'
    })
    expect(activeChatModel(s)).toBe('gemini-x')
    expect(activeChatModel({ ...s, provider: 'openai' })).toBe('')
    expect(cloudBaseUrl(s, 'gemini')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    )
    expect(cloudBaseUrl(s, 'openai')).toBe('https://api.openai.com/v1')
    expect(cloudBaseUrl(s, 'custom')).toBe('https://x.test/v1')
  })
})

describe('sameModel', () => {
  it('沒寫 tag 等於 :latest', () => {
    expect(sameModel('bge-m3', 'bge-m3:latest')).toBe(true)
    expect(sameModel('qwen3:8b', 'qwen3')).toBe(false)
  })
})
