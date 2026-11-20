import { describe, expect, it } from 'vitest'
import { createKeyStore, memoryKeyStore, type SafeStorageLike } from './secrets'

/** 假的 safeStorage：「加密」= 反轉字串加上前綴 */
function fakeSafeStorage(opts: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (s) => Buffer.from('enc:' + [...s].reverse().join('')),
    decryptString: (b) => {
      const s = b.toString()
      if (!s.startsWith('enc:')) throw new Error('bad')
      return [...s.slice(4)].reverse().join('')
    },
    getSelectedStorageBackend: () => opts.backend ?? 'gnome_libsecret'
  }
}

describe('createKeyStore', () => {
  it('加密後存檔，重新載入可解密；檔案中沒有明文', () => {
    let saved: unknown = undefined
    const make = (): ReturnType<typeof createKeyStore> =>
      createKeyStore({
        safeStorage: fakeSafeStorage(),
        load: () => saved,
        save: (k) => (saved = k)
      })
    const a = make()
    a.set('openai', '  sk-abc  ')
    a.set('gemini', 'AIza-1')
    expect(JSON.stringify(saved)).not.toContain('sk-abc')
    const b = make()
    expect(b.get('openai')).toBe('sk-abc')
    expect(b.get('gemini')).toBe('AIza-1')
    expect(b.get('custom')).toBeNull()
    expect(b.encrypted()).toBe(true)

    b.set('openai', null)
    b.set('gemini', '')
    expect(saved).toEqual({})
    expect(make().get('openai')).toBeNull()
  })

  it('解密失敗或格式不對時視為沒有 key；不認得的服務忽略', () => {
    const store = createKeyStore({
      safeStorage: fakeSafeStorage(),
      load: () => ({
        openai: Buffer.from('garbage').toString('base64'),
        gemini: 42,
        claude: Buffer.from('enc:x').toString('base64')
      }),
      save: () => {}
    })
    expect(store.get('openai')).toBeNull()
    expect(store.get('gemini')).toBeNull()
  })

  it('Linux 沒有 keyring（basic_text）：仍可存，但標示不是真加密', () => {
    let saved: unknown
    const store = createKeyStore({
      safeStorage: fakeSafeStorage({ backend: 'basic_text' }),
      load: () => undefined,
      save: (k) => (saved = k)
    })
    store.set('openai', 'sk-1')
    expect(saved).toHaveProperty('openai')
    expect(store.encrypted()).toBe(false)
  })

  it('完全無法加密：key 只留在記憶體，不存檔', () => {
    let saves = 0
    const store = createKeyStore({
      safeStorage: fakeSafeStorage({ available: false }),
      load: () => ({ openai: Buffer.from('enc:x').toString('base64') }),
      save: () => saves++
    })
    expect(store.get('openai')).toBeNull()
    store.set('openai', 'sk-1')
    expect(store.get('openai')).toBe('sk-1')
    expect(saves).toBe(0)
    expect(store.encrypted()).toBe(false)
  })
})

describe('memoryKeyStore', () => {
  it('去空白、空字串刪除', () => {
    const s = memoryKeyStore({ openai: 'a' })
    expect(s.get('openai')).toBe('a')
    s.set('gemini', ' b ')
    expect(s.get('gemini')).toBe('b')
    s.set('openai', ' ')
    expect(s.get('openai')).toBeNull()
  })
})
