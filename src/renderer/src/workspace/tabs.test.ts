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

/** Shorthand: lists the tab contents, with * on the current tab */
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
  it('opens a new tab when there are none; afterwards replaces the current tab (with a new id, so the editor is rebuilt)', () => {
    const id = ids()
    let s = openNote(emptyTabs, 'a.md', false, id)
    expect(show(s)).toEqual(['a.md*'])
    s = openNote(s, 'b.md', false, id)
    expect(show(s)).toEqual(['b.md*'])
    expect(s.tabs[0].id).toBe('id2')
  })

  it('newTab inserts to the right of the current tab', () => {
    let s = build('a.md', 'b.md', 'c.md')
    s = activate(s, s.tabs[0].id)
    s = openNote(s, 'd.md', true, () => 'new')
    expect(show(s)).toEqual(['a.md', 'd.md*', 'b.md', 'c.md'])
  })

  it('switches to a note that is already open instead of opening it twice', () => {
    const s = build('a.md', 'b.md')
    const next = openNote(s, 'a.md', true)
    expect(show(next)).toEqual(['a.md*', 'b.md'])
    expect(openNote(next, 'a.md')).toBe(next)
  })

  it('the graph tab can be replaced too', () => {
    const s = openNote(build('a.md', 'graph'), 'b.md')
    expect(show(s)).toEqual(['a.md', 'b.md*'])
  })
})

describe('openView', () => {
  it('at most one graph tab; switches to it if it exists', () => {
    let s = build('a.md')
    s = openView(s, 'graph', () => 'g')
    expect(show(s)).toEqual(['a.md', 'graph*'])
    s = activate(s, s.tabs[0].id)
    s = openView(s, 'graph', () => 'g2')
    expect(show(s)).toEqual(['a.md', 'graph*'])
    expect(s.tabs[1].id).toBe('g')
  })

  it('at most one timeline tab and one graph tab', () => {
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
  it('closing the current tab activates the one to the right, or the left if none', () => {
    let s = build('a.md', 'b.md', 'c.md')
    s = activate(s, s.tabs[1].id)
    s = closeTab(s, s.tabs[1].id)
    expect(show(s)).toEqual(['a.md', 'c.md*'])
    s = closeTab(s, s.tabs[1].id)
    expect(show(s)).toEqual(['a.md*'])
    s = closeTab(s, s.tabs[0].id)
    expect(s).toEqual({ tabs: [], activeId: null })
  })

  it('closing another tab does not affect the current tab', () => {
    const s = build('a.md', 'b.md', 'c.md')
    expect(show(closeTab(s, s.tabs[0].id))).toEqual(['b.md', 'c.md*'])
    expect(closeTab(s, 'nope')).toBe(s)
  })

  it('closeOthers keeps only the given tab and activates it', () => {
    const s = build('a.md', 'b.md', 'c.md')
    expect(show(closeOthers(s, s.tabs[0].id))).toEqual(['a.md*'])
  })
})

describe('cycle', () => {
  it('wraps around at both ends', () => {
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

  it('drops before a given tab', () => {
    expect(order(moveTab(s, id(0), 2))).toEqual(['b.md', 'a.md', 'c.md', 'd.md'])
    expect(order(moveTab(s, id(3), 0))).toEqual(['d.md', 'a.md', 'b.md', 'c.md'])
    expect(order(moveTab(s, id(1), 4))).toEqual(['a.md', 'c.md', 'd.md', 'b.md'])
  })

  it('returns the original state when the position is unchanged', () => {
    expect(moveTab(s, id(1), 1)).toBe(s)
    expect(moveTab(s, id(1), 2)).toBe(s)
    expect(moveTab(s, 'nope', 0)).toBe(s)
  })
})

describe('renamePaths / removePaths', () => {
  it('renames and folder moves update tab paths, keeping ids', () => {
    const s = build('Journal/1.md', 'Journal/2.md', 'a.md')
    expect(renamePaths(s, 'Journal', 'Old journal').tabs.map((t) => t.id)).toEqual(
      s.tabs.map((t) => t.id)
    )
    expect(show(renamePaths(s, 'Journal', 'Old journal'))).toEqual([
      'Old journal/1.md',
      'Old journal/2.md',
      'a.md*'
    ])
    expect(show(renamePaths(s, 'a.md', 'b.md'))).toEqual(['Journal/1.md', 'Journal/2.md', 'b.md*'])
    expect(renamePaths(s, 'unrelated', 'x')).toBe(s)
  })

  it('deleting a folder closes the tabs under it', () => {
    const s = build('a.md', 'Journal/1.md', 'Journal/2.md', 'graph')
    expect(show(removePaths(s, 'Journal'))).toEqual(['a.md', 'graph*'])
    const t = activate(s, s.tabs[1].id)
    expect(show(removePaths(t, 'Journal'))).toEqual(['a.md', 'graph*'])
  })
})

describe('serializeTabs / restoreTabs', () => {
  const exists = (p: string): boolean => p !== 'Deleted.md'

  it('restores after saving, with the same active tab', () => {
    let s = build('a.md', 'graph', 'b.md')
    s = activate(s, s.tabs[1].id)
    const saved = JSON.parse(JSON.stringify(serializeTabs(s)))
    expect(saved).toEqual({
      tabs: [{ kind: 'note', path: 'a.md' }, { kind: 'graph' }, { kind: 'note', path: 'b.md' }],
      active: 1
    })
    expect(show(restoreTabs(saved, exists, ids()))).toEqual(['a.md', 'graph*', 'b.md'])
  })

  it('skips missing notes and duplicate tabs; when the active tab is skipped, the one to its left is used', () => {
    const raw = {
      tabs: [
        { kind: 'note', path: 'a.md' },
        { kind: 'note', path: 'Deleted.md' },
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

  it('returns an empty state for malformed data', () => {
    for (const raw of [null, 'x', 42, {}, { tabs: 'x' }, { tabs: [{ kind: 'note' }, 5] }]) {
      const s = restoreTabs(raw, exists, ids())
      expect(s.tabs).toEqual([])
      expect(activeTab(s)).toBeNull()
    }
  })

  it('activates the last remaining tab when active is out of range', () => {
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
  it('Ctrl, Cmd or middle click', () => {
    expect(wantsNewTab({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: true, button: 0 })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: false, button: 1 })).toBe(true)
    expect(wantsNewTab({ ctrlKey: false, metaKey: false, button: 0 })).toBe(false)
  })
})
