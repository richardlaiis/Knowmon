import { describe, expect, it } from 'vitest'
import { createKeyStore, memoryKeyStore, type SafeStorageLike } from './secrets'

/** A fake safeStorage: "encryption" = the reversed string with a prefix */
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
  it('saves encrypted and decrypts after reloading; no plain text in the file', () => {
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

  it('a failed decryption or bad format counts as no key; unknown providers are ignored', () => {
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

  it('Linux without a keyring (basic_text): still saved, but marked as not truly encrypted', () => {
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

  it('no encryption at all: keys stay in memory only and are not saved', () => {
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
  it('trims whitespace; an empty string deletes', () => {
    const s = memoryKeyStore({ openai: 'a' })
    expect(s.get('openai')).toBe('a')
    s.set('gemini', ' b ')
    expect(s.get('gemini')).toBe('b')
    s.set('openai', ' ')
    expect(s.get('openai')).toBeNull()
  })
})
