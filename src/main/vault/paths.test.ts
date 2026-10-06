import { describe, expect, it } from 'vitest'
import { isIgnored, isNotePath, normalizeRel, titleFromPath } from './paths'

describe('normalizeRel', () => {
  it('正規化斜線與多餘的片段', () => {
    expect(normalizeRel('日記\\2026-10-06.md')).toBe('日記/2026-10-06.md')
    expect(normalizeRel('a/./b//c.md')).toBe('a/b/c.md')
    expect(normalizeRel('資料夾/')).toBe('資料夾')
  })

  it('拒絕跳出 vault 的路徑', () => {
    expect(() => normalizeRel('../外面.md')).toThrow()
    expect(() => normalizeRel('a/../../外面.md')).toThrow()
    expect(() => normalizeRel('/etc/passwd')).toThrow()
    expect(() => normalizeRel('C:/Windows')).toThrow()
    expect(() => normalizeRel('.')).toThrow()
    expect(() => normalizeRel('')).toThrow()
  })

  it('拒絕隱藏路徑與 .knowmon', () => {
    expect(() => normalizeRel('.knowmon/index.db')).toThrow()
    expect(() => normalizeRel('a/.git/config')).toThrow()
  })
})

describe('其他工具', () => {
  it('isNotePath 只接受 .md', () => {
    expect(isNotePath('a.md')).toBe(true)
    expect(isNotePath('a.MD')).toBe(true)
    expect(isNotePath('a.txt')).toBe(false)
  })

  it('isIgnored 略過任一層的隱藏檔', () => {
    expect(isIgnored('.knowmon')).toBe(true)
    expect(isIgnored('a/.obsidian/x')).toBe(true)
    expect(isIgnored('a/b.md')).toBe(false)
  })

  it('titleFromPath 取檔名去掉副檔名', () => {
    expect(titleFromPath('日記/2026-10-06.md')).toBe('2026-10-06')
  })
})
