import { describe, expect, it } from 'vitest'
import { EMPTY_STATE_HINTS, isMacPlatform, splitKeys } from './shortcutHints'

describe('splitKeys', () => {
  it('splits on +', () => {
    expect(splitKeys('Ctrl+Shift+F', false)).toEqual(['Ctrl', 'Shift', 'F'])
  })

  it('shows Ctrl as ⌘ on macOS', () => {
    expect(splitKeys('Ctrl+Shift+F', true)).toEqual(['⌘', 'Shift', 'F'])
  })

  it('ignores stray spaces and empty parts', () => {
    expect(splitKeys(' Ctrl + O ', false)).toEqual(['Ctrl', 'O'])
  })
})

describe('isMacPlatform', () => {
  it('detects macOS user agents', () => {
    expect(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true)
    expect(isMacPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })
})

describe('EMPTY_STATE_HINTS', () => {
  it('has unique shortcuts', () => {
    const keys = EMPTY_STATE_HINTS.map((h) => h.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
