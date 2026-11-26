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
  it('resolves by file name, ignoring case and .md', () => {
    expect(resolveLink('歡迎', paths)).toBe('歡迎.md')
    expect(resolveLink('歡迎.md', paths)).toBe('歡迎.md')
    expect(resolveLink('english note', paths)).toBe('English Note.md')
    expect(resolveLink('2026-10-06', paths)).toBe('日記/2026-10-06.md')
  })

  it('on a name clash, takes the shortest path, then lexicographic order', () => {
    expect(resolveLink('時間脈絡連結', paths)).toBe('專案/Knowmon/時間脈絡連結.md')
    expect(resolveLink('NOTE', paths)).toBe('a/note.md')
  })

  it('a target containing / matches the end of a path', () => {
    expect(resolveLink('封存/專案/Knowmon/時間脈絡連結', paths)).toBe(
      '封存/專案/Knowmon/時間脈絡連結.md'
    )
    expect(resolveLink('Knowmon/時間脈絡連結', paths)).toBe('專案/Knowmon/時間脈絡連結.md')
    expect(resolveLink('b/note', paths)).toBe('b/Note.md')
    expect(resolveLink('/b/note', paths)).toBe('b/Note.md')
    expect(resolveLink('jects/Knowmon/時間脈絡連結', paths)).toBeNull()
    expect(resolveLink('c/note', paths)).toBeNull()
  })

  it('returns null when not found or for an empty target', () => {
    expect(resolveLink('尚未建立的筆記', paths)).toBeNull()
    expect(resolveLink('  ', paths)).toBeNull()
  })

  it('Unicode normalization: an NFD file name is found by an NFC target', () => {
    const resolve = createLinkResolver(['Café.md'.normalize('NFD')])
    expect(resolve('café')).toBe('Café.md'.normalize('NFD'))
    expect(linkKey('Café'.normalize('NFD'))).toBe('café')
  })
})

describe('linkTextFor', () => {
  const resolve = createLinkResolver(paths)

  it('uses just the file name when it resolves uniquely', () => {
    expect(linkTextFor('日記/2026-10-06.md', resolve)).toBe('2026-10-06')
    expect(linkTextFor('專案/Knowmon/時間脈絡連結.md', resolve)).toBe('時間脈絡連結')
  })

  it('adds folders on a name clash until it resolves uniquely', () => {
    expect(linkTextFor('封存/專案/Knowmon/時間脈絡連結.md', resolve)).toBe(
      '封存/專案/Knowmon/時間脈絡連結'
    )
    expect(linkTextFor('b/Note.md', resolve)).toBe('b/Note')
  })
})

describe('wikilinkTarget', () => {
  it('strips the label, heading and .md', () => {
    expect(wikilinkTarget('a|顯示')).toBe('a')
    expect(wikilinkTarget(' b.md #標題 | x')).toBe('b')
    expect(wikilinkTarget('#只有標題')).toBe('')
  })

  it('\\| inside a table also separates the label', () => {
    expect(wikilinkTarget('筆記\\|文字')).toBe('筆記')
    expect(wikilinkTarget('b.md#標題 \\| x')).toBe('b')
  })
})
