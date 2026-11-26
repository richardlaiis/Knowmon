import { describe, expect, it } from 'vitest'
import { openDb, relinkWikilinks, setWikilinks, upsertNote, type DB } from '.'
import { getGraph } from './graph'
import { perfBudget } from './test-utils'

function note(db: DB, path: string, eventDate: string | null = null): number {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return upsertNote(db, { path, title, createdAt: 0, modifiedAt: 0, eventDate, contentHash: path })
}

describe('getGraph', () => {
  it('nodes are all notes and edges are resolved wikilinks; missing targets and self-links are left out', () => {
    const db = openDb(':memory:')
    const a = note(db, 'Welcome.md')
    const b = note(db, 'Books/Atomic Habits.md', '2025-12-20')
    note(db, 'Isolated.md')
    setWikilinks(db, a, [
      { target: 'Atomic Habits', count: 2 },
      { target: 'Not yet created', count: 1 },
      { target: 'Welcome', count: 1 }
    ])
    setWikilinks(db, b, [{ target: 'Welcome', count: 1 }])
    expect(getGraph(db)).toEqual({
      nodes: [
        {
          path: 'Books/Atomic Habits.md',
          title: 'Atomic Habits',
          eventDate: '2025-12-20',
          activeDays: []
        },
        { path: 'Isolated.md', title: 'Isolated', eventDate: null, activeDays: [] },
        { path: 'Welcome.md', title: 'Welcome', eventDate: null, activeDays: [] }
      ],
      edges: [
        { source: 'Books/Atomic Habits.md', target: 'Welcome.md', type: 'wikilink', weight: 1 },
        { source: 'Welcome.md', target: 'Books/Atomic Habits.md', type: 'wikilink', weight: 2 }
      ]
    })
  })

  it('different spellings resolving to the same note merge into one edge with summed weight', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    note(db, 'Folder/b.md')
    setWikilinks(db, a, [
      { target: 'b', count: 1 },
      { target: 'Folder/b', count: 2 }
    ])
    expect(getGraph(db).edges).toEqual([
      { source: 'a.md', target: 'Folder/b.md', type: 'wikilink', weight: 3 }
    ])
  })

  it('finishes within 200ms for 5000 notes and about 10,000 links', () => {
    const db = openDb(':memory:')
    const n = 5000
    db.transaction(() => {
      for (let i = 0; i < n; i++) note(db, `Folder${i % 20}/note${i}.md`)
    })()
    db.transaction(() => {
      for (let i = 1; i < n; i++) {
        setWikilinks(
          db,
          i + 1,
          [
            { target: `note${(i * 7919) % i}`, count: 1 },
            { target: `note${(i * 31) % n}`, count: 1 }
          ],
          () => null
        )
      }
    })()
    relinkWikilinks(db)
    const t = performance.now()
    const g = getGraph(db)
    const ms = performance.now() - t
    expect(g.nodes).toHaveLength(n)
    expect(g.edges.length).toBeGreaterThan(9000)
    expect(ms).toBeLessThan(perfBudget(200))
  })
})
