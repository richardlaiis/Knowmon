// Defaults and ranges for LLM settings. Shared by main and renderer.
import type {
  ChatLimits,
  ChatProvider,
  CloudProvider,
  LlmSettings,
  SemanticSettings
} from './types'

/** 8192 is the baseline for scaling the character budgets (see main/llm/budget.ts); no output limit */
export const DEFAULT_CHAT_LIMITS: ChatLimits = {
  contextTokens: 8_192,
  maxOutputTokens: null
}

/** Allowed range for each field (inclusive, in tokens) */
export const CHAT_LIMITS: Record<keyof ChatLimits, [number, number]> = {
  contextTokens: [2_048, 1_048_576],
  maxOutputTokens: [256, 131_072]
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'http://127.0.0.1:11434',
  chatModel: 'qwen3:8b',
  embedModel: 'bge-m3',
  provider: 'ollama',
  cloudModels: {},
  customBaseUrl: '',
  ollamaLimits: DEFAULT_CHAT_LIMITS,
  cloudLimits: DEFAULT_CHAT_LIMITS
}

export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['openai', 'gemini', 'custom']

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  custom: 'Custom API'
}

/** API address of each cloud provider (OpenAI-compatible); custom is entered by the user */
export const CLOUD_BASE_URLS: Record<Exclude<CloudProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
}

export const isCloudProvider = (p: unknown): p is CloudProvider =>
  CLOUD_PROVIDERS.includes(p as CloudProvider)

/** A cloud provider's API address; an empty string when custom hasn't been filled in */
export function cloudBaseUrl(s: LlmSettings, provider: CloudProvider): string {
  return provider === 'custom' ? s.customBaseUrl : CLOUD_BASE_URLS[provider]
}

/**
 * Custom API address: https, or http to this computer (localhost, 127.x, [::1]).
 * The API key goes in a header, so it must never be sent in plain text to another machine. Returns the address without a trailing / when valid, otherwise null.
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

/** Allowed range for each parameter (inclusive) */
export const SEMANTIC_LIMITS: Record<keyof SemanticSettings, [number, number]> = {
  semanticThreshold: [0.3, 0.95],
  semanticMaxPerNote: [1, 20]
}

/** Applies the valid fields of input on top of base: the threshold is rounded to two decimals, the per-note limit to an integer, and out-of-range values are clamped to the nearest bound */
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

const clampInt = (v: number, [min, max]: [number, number]): number =>
  Math.min(max, Math.max(min, Math.round(v)))

/**
 * Applies the valid fields of input on top of base: rounded to integers and clamped to the nearest bound;
 * a null or empty maxOutputTokens means the model default.
 * When ollama is true, the output limit can't exceed the context (Ollama's num_predict also uses context).
 */
export function cleanChatLimits(
  input: unknown,
  base: ChatLimits = DEFAULT_CHAT_LIMITS,
  ollama = false
): ChatLimits {
  const out = { ...base }
  if (input && typeof input === 'object') {
    const v = input as Record<string, unknown>
    if (typeof v.contextTokens === 'number' && Number.isFinite(v.contextTokens)) {
      out.contextTokens = clampInt(v.contextTokens, CHAT_LIMITS.contextTokens)
    }
    if (v.maxOutputTokens === null || v.maxOutputTokens === '') out.maxOutputTokens = null
    else if (typeof v.maxOutputTokens === 'number' && Number.isFinite(v.maxOutputTokens)) {
      out.maxOutputTokens = clampInt(v.maxOutputTokens, CHAT_LIMITS.maxOutputTokens)
    }
  }
  if (ollama && out.maxOutputTokens !== null && out.maxOutputTokens > out.contextTokens) {
    out.maxOutputTokens = out.contextTokens
  }
  return out
}

/**
 * Applies the valid fields of input on top of base: models must be non-empty strings; baseUrl must be http(s), with any trailing / removed;
 * provider must be a known provider; customBaseUrl follows cleanCustomBaseUrl (an empty string clears it);
 * ollamaLimits and cloudLimits follow cleanChatLimits.
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
  out.ollamaLimits = cleanChatLimits(v.ollamaLimits, base.ollamaLimits, true)
  out.cloudLimits = cleanChatLimits(v.cloudLimits, base.cloudLimits)
  return out
}

/** An Ollama model name without a tag means :latest */
export function sameModel(a: string, b: string): boolean {
  const full = (m: string): string => (m.includes(':') ? m : `${m}:latest`)
  return full(a) === full(b)
}

/** The context length and output limit of the current chat provider */
export function activeChatLimits(s: LlmSettings): ChatLimits {
  return s.provider === 'ollama' ? s.ollamaLimits : s.cloudLimits
}

/** The current chat model (an empty string when no model is chosen for the cloud provider) */
export function activeChatModel(s: LlmSettings): string {
  return s.provider === 'ollama' ? s.chatModel : (s.cloudModels[s.provider] ?? '')
}
