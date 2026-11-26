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
  it('defaults to light and remembers the chosen theme', () => {
    const store = memoryStore()
    expect(loadTheme(store)).toBe('light')
    saveTheme(store, 'dark')
    expect(store.getItem(THEME_KEY)).toBe('dark')
    expect(loadTheme(store)).toBe('dark')
  })

  it('falls back to light when storage is unavailable or the value is invalid', () => {
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

  it('applyTheme sets data-theme, and otherTheme swaps', () => {
    const root = { dataset: {} as DOMStringMap }
    applyTheme(root, 'dark')
    expect(root.dataset.theme).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
    expect(otherTheme('light')).toBe('dark')
  })
})
