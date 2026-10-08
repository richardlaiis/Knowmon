// 分頁狀態（純函式）。分頁是筆記、全域圖譜或時間軸；同一篇筆記只開一個分頁，圖譜與時間軸分頁各最多一個。
import { isWithin, remapPath } from '../lib/tree'

/** 全 App 只會有一個的分頁（不是筆記） */
export type ViewKind = 'graph' | 'timeline'

export type Tab = { id: string; kind: 'note'; path: string } | { id: string; kind: ViewKind }

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
}

export const emptyTabs: TabsState = { tabs: [], activeId: null }

let idCounter = 0
/** 分頁 id 只在這次執行中使用（不存檔），用遞增數字即可 */
export function newTabId(): string {
  return `t${++idCounter}`
}

export function tabTitle(tab: Tab): string {
  if (tab.kind !== 'note') return tab.kind === 'graph' ? 'Graph' : 'Timeline'
  return tab.path.slice(tab.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
}

export function activeTab(s: TabsState): Tab | null {
  return s.tabs.find((t) => t.id === s.activeId) ?? null
}

/** 筆記所在的分頁 */
export function findNoteTab(s: TabsState, path: string): Tab | null {
  return s.tabs.find((t) => t.kind === 'note' && t.path === path) ?? null
}

/** 在目前分頁右邊插入並啟用 */
function insertAfterActive(s: TabsState, tab: Tab): TabsState {
  const i = s.tabs.findIndex((t) => t.id === s.activeId)
  const tabs = [...s.tabs]
  tabs.splice(i < 0 ? tabs.length : i + 1, 0, tab)
  return { tabs, activeId: tab.id }
}

/**
 * 開啟筆記：已開著就切過去；newTab 或還沒有分頁時開新分頁；否則取代目前的分頁。
 * 取代時分頁換一個新 id：畫面以 id 作為 key，換筆記時編輯器重建；改名（renamePaths）則保留 id 與編輯器。
 * makeId 方便測試時給固定 id。
 */
export function openNote(
  s: TabsState,
  path: string,
  newTab = false,
  makeId: () => string = newTabId
): TabsState {
  const existing = findNoteTab(s, path)
  if (existing) return existing.id === s.activeId ? s : { ...s, activeId: existing.id }
  const current = activeTab(s)
  if (newTab || !current) return insertAfterActive(s, { id: makeId(), kind: 'note', path })
  const id = makeId()
  return {
    tabs: s.tabs.map((t) => (t.id === current.id ? { id, kind: 'note', path } : t)),
    activeId: id
  }
}

/** 切到圖譜或時間軸分頁，沒有就在右邊開一個 */
export function openView(s: TabsState, kind: ViewKind, makeId: () => string = newTabId): TabsState {
  const existing = s.tabs.find((t) => t.kind === kind)
  if (existing) return existing.id === s.activeId ? s : { ...s, activeId: existing.id }
  return insertAfterActive(s, { id: makeId(), kind })
}

export function activate(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id) && s.activeId !== id ? { ...s, activeId: id } : s
}

/** 關閉分頁；關的是目前分頁時改為啟用右邊的分頁，沒有就左邊 */
export function closeTab(s: TabsState, id: string): TabsState {
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  if (s.activeId !== id) return { ...s, tabs }
  const next = tabs[i] ?? tabs[i - 1] ?? null
  return { tabs, activeId: next ? next.id : null }
}

export function closeOthers(s: TabsState, id: string): TabsState {
  const keep = s.tabs.find((t) => t.id === id)
  return keep ? { tabs: [keep], activeId: keep.id } : s
}

/** 依序切換到下一個（delta = 1）或上一個（-1）分頁，頭尾相接 */
export function cycle(s: TabsState, delta: number): TabsState {
  if (s.tabs.length < 2) return s
  const i = s.tabs.findIndex((t) => t.id === s.activeId)
  const n = s.tabs.length
  return { ...s, activeId: s.tabs[(((i + delta) % n) + n) % n].id }
}

/** 拖曳排序：把 id 移到 toIndex（以移除前的位置計算，與分頁列的放置位置一致） */
export function moveTab(s: TabsState, id: string, toIndex: number): TabsState {
  const from = s.tabs.findIndex((t) => t.id === id)
  if (from < 0) return s
  const tabs = [...s.tabs]
  const [tab] = tabs.splice(from, 1)
  const to = Math.max(0, Math.min(from < toIndex ? toIndex - 1 : toIndex, tabs.length))
  tabs.splice(to, 0, tab)
  return tabs.every((t, i) => t === s.tabs[i]) ? s : { ...s, tabs }
}

/** 筆記或資料夾改名／搬移後，更新受影響分頁的路徑 */
export function renamePaths(s: TabsState, from: string, to: string): TabsState {
  let changed = false
  const tabs = s.tabs.map((t): Tab => {
    if (t.kind !== 'note' || !isWithin(t.path, from)) return t
    changed = true
    return { ...t, path: remapPath(t.path, from, to) }
  })
  return changed ? { ...s, tabs } : s
}

/** 筆記或資料夾被刪除後，關閉受影響的分頁 */
export function removePaths(s: TabsState, path: string): TabsState {
  let next = s
  for (const t of s.tabs) {
    if (t.kind === 'note' && isWithin(t.path, path)) next = closeTab(next, t.id)
  }
  return next
}

/** 滑鼠事件是否要求開新分頁：Ctrl/Cmd+點擊或中鍵 */
export function wantsNewTab(e: { ctrlKey: boolean; metaKey: boolean; button?: number }): boolean {
  return e.ctrlKey || e.metaKey || e.button === 1
}

// ---- 存檔與還原 ----

type SavedTab = { kind: 'note'; path: string } | { kind: ViewKind }

export interface SavedTabs {
  tabs: SavedTab[]
  active: number
}

export function serializeTabs(s: TabsState): SavedTabs {
  return {
    tabs: s.tabs.map((t): SavedTab =>
      t.kind === 'note' ? { kind: 'note', path: t.path } : { kind: t.kind }
    ),
    active: s.tabs.findIndex((t) => t.id === s.activeId)
  }
}

/**
 * 還原分頁：略過格式錯誤、已不存在的筆記、重複的分頁。
 * 原本啟用的分頁被略過時，改為啟用它左邊最近的分頁。
 */
export function restoreTabs(
  raw: unknown,
  exists: (path: string) => boolean,
  makeId: () => string = newTabId
): TabsState {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as SavedTabs).tabs)) return emptyTabs
  const saved = raw as SavedTabs
  const tabs: Tab[] = []
  let activeId: string | null = null
  const seen = new Set<string>()
  saved.tabs.forEach((t, i) => {
    let tab: Tab | null = null
    if (t && (t.kind === 'graph' || t.kind === 'timeline') && !seen.has(t.kind)) {
      seen.add(t.kind)
      tab = { id: makeId(), kind: t.kind }
    } else if (t && t.kind === 'note' && typeof t.path === 'string' && exists(t.path)) {
      if (!seen.has('note:' + t.path)) {
        seen.add('note:' + t.path)
        tab = { id: makeId(), kind: 'note', path: t.path }
      }
    }
    if (tab) tabs.push(tab)
    if (i <= saved.active && tabs.length) activeId = tabs[tabs.length - 1].id
  })
  if (activeId === null && tabs.length) activeId = tabs[0].id
  return { tabs, activeId }
}
