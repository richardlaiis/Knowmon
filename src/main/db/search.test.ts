import { describe, expect, it } from 'vitest'
import { openDb, setNoteBody, upsertNote, type DB } from '.'
import { searchNotes, searchTerms, snippet } from './search'

function seed(): DB {
  const db = openDb(':memory:')
  const notes: [string, string, number][] = [
    ['讀書筆記/原子習慣.md', '# 原子習慣\n讓習慣有吸引力，讓行動輕而易舉。', 1],
    ['讀書筆記/深度工作.md', '# 深度工作\n專注是稀缺資源。參考原子習慣建立每日深度工作時段。', 2],
    ['English note.md', 'Mixed-language search test: 中英混合 search 測試。Deep Work is good.', 3],
    ['日記/2026-10-06.md', '今天完成了骨架，100% 完成_度', 4],
    ['習慣養成.md', '標題命中的筆記', 0]
  ]
  for (const [path, body, t] of notes) {
    const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const id = upsertNote(db, {
      path,
      title,
      createdAt: t,
      modifiedAt: t,
      eventDate: null,
      contentHash: path
    })
    setNoteBody(db, id, title, body)
  }
  return db
}

const paths = (db: DB, q: string): string[] => searchNotes(db, q).map((h) => h.path)

describe('searchNotes', () => {
  it('3 字以上的中文詞走 trigram，標題命中排前面', () => {
    const db = seed()
    expect(paths(db, '原子習慣')).toEqual(['讀書筆記/原子習慣.md', '讀書筆記/深度工作.md'])
    expect(paths(db, '稀缺資源')).toEqual(['讀書筆記/深度工作.md'])
  })

  it('2 字中文詞也找得到（trigram 無法比對，改用 LIKE）', () => {
    const db = seed()
    // 標題命中的排前面，其次依最近修改
    expect(paths(db, '習慣')).toEqual([
      '讀書筆記/原子習慣.md',
      '習慣養成.md',
      '讀書筆記/深度工作.md'
    ])
    expect(paths(db, '專注')).toEqual(['讀書筆記/深度工作.md'])
    expect(paths(db, '茶')).toEqual([])
  })

  it('英文不分大小寫，中英混合', () => {
    const db = seed()
    expect(paths(db, 'deep work')).toEqual(['English note.md'])
    expect(paths(db, 'SEARCH 中英混合')).toEqual(['English note.md'])
    expect(paths(db, 'english')).toEqual(['English note.md'])
  })

  it('多個詞需全部出現（AND），長短詞可混用', () => {
    const db = seed()
    expect(paths(db, '習慣 專注')).toEqual(['讀書筆記/深度工作.md'])
    expect(paths(db, '原子習慣 每日')).toEqual(['讀書筆記/深度工作.md'])
    expect(paths(db, '原子習慣 不存在的詞')).toEqual([])
  })

  it('特殊字元不會造成語法錯誤或被當成萬用字元', () => {
    const db = seed()
    expect(paths(db, '100%')).toEqual(['日記/2026-10-06.md'])
    expect(paths(db, '_度')).toEqual(['日記/2026-10-06.md'])
    expect(paths(db, '%')).toEqual(['日記/2026-10-06.md'])
    expect(paths(db, '"引號" AND OR NOT *')).toEqual([])
    expect(paths(db, '(')).toEqual([])
  })

  it('空白查詢回傳空陣列，limit 有效', () => {
    const db = seed()
    expect(searchNotes(db, '   ')).toEqual([])
    expect(searchNotes(db, '習慣', 1)).toHaveLength(1)
  })

  it('結果附上命中位置的摘要', () => {
    const db = seed()
    const [hit] = searchNotes(db, '稀缺')
    expect(hit).toMatchObject({ path: '讀書筆記/深度工作.md', title: '深度工作' })
    expect(hit.snippet).toEqual([
      { text: '# 深度工作 專注是', match: false },
      { text: '稀缺', match: true },
      { text: '資源。參考原子習慣建立每日深度工作時段。', match: false }
    ])
  })
})

describe('searchTerms', () => {
  it('依空白切詞並去重（不分大小寫）', () => {
    expect(searchTerms('  Deep  deep 習慣\t習慣 ')).toEqual(['Deep', '習慣'])
  })
})

describe('snippet', () => {
  it('長內文只取第一個命中附近，前後加上…', () => {
    const body = 'a'.repeat(300) + '關鍵字' + 'b'.repeat(300)
    const s = snippet(body, ['關鍵字'])
    expect(s[0].text.startsWith('…')).toBe(true)
    expect(s[1]).toEqual({ text: '關鍵字', match: true })
    expect(s[2].text.endsWith('…')).toBe(true)
    expect(s.map((x) => x.text).join('').length).toBeLessThanOrEqual(162)
  })

  it('只有標題命中時取內文開頭，連續空白壓成一個', () => {
    expect(snippet('\n\n\n第一行\n\n第二行', ['標題'])).toEqual([
      { text: '第一行 第二行', match: false }
    ])
  })

  it('多個詞都會標記', () => {
    expect(snippet('Deep work and deep focus', ['deep', 'FOCUS'])).toEqual([
      { text: 'Deep', match: true },
      { text: ' work and ', match: false },
      { text: 'deep', match: true },
      { text: ' ', match: false },
      { text: 'focus', match: true }
    ])
  })
})
