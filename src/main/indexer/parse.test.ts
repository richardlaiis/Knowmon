import { describe, expect, it } from 'vitest'
import { countLinks, dateFromFilename, dateFromFrontmatter, extractWikilinks, parseNote } from '.'

const targets = (text: string): string[] => extractWikilinks(text).map((l) => l.target)

describe('parseNote', () => {
  it('解析 frontmatter，內文以空行取代 frontmatter 讓行號一致', () => {
    const content =
      '---\ntitle: 原子習慣\ndate: 2025-12-20\ntags: [書]\n---\n# 原子習慣\n見 [[深度工作]]'
    const p = parseNote('讀書筆記/原子習慣.md', content)
    expect(p.frontmatter).toMatchObject({ title: '原子習慣', tags: ['書'] })
    expect(p.eventDate).toBe('2025-12-20')
    expect(p.body).toBe('\n\n\n\n\n# 原子習慣\n見 [[深度工作]]')
    expect(p.links).toEqual([{ target: '深度工作', line: 7, from: 2, to: 10 }])
  })

  it('沒有 frontmatter 時整份都是內文', () => {
    const p = parseNote('a.md', '# a\n[[b]]')
    expect(p.frontmatter).toEqual({})
    expect(p.body).toBe('# a\n[[b]]')
    expect(p.eventDate).toBeNull()
  })

  it('YAML 損毀時當作沒有 frontmatter，但仍解析內文', () => {
    const p = parseNote('a.md', '---\ndate: [壞掉\n---\n[[b]]')
    expect(p.frontmatter).toEqual({})
    expect(p.links.map((l) => l.target)).toEqual(['b'])
  })

  it('frontmatter 裡的 [[ ]] 不算連結', () => {
    const p = parseNote('a.md', '---\nrelated: "[[x]]"\n---\n[[y]]')
    expect(p.links.map((l) => l.target)).toEqual(['y'])
    expect(p.frontmatter.related).toBe('[[x]]')
  })

  it('未閉合的 --- 不是 frontmatter', () => {
    const p = parseNote('a.md', '---\n[[a]]\n內文')
    expect(p.body).toBe('---\n[[a]]\n內文')
    expect(p.links).toHaveLength(1)
  })

  it('frontmatter date 優先於日記檔名', () => {
    expect(parseNote('日記/2026-10-06.md', '---\ndate: 2026-01-02\n---\n').eventDate).toBe(
      '2026-01-02'
    )
    expect(parseNote('日記/2026-10-06.md', '今天').eventDate).toBe('2026-10-06')
    expect(parseNote('日記/2026-10-06.md', '---\ndate: 不是日期\n---\n').eventDate).toBe(
      '2026-10-06'
    )
  })

  it('支援 CRLF', () => {
    const p = parseNote('a.md', '---\r\ndate: 2026-10-01\r\n---\r\n[[b]]\r\n')
    expect(p.eventDate).toBe('2026-10-01')
    expect(p.links[0]).toMatchObject({ target: 'b', line: 4 })
  })
})

describe('extractWikilinks', () => {
  it('支援顯示文字、標題、嵌入與 .md 副檔名', () => {
    expect(targets('[[a|顯示]] [[b#標題]] ![[c.png]] [[d.md]] [[e#標題|顯示]] [[ f ]]')).toEqual([
      'a',
      'b',
      'c.png',
      'd',
      'e',
      'f'
    ])
  })

  it('略過只連到自己標題的連結與空連結', () => {
    expect(targets('[[#標題]] [[|x]] [[]]')).toEqual([])
  })

  it('記錄行號與位置，包含嵌入的 !', () => {
    expect(extractWikilinks('第一行\n前文 ![[圖]] 與 [[筆記]]')).toEqual([
      { target: '圖', line: 2, from: 3, to: 9 },
      { target: '筆記', line: 2, from: 12, to: 18 }
    ])
  })

  it('略過圍欄程式碼區塊與行內程式碼', () => {
    const text = [
      '[[a]] `[[b]]` ``x [[c]] `` [[d]]',
      '````md',
      '[[e]]',
      '```',
      '[[f]]',
      '`````',
      '[[g]]',
      '~~~',
      '[[h]]',
      '```',
      '~~~',
      '[[i]]'
    ].join('\n')
    expect(targets(text)).toEqual(['a', 'd', 'g', 'i'])
  })

  it('未閉合的程式碼區塊延續到文件結尾', () => {
    expect(targets('[[a]]\n```\n[[b]]')).toEqual(['a'])
  })

  it('不跨行、不接受巢狀括號', () => {
    expect(targets('[[a\nb]] [[x[y]]')).toEqual([])
  })
})

describe('countLinks', () => {
  it('同一目標不分大小寫合併計數，保留第一次的寫法', () => {
    const links = extractWikilinks('[[Note]] [[note]] [[NOTE|x]] [[其他]]')
    expect(countLinks(links)).toEqual([
      { target: 'Note', count: 3 },
      { target: '其他', count: 1 }
    ])
  })
})

describe('日期', () => {
  it('frontmatter：YAML 日期、各種分隔符號與含時間的字串', () => {
    expect(dateFromFrontmatter(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026/10/1')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026.10.01')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026-10-01T09:30:00+08:00')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026-10-01 會議')).toBe('2026-10-01')
  })

  it('frontmatter：不合法的日期與其他型別', () => {
    expect(dateFromFrontmatter('2026-02-30')).toBeNull()
    expect(dateFromFrontmatter('2026-13-01')).toBeNull()
    expect(dateFromFrontmatter('20261001')).toBeNull()
    expect(dateFromFrontmatter(20261001)).toBeNull()
    expect(dateFromFrontmatter(new Date(NaN))).toBeNull()
    expect(dateFromFrontmatter(undefined)).toBeNull()
  })

  it('YAML 解析出的日期與含時間的日期', () => {
    expect(parseNote('a.md', '---\ndate: 2026-10-01\n---\n').eventDate).toBe('2026-10-01')
    expect(parseNote('a.md', '---\ndate: 2026-10-01 10:00:00\n---\n').eventDate).toBe('2026-10-01')
    expect(parseNote('a.md', "---\ndate: '2026/10/01'\n---\n").eventDate).toBe('2026-10-01')
  })

  it('日記檔名', () => {
    expect(dateFromFilename('日記/2026-10-06.md')).toBe('2026-10-06')
    expect(dateFromFilename('2026-10-06 會議.md')).toBe('2026-10-06')
    expect(dateFromFilename('2026-10-061.md')).toBeNull()
    expect(dateFromFilename('2026-02-30.md')).toBeNull()
    expect(dateFromFilename('會議 2026-10-06.md')).toBeNull()
    expect(dateFromFilename('2026-10-06/筆記.md')).toBeNull()
  })
})
