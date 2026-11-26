import { describe, expect, it } from 'vitest'
import { isIgnored, isNotePath, normalizeRel, titleFromPath } from './paths'

describe('normalizeRel', () => {
  it('normalizes slashes and redundant segments', () => {
    expect(normalizeRel('Journal\\2026-10-06.md')).toBe('Journal/2026-10-06.md')
    expect(normalizeRel('a/./b//c.md')).toBe('a/b/c.md')
    expect(normalizeRel('Folder/')).toBe('Folder')
  })

  it('rejects paths that escape the vault', () => {
    expect(() => normalizeRel('../outside.md')).toThrow()
    expect(() => normalizeRel('a/../../outside.md')).toThrow()
    expect(() => normalizeRel('/etc/passwd')).toThrow()
    expect(() => normalizeRel('C:/Windows')).toThrow()
    expect(() => normalizeRel('.')).toThrow()
    expect(() => normalizeRel('')).toThrow()
  })

  it('rejects hidden paths and .knowmon', () => {
    expect(() => normalizeRel('.knowmon/index.db')).toThrow()
    expect(() => normalizeRel('a/.git/config')).toThrow()
  })
})

describe('other helpers', () => {
  it('isNotePath accepts only .md', () => {
    expect(isNotePath('a.md')).toBe(true)
    expect(isNotePath('a.MD')).toBe(true)
    expect(isNotePath('a.txt')).toBe(false)
  })

  it('isIgnored skips hidden files at any level', () => {
    expect(isIgnored('.knowmon')).toBe(true)
    expect(isIgnored('a/.obsidian/x')).toBe(true)
    expect(isIgnored('a/b.md')).toBe(false)
  })

  it('titleFromPath takes the file name without the extension', () => {
    expect(titleFromPath('Journal/2026-10-06.md')).toBe('2026-10-06')
  })
})
