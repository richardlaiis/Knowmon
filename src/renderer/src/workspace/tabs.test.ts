import { describe, expect, it } from 'vitest'
import {
  activate,
  activeTab,
  closeOthers,
  closeTab,
  cycle,
  emptyTabs,
  moveTab,
  openView,
  openNote,
  removePaths,
  renamePaths,
  restoreTabs,
  serializeTabs,
  tabTitle,
  wantsNewTab,
  type TabsState
} from './tabs'

function ids(): () => string {
  let n = 0
  return () => `id${++n}`
}

/** 簡寫：列出分頁內容，目前的分頁加 * */
function show(s: TabsState): string[] {
  return s.tabs.map((t) => (t.kind === 'note' ? t.path : t.kind) + (t.id === s.activeId ? '*' : ''))
}

function build(...paths: string[]): TabsState {
  const id = ids()
  let s = emptyTabs
  for (const p of paths)
    s = p === 'graph' || p === 'timeline' ? openView(s, p, id) : openNote(s, p, true, id)
  return s
}

describe('openNote', () => {
  it('沒有分頁時開新分頁；之後取代目前的分頁（換新 id，讓編輯器重建）', () => {
    const id = ids()
    let s = openNote(emptyTabs, 'a.md', false, id)
    expect(show(s)).toEqual(['a.md*'])
    s = openNote(s, 'b.md', false, id)
    expect(show(s)).toEqual(['b.md*'])
    expect(s.tabs[0].id).toBe('id2')
  })

  it('newTab 時插在目前分頁右邊', () => {
    let s = build('a.md', 'b.md', 'c.md')
    s = activate(s, s.tabs[0].id)
    s = openNote(s, 'd.md', true, () => 'new')
    expect(show(s)).toEqual(['a.md', 'd.md*', 'b.md', 'c.md'])
  })

  it('已經開著就切過去，不重複開', () => {
    const s = build('a.md', 'b.md')
    const next = openNote(s, 'a.md', true)
    expect(show(next)).toEqual(['a.md*', 'b.md'])
    expect(openNote(next, 'a.md')).toBe(next)
  })

  it('圖譜分頁也會被取代', () => {
    const s = openNote(build('a.md', 'graph'), 'b.md')
    expect(show(s)).toEqual(['a.md', 'b.md*'])
  })
})

describe('openView', () => {
  it('最多一個圖譜分頁，已存在就切過去', () => {
    let s = build('a.md')
    s = openView(s, 'graph', () => 'g')
    expect(show(s)).toEqual(['a.md', 'graph*'])
    s = activate(s, s.tabs[0].id)
    s = openView(s, 'graph', () => 'g2')
    expect(show(s)).toEqual(['a.md', 'graph*'])
    expect(s.tabs[1].id).toBe('g')
  })

  it('時間軸分頁與圖譜分頁各自最多一個', () => {
    let s = build('a.md', 'graph')
    s = openView(s, 'timeline', () => 't')
    expect(show(s)).toEqual(['a.md', 'graph', 'timeline*'])
    s = openView(s, 'graph')
    s = openView(s, 'timeline', () => 't2')
    expect(show(s)).toEqual(['a.md', 'graph', 'timeline*'])
    expect(tabTitle(s.tabs[2])).toBe('Timeline')
  })
})

describe('closeTab', () => {
  it('關閉目前分頁後啟用右邊，沒有就左邊', () => {
    let s = build('a.md', 'b.md', 'c.md')
    s = activate(s, s.tabs[1].id)
    s = closeTab(s, s.tabs[1].id)
    expect(show(s)).toEqual(['a.md', 'c.md*'])
    s = closeTab(s, s.tabs[1].id)
    expect(show(s)).toEqual(['a.md*'])
    s = closeTab(s, s.tabs[0].id)
    expect(s).toEqual({ tabs: [], activeId: null })
  })

  it('關閉其他分頁不影響目前分頁', () => {
    const s = build('a.md', 'b.md', 'c.md')
    expect(show(closeTab(s, s.tabs[0].id))).toEqual(['b.md', 'c.md*'])
    expect(closeTab(s, 'nope')).toBe(s)
  })

  it('closeOthers 只留下指定分頁並啟用它', () => {
    const s = build('a.md', 'b.md', 'c.md')
    expect(show(closeOthers(s, s.tabs[0].id))).toEqual(['a.md*'])
  })
})

describe('cycle', () => {
  it('頭尾相接', () => {
    const s = build('a.md', 'b.md', 'c.md')
    expect(show(cycle(s, 1))).toEqual(['a.md*', 'b.md', 'c.md'])
    expect(show(cycle(s, -1))).toEqual(['a.md', 'b.md*', 'c.md'])
    const one = build('a.md')
    expect(cycle(one, 1)).toBe(one)
  })
})

describe('moveTab', () => {
  const s = build('a.md', 'b.md', 'c.md', 'd.md')
  const id = (i: number): string => s.tabs[i].id
  const order = (x: TabsState): string[] => show(x).map((p) => p.replace('*', ''))

  it('放到某個分頁前面', () => {
    expect(order(moveTab(s, id(0), 2))).toEqual(['b.md', 'a.md', 'c.md', 'd.md'])
    expect(order(moveTab(s, id(3), 0))).toEqual(['d.md', 'a.md', 'b.md', 'c.md'])
    expect(order(moveTab(s, id(1), 4))).toEqual(['a.md', 'c.md', 'd.md', 'b.md'])
  })

  it('位置沒變時回傳原本的狀態', () => {
    expect(moveTab(s, id(1), 1)).toBe(s)
    expect(moveTab(s, id(1), 2)).toBe(s)
    expect(moveTab(s, 'nope', 0)).toBe(s)
  })
})

describe('renamePaths / removePaths', () => {
  it('改名與資料夾搬移會更新分頁路徑，id 不變', () => {
    const s = build('日記/1.md', '日記/2.md', 'a.md')
    expect(renamePaths(s, '日記', '舊日記').tabs.map((t) => t.id)).toEqual(s.tabs.map((t) => t.id))
    expect(show(renamePaths(s, '日記', '舊日記'))).toEqual(['舊日記/1.md', '舊日記/2.md', 'a.md*'])
    expect(show(renamePaths(s, 'a.md', 'b.md'))).toEqual(['日記/1.md', '日記/2.md', 'b.md*'])
    expect(renamePaths(s, '不相關', 'x')).toBe(s)
  })

  it('刪除資料夾會關閉底下的分頁', () => {
    const s = build('a.md', '日記/1.md', '日記/2.md', 'graph')
    expect(show(removePaths(s, '日記'))).toEqual(['a.md', 'graph*'])
    const t = activate(s, s.tabs[1].id)
    expect(show(removePaths(t, '日記'))).toEqual(['a.md', 'graph*'])
  })
})

describe('serializeTabs / restoreTabs', () => {
  const exists = (p: string): boolean => p !== '已刪除.md'

  it('存檔後可以還原，啟用的分頁相同', () => {
    let s = build('a.md', 'graph', 'b.md')
    s = activate(s, s.tabs[1].id)
    const saved = JSON.parse(JSON.stringify(serializeTabs(s)))
    expect(saved).toEqual({
      tabs: [{ kind: 'note', path: 'a.md' }, { kind: 'graph' }, { kind: 'note', path: 'b.md' }],
      active: 1
    })
    expect(show(restoreTabs(saved, exists, ids()))).toEqual(['a.md', 'graph*', 'b.md'])
  })

  it('略過不存在的筆記與重複分頁；啟用的分頁被略過時改用左邊的', () => {
    const raw = {
      tabs: [
        { kind: 'note', path: 'a.md' },
        { kind: 'note', path: '已刪除.md' },
        { kind: 'note', path: 'a.md' },
        { kind: 'graph' },
        { kind: 'timeline' },
        { kind: 'graph' },
        { kind: 'timeline' }
      ],
      active: 1
    }
    expect(show(restoreTabs(raw, exists, ids()))).toEqual(['a.md*', 'graph', 'timeline'])
  })

  it('格式錯誤時回傳空的狀態', () => {
    for (const raw of [null, 'x', 42, {}, { tabs: 'x' }, { tabs: [{ kind: 'note' }, 5] }]) {
      const s = restoreTabs(raw, exists, ids())
      expect(s.tabs).toEqual([])
      expect(activeTab(s)).toBeNull()
    }
  })

  it('active 超出範圍時啟用最後一個留下的分頁', () => {
    const raw = {
      tabs: [
        { kind: 'note', path: 'a.md' },
        { kind: 'note', path: 'b.md' }
      ],
      active: 9
    }
    expect(show(restoreTabs(raw, exists, ids()))).toEqual(['a.md', 'b.md*'])
    const none = { tabs: [{ kind: 'note', path: 'a.md' }], active: -1 }
    expect(show(restoreTabs(none, exists, ids()))).toEqual(['a.md*'])
  })
})

describe('wantsNewTab', () => {
  it('Ctrl、Cmd 或中鍵', () => {
    expect(wantsNewTab({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: true, button: 0 })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: false, button: 1 })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: false, button: 0 })).toBe(false)
  })
})
