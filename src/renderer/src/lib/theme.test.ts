import { describe, expect, it } from 'vitest'
import { THEME_KEY, applyTheme, loadTheme, otherTheme, saveTheme } from './theme'

function memoryStore(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v)
  }
}

describe('theme', () => {
  it('預設淺色，記住切換後的選擇', () => {
    const store = memoryStore()
    expect(loadTheme(store)).toBe('light')
    saveTheme(store, 'dark')
    expect(store.getItem(THEME_KEY)).toBe('dark')
    expect(loadTheme(store)).toBe('dark')
  })

  it('無法存取儲存空間或值無效時回到淺色', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadTheme(broken)).toBe('light')
    expect(() => saveTheme(broken, 'dark')).not.toThrow()
    expect(loadTheme(null)).toBe('light')
    const store = memoryStore()
    store.setItem(THEME_KEY, 'purple')
    expect(loadTheme(store)).toBe('light')
  })

  it('applyTheme 設定 data-theme，otherTheme 互換', () => {
    const root = { dataset: {} as DOMStringMap }
    applyTheme(root, 'dark')
    expect(root.dataset.theme).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
    expect(otherTheme('light')).toBe('dark')
  })
})
