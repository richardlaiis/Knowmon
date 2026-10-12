// LLM 相關設定的預設值與範圍。main 與 renderer 共用。
import type { LlmSettings, SemanticSettings } from './types'

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'http://127.0.0.1:11434',
  chatModel: 'qwen3:8b',
  embedModel: 'bge-m3'
}

export const DEFAULT_SEMANTIC_SETTINGS: SemanticSettings = {
  semanticThreshold: 0.65,
  semanticMaxPerNote: 5
}

/** 每個參數允許的範圍（含兩端） */
export const SEMANTIC_LIMITS: Record<keyof SemanticSettings, [number, number]> = {
  semanticThreshold: [0.3, 0.95],
  semanticMaxPerNote: [1, 20]
}

/** 以 base 為底套用 input 中合法的欄位：門檻取到小數第二位，每篇上限取整數，超出範圍取最近的邊界 */
export function clampSemanticSettings(
  input: unknown,
  base: SemanticSettings = DEFAULT_SEMANTIC_SETTINGS
): SemanticSettings {
  const out = { ...base }
  if (!input || typeof input !== 'object') return out
  for (const key of Object.keys(SEMANTIC_LIMITS) as (keyof SemanticSettings)[]) {
    const v = (input as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const [min, max] = SEMANTIC_LIMITS[key]
    const rounded = key === 'semanticThreshold' ? Math.round(v * 100) / 100 : Math.round(v)
    out[key] = Math.min(max, Math.max(min, rounded))
  }
  return out
}

/** 以 base 為底套用 input 中非空的字串欄位；baseUrl 必須是 http(s)，去掉結尾的 / */
export function cleanLlmSettings(
  input: unknown,
  base: LlmSettings = DEFAULT_LLM_SETTINGS
): LlmSettings {
  const out = { ...base }
  if (!input || typeof input !== 'object') return out
  const v = input as Record<string, unknown>
  for (const key of ['chatModel', 'embedModel'] as const) {
    if (typeof v[key] === 'string' && v[key].trim()) out[key] = v[key].trim()
  }
  if (typeof v.baseUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(v.baseUrl.trim())) {
    out.baseUrl = v.baseUrl.trim().replace(/\/+$/, '')
  }
  return out
}

/** Ollama 的模型名稱沒寫 tag 時等於 :latest */
export function sameModel(a: string, b: string): boolean {
  const full = (m: string): string => (m.includes(':') ? m : `${m}:latest`)
  return full(a) === full(b)
}
