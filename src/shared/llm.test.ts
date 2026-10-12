import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_SEMANTIC_SETTINGS,
  cleanLlmSettings,
  clampSemanticSettings,
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
    ).toEqual({ baseUrl: 'http://gpu-box:11434', chatModel: 'llama3', embedModel: 'bge-m3' })
    expect(cleanLlmSettings({ baseUrl: 'file:///etc/passwd' }).baseUrl).toBe(
      DEFAULT_LLM_SETTINGS.baseUrl
    )
  })
})

describe('sameModel', () => {
  it('沒寫 tag 等於 :latest', () => {
    expect(sameModel('bge-m3', 'bge-m3:latest')).toBe(true)
    expect(sameModel('qwen3:8b', 'qwen3')).toBe(false)
  })
})
