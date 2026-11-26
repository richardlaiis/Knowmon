import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_LIMITS,
  DEFAULT_LLM_SETTINGS,
  DEFAULT_SEMANTIC_SETTINGS,
  activeChatLimits,
  cleanChatLimits,
  cleanLlmSettings,
  clampSemanticSettings,
  activeChatModel,
  cleanCustomBaseUrl,
  cloudBaseUrl,
  sameModel
} from './llm'

describe('clampSemanticSettings', () => {
  it('uses defaults for non-objects and non-numbers; clamps out-of-range values; rounds the threshold to two decimals', () => {
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
  it('accepts only non-empty strings and http(s) addresses', () => {
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

describe('cloud provider settings', () => {
  it('accepts only known providers; trims models and deletes empty ones; leaves base unchanged', () => {
    const base = cleanLlmSettings({ provider: 'openai', cloudModels: { openai: ' gpt-x ' } })
    expect(base.provider).toBe('openai')
    expect(base.cloudModels).toEqual({ openai: 'gpt-x' })
    expect(cleanLlmSettings({ provider: 'claude' }, base).provider).toBe('openai')
    const next = cleanLlmSettings({ cloudModels: { openai: '', gemini: 'g', other: 'x' } }, base)
    expect(next.cloudModels).toEqual({ gemini: 'g' })
    expect(base.cloudModels).toEqual({ openai: 'gpt-x' })
    // Old settings.json files don't have the new fields
    expect(cleanLlmSettings({ baseUrl: 'http://a:1' })).toMatchObject({
      provider: 'ollama',
      cloudModels: {},
      customBaseUrl: ''
    })
  })

  it('custom API address: https, or loopback http; invalid values keep the old one, an empty string clears it', () => {
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

  it('current chat model and API address', () => {
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

describe('context length and max output', () => {
  it("uses the defaults when an old settings.json doesn't have the two pairs", () => {
    const s = cleanLlmSettings({ baseUrl: 'http://a:1' })
    expect(s.ollamaLimits).toEqual(DEFAULT_CHAT_LIMITS)
    expect(s.cloudLimits).toEqual({ contextTokens: 8192, maxOutputTokens: null })
  })

  it('rounds to integers and clamps; null or an empty string = model default; invalid values keep the old one', () => {
    expect(cleanChatLimits({ contextTokens: 100, maxOutputTokens: 10 })).toEqual({
      contextTokens: 2048,
      maxOutputTokens: 256
    })
    expect(cleanChatLimits({ contextTokens: 5e9, maxOutputTokens: 1e9 })).toEqual({
      contextTokens: 1_048_576,
      maxOutputTokens: 131_072
    })
    expect(cleanChatLimits({ contextTokens: 16383.6, maxOutputTokens: 999.4 })).toEqual({
      contextTokens: 16384,
      maxOutputTokens: 999
    })
    const base = { contextTokens: 4096, maxOutputTokens: 512 }
    expect(cleanChatLimits({ contextTokens: 'x', maxOutputTokens: NaN }, base)).toEqual(base)
    expect(cleanChatLimits({ maxOutputTokens: null }, base)).toEqual({
      contextTokens: 4096,
      maxOutputTokens: null
    })
    expect(cleanChatLimits({ maxOutputTokens: '' }, base).maxOutputTokens).toBeNull()
    expect(cleanChatLimits('nope', base)).toEqual(base)
  })

  it("Ollama's output limit can't exceed the context; the cloud has no such limit", () => {
    const s = cleanLlmSettings({
      ollamaLimits: { contextTokens: 4096, maxOutputTokens: 8000 },
      cloudLimits: { contextTokens: 4096, maxOutputTokens: 8000 }
    })
    expect(s.ollamaLimits).toEqual({ contextTokens: 4096, maxOutputTokens: 4096 })
    expect(s.cloudLimits).toEqual({ contextTokens: 4096, maxOutputTokens: 8000 })
    // Also applied when only the context changes
    expect(cleanLlmSettings({ ollamaLimits: { contextTokens: 2048 } }, s).ollamaLimits).toEqual({
      contextTokens: 2048,
      maxOutputTokens: 2048
    })
  })

  it('picks the pair for the provider', () => {
    const s = cleanLlmSettings({
      ollamaLimits: { contextTokens: 4096 },
      cloudLimits: { contextTokens: 131072 }
    })
    expect(activeChatLimits(s).contextTokens).toBe(4096)
    expect(activeChatLimits({ ...s, provider: 'gemini' }).contextTokens).toBe(131072)
  })
})

describe('sameModel', () => {
  it('no tag means :latest', () => {
    expect(sameModel('bge-m3', 'bge-m3:latest')).toBe(true)
    expect(sameModel('qwen3:8b', 'qwen3')).toBe(false)
  })
})
