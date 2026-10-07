import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../../shared/types'
import { fuzzyScore, rankNotes } from './fuzzy'

const note = (path: string, modifiedAt = 0): NoteSummary => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  eventDate: null,
  modifiedAt
})

describe('fuzzyScore', () => {
  it('不符合時回傳 null，空 query 為 0', () => {
    expect(fuzzyScore('xyz', '原子習慣')).toBeNull()
    expect(fuzzyScore('慣習', '原子習慣')).toBeNull()
    expect(fuzzyScore('', '任何')).toBe(0)
  })

  it('連續命中 > 零散命中，開頭命中 > 中間命中', () => {
    const contiguous = fuzzyScore('習慣', '原子習慣')!
    const scattered = fuzzyScore('原慣', '原子習慣')!
    expect(contiguous).toBeGreaterThan(scattered)
    expect(fuzzyScore('原子', '原子習慣')!).toBeGreaterThan(contiguous)
  })

  it('不分大小寫，忽略 query 中的空白', () => {
    expect(fuzzyScore('DW', 'deep work')).not.toBeNull()
    expect(fuzzyScore('deep work', 'DeepWork')).not.toBeNull()
  })

  it('分隔符號後的字首命中加分', () => {
    expect(fuzzyScore('dw', 'deep-work')!).toBeGreaterThan(fuzzyScore('dw', 'deepswork')!)
  })
})

describe('rankNotes', () => {
  const notes = [
    note('讀書筆記/原子習慣.md', 3),
    note('讀書筆記/深度工作.md', 1),
    note('日記/2026-10-06.md', 5),
    note('習慣/清單.md', 2)
  ]

  it('空 query：最近開啟的在前，其餘依修改時間', () => {
    expect(rankNotes(notes, '', ['讀書筆記/深度工作.md']).map((n) => n.path)).toEqual([
      '讀書筆記/深度工作.md',
      '日記/2026-10-06.md',
      '讀書筆記/原子習慣.md',
      '習慣/清單.md'
    ])
  })

  it('標題命中優先於只有路徑命中', () => {
    expect(rankNotes(notes, '習慣').map((n) => n.path)).toEqual([
      '讀書筆記/原子習慣.md',
      '習慣/清單.md'
    ])
  })

  it('可比對資料夾路徑', () => {
    expect(rankNotes(notes, '日記 10').map((n) => n.path)).toEqual(['日記/2026-10-06.md'])
  })

  it('limit 有效', () => {
    expect(rankNotes(notes, '', [], 2)).toHaveLength(2)
  })
})
