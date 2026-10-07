import { describe, expect, it } from 'vitest'
import { createLinkResolver, linkKey, linkTextFor, resolveLink, wikilinkTarget } from './links'

const paths = [
  '歡迎.md',
  '日記/2026-10-06.md',
  '專案/Knowmon/時間脈絡連結.md',
  '封存/專案/Knowmon/時間脈絡連結.md',
  'b/Note.md',
  'a/note.md',
  'English Note.md'
]

describe('resolveLink', () => {
  it('以檔名解析，忽略大小寫與 .md', () => {
    expect(resolveLink('歡迎', paths)).toBe('歡迎.md')
    expect(resolveLink('歡迎.md', paths)).toBe('歡迎.md')
    expect(resolveLink('english note', paths)).toBe('English Note.md')
    expect(resolveLink('2026-10-06', paths)).toBe('日記/2026-10-06.md')
  })

  it('同名時取路徑最短，再依字典序', () => {
    expect(resolveLink('時間脈絡連結', paths)).toBe('專案/Knowmon/時間脈絡連結.md')
    expect(resolveLink('NOTE', paths)).toBe('a/note.md')
  })

  it('含 / 的目標比對路徑結尾', () => {
    expect(resolveLink('封存/專案/Knowmon/時間脈絡連結', paths)).toBe(
      '封存/專案/Knowmon/時間脈絡連結.md'
    )
    expect(resolveLink('Knowmon/時間脈絡連結', paths)).toBe('專案/Knowmon/時間脈絡連結.md')
    expect(resolveLink('b/note', paths)).toBe('b/Note.md')
    expect(resolveLink('/b/note', paths)).toBe('b/Note.md')
    expect(resolveLink('jects/Knowmon/時間脈絡連結', paths)).toBeNull()
    expect(resolveLink('c/note', paths)).toBeNull()
  })

  it('找不到或空目標時回傳 null', () => {
    expect(resolveLink('尚未建立的筆記', paths)).toBeNull()
    expect(resolveLink('  ', paths)).toBeNull()
  })

  it('Unicode 正規化：NFD 的檔名也能用 NFC 的目標找到', () => {
    const resolve = createLinkResolver(['Café.md'.normalize('NFD')])
    expect(resolve('café')).toBe('Café.md'.normalize('NFD'))
    expect(linkKey('Café'.normalize('NFD'))).toBe('café')
  })
})

describe('linkTextFor', () => {
  const resolve = createLinkResolver(paths)

  it('能唯一解析時只用檔名', () => {
    expect(linkTextFor('日記/2026-10-06.md', resolve)).toBe('2026-10-06')
    expect(linkTextFor('專案/Knowmon/時間脈絡連結.md', resolve)).toBe('時間脈絡連結')
  })

  it('同名時加上資料夾直到能唯一解析', () => {
    expect(linkTextFor('封存/專案/Knowmon/時間脈絡連結.md', resolve)).toBe(
      '封存/專案/Knowmon/時間脈絡連結'
    )
    expect(linkTextFor('b/Note.md', resolve)).toBe('b/Note')
  })
})

describe('wikilinkTarget', () => {
  it('去掉顯示文字、標題與 .md', () => {
    expect(wikilinkTarget('a|顯示')).toBe('a')
    expect(wikilinkTarget(' b.md #標題 | x')).toBe('b')
    expect(wikilinkTarget('#只有標題')).toBe('')
  })
})
