import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../shared/types'
import { openWikilinkQuery, wikilinkAt, wikilinkOptions } from './wikilinks'

const note = (path: string): NoteSummary => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  eventDate: null,
  modifiedAt: 0
})

describe('openWikilinkQuery', () => {
  it('游標在 [[ 之後時回傳已輸入的文字', () => {
    expect(openWikilinkQuery('見 [[')).toBe('')
    expect(openWikilinkQuery('見 [[原子')).toBe('原子')
    expect(openWikilinkQuery('[[a]] 與 [[b c')).toBe('b c')
  })

  it('連結已結束或已輸入 | # 時不補全', () => {
    expect(openWikilinkQuery('[[a]]')).toBeNull()
    expect(openWikilinkQuery('[[a|顯示')).toBeNull()
    expect(openWikilinkQuery('[[a#標題')).toBeNull()
    expect(openWikilinkQuery('[單括號')).toBeNull()
  })
})

describe('wikilinkAt', () => {
  const line = '見 [[原子習慣|書]] 與 [[深度工作#第二章]]'
  it('回傳點擊位置的連結目標', () => {
    expect(wikilinkAt(line, 3)).toBe('原子習慣')
    expect(wikilinkAt(line, 12)).toBe('原子習慣')
    expect(wikilinkAt(line, 20)).toBe('深度工作')
  })

  it('不在連結上或只有標題時回傳 null', () => {
    expect(wikilinkAt(line, 0)).toBeNull()
    expect(wikilinkAt('[[#標題]]', 3)).toBeNull()
  })
})

describe('wikilinkOptions', () => {
  const notes = [note('讀書筆記/原子習慣.md'), note('封存/原子習慣.md'), note('歡迎.md')]

  it('同名筆記插入帶資料夾的目標，並顯示所在資料夾', () => {
    expect(wikilinkOptions(notes, '原子')).toEqual([
      { label: '原子習慣', detail: '封存', text: '原子習慣' },
      { label: '原子習慣', detail: '讀書筆記', text: '讀書筆記/原子習慣' }
    ])
  })

  it('根目錄的筆記沒有資料夾說明', () => {
    expect(wikilinkOptions(notes, '歡迎')).toEqual([{ label: '歡迎', detail: '', text: '歡迎' }])
  })
})
