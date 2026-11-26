// Tab state (pure functions). A tab is a note, the global graph or the timeline; each note opens in at most one tab, and there is at most one graph tab and one timeline tab.
import { isWithin, remapPath } from '../lib/tree'

/** Tabs that exist at most once in the whole app (not notes) */
export type ViewKind = 'graph' | 'timeline'

export type Tab = { id: string; kind: 'note'; path: string } | { id: string; kind: ViewKind }

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
}

export const emptyTabs: TabsState = { tabs: [], activeId: null }

let idCounter = 0
/** Tab ids are only used within this run (never saved), so an incrementing number is enough */
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

/** The tab a note is in */
export function findNoteTab(s: TabsState, path: string): Tab | null {
  return s.tabs.find((t) => t.kind === 'note' && t.path === path) ?? null
}

/** Inserts to the right of the current tab and activates it */
function insertAfterActive(s: TabsState, tab: Tab): TabsState {
  const i = s.tabs.findIndex((t) => t.id === s.activeId)
  const tabs = [...s.tabs]
  tabs.splice(i < 0 ? tabs.length : i + 1, 0, tab)
  return { tabs, activeId: tab.id }
}

/**
 * Opens a note: switches to it if already open; opens a new tab with newTab or when there are no tabs; otherwise replaces the current tab.
 * A replaced tab gets a new id: views are keyed by id, so switching notes rebuilds the editor, while renames (renamePaths) keep the id and the editor.
 * makeId lets tests supply fixed ids.
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

/** Switches to the graph or timeline tab, opening one to the right if there is none */
export function openView(s: TabsState, kind: ViewKind, makeId: () => string = newTabId): TabsState {
  const existing = s.tabs.find((t) => t.kind === kind)
  if (existing) return existing.id === s.activeId ? s : { ...s, activeId: existing.id }
  return insertAfterActive(s, { id: makeId(), kind })
}

export function activate(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id) && s.activeId !== id ? { ...s, activeId: id } : s
}

/** Closes a tab; when it's the current tab, the one to the right is activated, or the left if none */
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

/** Switches to the next (delta = 1) or previous (-1) tab, wrapping around */
export function cycle(s: TabsState, delta: number): TabsState {
  if (s.tabs.length < 2) return s
  const i = s.tabs.findIndex((t) => t.id === s.activeId)
  const n = s.tabs.length
  return { ...s, activeId: s.tabs[(((i + delta) % n) + n) % n].id }
}

/** Drag to reorder: moves id to toIndex (counted before removal, matching where the tab bar drops it) */
export function moveTab(s: TabsState, id: string, toIndex: number): TabsState {
  const from = s.tabs.findIndex((t) => t.id === id)
  if (from < 0) return s
  const tabs = [...s.tabs]
  const [tab] = tabs.splice(from, 1)
  const to = Math.max(0, Math.min(from < toIndex ? toIndex - 1 : toIndex, tabs.length))
  tabs.splice(to, 0, tab)
  return tabs.every((t, i) => t === s.tabs[i]) ? s : { ...s, tabs }
}

/** Updates the paths of affected tabs after a note or folder is renamed/moved */
export function renamePaths(s: TabsState, from: string, to: string): TabsState {
  let changed = false
  const tabs = s.tabs.map((t): Tab => {
    if (t.kind !== 'note' || !isWithin(t.path, from)) return t
    changed = true
    return { ...t, path: remapPath(t.path, from, to) }
  })
  return changed ? { ...s, tabs } : s
}

/** Closes affected tabs after a note or folder is deleted */
export function removePaths(s: TabsState, path: string): TabsState {
  let next = s
  for (const t of s.tabs) {
    if (t.kind === 'note' && isWithin(t.path, path)) next = closeTab(next, t.id)
  }
  return next
}

/** Whether a mouse event asks for a new tab: Ctrl/Cmd+click or middle click */
export function wantsNewTab(e: { ctrlKey: boolean; metaKey: boolean; button?: number }): boolean {
  return e.ctrlKey || e.metaKey || e.button === 1
}

// ---- Saving and restoring ----

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
 * Restores tabs, skipping malformed entries, notes that no longer exist and duplicate tabs.
 * If the originally active tab is skipped, the nearest tab to its left becomes active.
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
