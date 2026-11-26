// Cloud provider API keys: encrypted with Electron safeStorage (the OS keyring) and stored in llmKeys in settings.json.
// Keys are used only in the main process and never written to logs, error messages or LlmStatus.
import { CLOUD_PROVIDERS, isCloudProvider } from '../../shared/llm'
import type { CloudProvider } from '../../shared/types'

/** The parts of Electron safeStorage that are used (a fake is injected in tests) */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only; 'basic_text' means there's no keyring and keys are only obfuscated with a fixed password */
  getSelectedStorageBackend?(): string
}

export interface KeyStore {
  get(provider: CloudProvider): string | null
  /** null or an empty string = delete */
  set(provider: CloudProvider, key: string | null): void
  /** Whether this is real encryption (an OS keyring is available) */
  encrypted(): boolean
}

/** Maximum length after trimming (guards against pasting a whole document by mistake) */
export const API_KEY_MAX = 500

export interface KeyStoreOptions {
  safeStorage: SafeStorageLike
  /** Reads llmKeys from settings.json (base64 encrypted content) */
  load: () => unknown
  save: (keys: Partial<Record<CloudProvider, string>>) => void
}

/**
 * safeStorage is only usable after app ready, so it's loaded on the first read or write.
 * When encryption isn't available at all, keys are kept only in memory (re-entered after the app closes), never saved in plain text.
 */
export function createKeyStore(o: KeyStoreOptions): KeyStore {
  let cache: Map<CloudProvider, string> | null = null
  const available = (): boolean => {
    try {
      return o.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  const keys = (): Map<CloudProvider, string> => {
    if (cache) return cache
    cache = new Map()
    const raw = o.load()
    if (!raw || typeof raw !== 'object' || !available()) return cache
    for (const [p, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!isCloudProvider(p) || typeof v !== 'string') continue
      try {
        const key = o.safeStorage.decryptString(Buffer.from(v, 'base64'))
        if (key) cache.set(p, key)
      } catch {
        // A different machine or a reset keyring: treat it as no key and ask the user to enter it again
      }
    }
    return cache
  }

  return {
    get: (p) => keys().get(p) ?? null,
    set(p, key) {
      const map = keys()
      const k = (key ?? '').trim()
      if (k) map.set(p, k)
      else map.delete(p)
      if (!available()) return
      const out: Partial<Record<CloudProvider, string>> = {}
      for (const provider of CLOUD_PROVIDERS) {
        const v = map.get(provider)
        if (v) out[provider] = o.safeStorage.encryptString(v).toString('base64')
      }
      o.save(out)
    },
    encrypted() {
      if (!available()) return false
      try {
        return o.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
      } catch {
        return true
      }
    }
  }
}

/** In memory only (for tests, or when no KeyStore is injected) */
export function memoryKeyStore(initial: Partial<Record<CloudProvider, string>> = {}): KeyStore {
  const map = new Map(Object.entries(initial) as [CloudProvider, string][])
  return {
    get: (p) => map.get(p) ?? null,
    set: (p, key) => (key?.trim() ? map.set(p, key.trim()) : map.delete(p)),
    encrypted: () => true
  }
}
