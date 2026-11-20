// 雲端服務的 API key：以 Electron safeStorage（OS keyring）加密後存在 settings.json 的 llmKeys。
// key 只在 main process 使用，不寫入 log、錯誤訊息或 LlmStatus。
import { CLOUD_PROVIDERS, isCloudProvider } from '../../shared/llm'
import type { CloudProvider } from '../../shared/types'

/** Electron safeStorage 用到的部分（測試時注入假的） */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** 只有 Linux 有；'basic_text' 表示沒有 keyring，只是用固定密碼混淆 */
  getSelectedStorageBackend?(): string
}

export interface KeyStore {
  get(provider: CloudProvider): string | null
  /** null 或空字串 = 刪除 */
  set(provider: CloudProvider, key: string | null): void
  /** 是否為真正的加密（有 OS keyring） */
  encrypted(): boolean
}

/** 去掉空白後最長幾個字（防止誤貼整份文件） */
export const API_KEY_MAX = 500

export interface KeyStoreOptions {
  safeStorage: SafeStorageLike
  /** 讀取 settings.json 的 llmKeys（base64 的加密內容） */
  load: () => unknown
  save: (keys: Partial<Record<CloudProvider, string>>) => void
}

/**
 * safeStorage 要在 app ready 之後才能用，所以第一次讀寫時才載入。
 * 完全無法加密時 key 只保留在記憶體中（App 關閉後要重新輸入），不以明文存檔。
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
        // 換了機器或 keyring 被重設：當作沒有 key，請使用者重新輸入
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

/** 只存在記憶體（測試、或沒有注入 KeyStore 時） */
export function memoryKeyStore(initial: Partial<Record<CloudProvider, string>> = {}): KeyStore {
  const map = new Map(Object.entries(initial) as [CloudProvider, string][])
  return {
    get: (p) => map.get(p) ?? null,
    set: (p, key) => (key?.trim() ? map.set(p, key.trim()) : map.delete(p)),
    encrypted: () => true
  }
}
