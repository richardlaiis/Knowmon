import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import { addTags, normalizeTag } from './tags'

const tagsOf = (content: string): unknown => matter(content, {}).data.tags

describe('addTags', () => {
  it('沒有 frontmatter 時在開頭加上', () => {
    const r = addTags('# 標題\n內文\n', ['回顧'])
    expect(r.content).toBe('---\ntags: [回顧]\n---\n# 標題\n內文\n')
    expect(r.before).toBe('')
    expect(r.after).toBe('---\ntags: [回顧]\n---\n')
    expect(r.added).toEqual(['回顧'])
  })

  it('flow 寫法：加在 ] 前面，保留原本的順序與其他欄位', () => {
    const src = '---\ndate: 2026-10-06\ntags: [日記, 開發]\nmood: 好 # 註解\n---\n內文'
    const r = addTags(src, ['回顧'])
    expect(r.content).toBe(
      '---\ndate: 2026-10-06\ntags: [日記, 開發, 回顧]\nmood: 好 # 註解\n---\n內文'
    )
    expect(tagsOf(r.content)).toEqual(['日記', '開發', '回顧'])
  })

  it('空的 flow 清單', () => {
    expect(addTags('---\ntags: []\n---\n', ['a']).content).toBe('---\ntags: [a]\n---\n')
  })

  it('區塊清單：照縮排加在最後一項後面', () => {
    const src = '---\ntags:\n  - 書\n  - 習慣\ntitle: x\n---\n'
    const r = addTags(src, ['回顧', '讀書'])
    expect(r.content).toBe('---\ntags:\n  - 書\n  - 習慣\n  - 回顧\n  - 讀書\ntitle: x\n---\n')
    expect(tagsOf(r.content)).toEqual(['書', '習慣', '回顧', '讀書'])
  })

  it('沒有縮排的區塊清單', () => {
    const r = addTags('---\ntags:\n- a\n---\n', ['b'])
    expect(r.content).toBe('---\ntags:\n- a\n- b\n---\n')
  })

  it('單一字串改寫成 flow 清單', () => {
    const r = addTags('---\ntags: 書\n---\n', ['回顧'])
    expect(r.content).toBe('---\ntags: [書, 回顧]\n---\n')
  })

  it('空值改寫成 flow 清單', () => {
    expect(addTags('---\ntags:\n---\n', ['a']).content).toBe('---\ntags: [a]\n---\n')
  })

  it('多行 flow 清單整項改寫', () => {
    const r = addTags('---\ntags: [\n  a,\n  b\n]\nx: 1\n---\n', ['c'])
    expect(r.content).toBe('---\ntags: [a, b, c]\nx: 1\n---\n')
  })

  it('有 frontmatter 但沒有 tags：加在結尾的 --- 前', () => {
    const r = addTags('---\ndate: 2026-10-06\n---\n內文', ['日記'])
    expect(r.content).toBe('---\ndate: 2026-10-06\ntags: [日記]\n---\n內文')
  })

  it('空的 frontmatter', () => {
    expect(addTags('---\n---\nx', ['a']).content).toBe('---\ntags: [a]\n---\nx')
  })

  it('已經有的標籤不重複（不分大小寫、# 前綴）', () => {
    const r = addTags('---\ntags: [Book, 習慣]\n---\n', ['#book', '習慣', '新', '新'])
    expect(r.added).toEqual(['新'])
    expect(r.content).toBe('---\ntags: [Book, 習慣, 新]\n---\n')
  })

  it('全部已存在時不修改', () => {
    const src = '---\ntags: [a]\n---\n'
    const r = addTags(src, ['A', '#a'])
    expect(r.added).toEqual([])
    expect(r.content).toBe(src)
    expect(r.after).toBe(r.before)
  })

  it('保留 CRLF', () => {
    const r = addTags('---\r\ntitle: x\r\n---\r\nbody\r\n', ['a'])
    expect(r.content).toBe('---\r\ntitle: x\r\ntags: [a]\r\n---\r\nbody\r\n')
  })

  it('特殊字元與數字加引號，解析回來仍是字串', () => {
    const r = addTags('---\ntags: [a]\n---\n', ['c++: 筆記', '2026', 'true'])
    expect(tagsOf(r.content)).toEqual(['a', 'c++:-筆記', '2026', 'true'])
  })

  it('frontmatter 損毀時拒絕修改', () => {
    expect(() => addTags('---\ntags: [a\nb: : :\n---\n', ['x'])).toThrow(/not valid YAML/)
  })

  it('內文中的 tags: 不受影響', () => {
    const src = '---\ntitle: x\n---\ntags: 這是內文\n'
    expect(addTags(src, ['a']).content).toBe('---\ntitle: x\ntags: [a]\n---\ntags: 這是內文\n')
  })
})

describe('normalizeTag', () => {
  it('去掉 #、空白換成 -', () => {
    expect(normalizeTag('  #讀書 筆記 ')).toBe('讀書-筆記')
    expect(normalizeTag('#')).toBe('')
  })
})
