// LLM 相關設定的預設值與範圍。main 與 renderer 共用。
import type { ChatProvider, CloudProvider, LlmSettings, SemanticSettings } from './types'

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'http://127.0.0.1:11434',
  chatModel: 'qwen3:8b',
  embedModel: 'bge-m3',
  provider: 'ollama',
  cloudModels: {},
  customBaseUrl: ''
}

export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['openai', 'gemini', 'custom']

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  custom: 'Custom API'
}

/** 各雲端服務的 API 位址（OpenAI 相容）；custom 由使用者填 */
export const CLOUD_BASE_URLS: Record<Exclude<CloudProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
}

export const isCloudProvider = (p: unknown): p is CloudProvider =>
  CLOUD_PROVIDERS.includes(p as CloudProvider)

/** 雲端服務的 API 位址；custom 沒填時為空字串 */
export function cloudBaseUrl(s: LlmSettings, provider: CloudProvider): string {
  return provider === 'custom' ? s.customBaseUrl : CLOUD_BASE_URLS[provider]
}

/**
 * 自訂 API 位址：https，或連到本機（localhost、127.x、[::1]）的 http。
 * API key 會放在 header，不允許以明文送到其他機器。合法時回傳去掉結尾 / 的位址，否則 null。
 */
export function cleanCustomBaseUrl(input: string): string | null {
  const s = input.trim()
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const loopback = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null
  return s.replace(/\/+$/, '')
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

/**
 * 以 base 為底套用 input 中合法的欄位：模型為非空字串；baseUrl 必須是 http(s)，去掉結尾的 /；
 * provider 必須是已知的服務；customBaseUrl 見 cleanCustomBaseUrl（空字串 = 清除）。
 */
export function cleanLlmSettings(
  input: unknown,
  base: LlmSettings = DEFAULT_LLM_SETTINGS
): LlmSettings {
  const out = { ...base, cloudModels: { ...base.cloudModels } }
  if (!input || typeof input !== 'object') return out
  const v = input as Record<string, unknown>
  for (const key of ['chatModel', 'embedModel'] as const) {
    if (typeof v[key] === 'string' && v[key].trim()) out[key] = v[key].trim()
  }
  if (typeof v.baseUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(v.baseUrl.trim())) {
    out.baseUrl = v.baseUrl.trim().replace(/\/+$/, '')
  }
  if (v.provider === 'ollama' || isCloudProvider(v.provider)) out.provider = v.provider
  if (v.cloudModels && typeof v.cloudModels === 'object') {
    const models = v.cloudModels as Record<string, unknown>
    for (const p of CLOUD_PROVIDERS) {
      const m = models[p]
      if (typeof m === 'string' && m.trim()) out.cloudModels[p] = m.trim()
      else if (m === '' || m === null) delete out.cloudModels[p]
    }
  }
  if (typeof v.customBaseUrl === 'string') {
    if (!v.customBaseUrl.trim()) out.customBaseUrl = ''
    else out.customBaseUrl = cleanCustomBaseUrl(v.customBaseUrl) ?? out.customBaseUrl
  }
  return out
}

/** Ollama 的模型名稱沒寫 tag 時等於 :latest */
export function sameModel(a: string, b: string): boolean {
  const full = (m: string): string => (m.includes(':') ? m : `${m}:latest`)
  return full(a) === full(b)
}

/** 目前對話使用的模型（雲端服務沒選模型時為空字串） */
export function activeChatModel(s: LlmSettings): string {
  return s.provider === 'ollama' ? s.chatModel : (s.cloudModels[s.provider] ?? '')
}
