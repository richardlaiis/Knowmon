import { describe, expect, it } from 'vitest'
import { openDb, relinkWikilinks, setWikilinks, upsertNote, type DB } from '.'
import { getGraph } from './graph'

function note(db: DB, path: string, eventDate: string | null = null): number {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return upsertNote(db, { path, title, createdAt: 0, modifiedAt: 0, eventDate, contentHash: path })
}

describe('getGraph', () => {
  it('節點為所有筆記，邊為已解析的 wikilink；未建立的目標與自我連結不列入', () => {
    const db = openDb(':memory:')
    const a = note(db, '歡迎.md')
    const b = note(db, '讀書筆記/原子習慣.md', '2025-12-20')
    note(db, '孤立.md')
    setWikilinks(db, a, [
      { target: '原子習慣', count: 2 },
      { target: '尚未建立', count: 1 },
      { target: '歡迎', count: 1 }
    ])
    setWikilinks(db, b, [{ target: '歡迎', count: 1 }])
    expect(getGraph(db)).toEqual({
      nodes: [
        { path: '孤立.md', title: '孤立', eventDate: null, activeDays: [] },
        { path: '歡迎.md', title: '歡迎', eventDate: null, activeDays: [] },
        {
          path: '讀書筆記/原子習慣.md',
          title: '原子習慣',
          eventDate: '2025-12-20',
          activeDays: []
        }
      ],
      edges: [
        { source: '歡迎.md', target: '讀書筆記/原子習慣.md', type: 'wikilink', weight: 2 },
        { source: '讀書筆記/原子習慣.md', target: '歡迎.md', type: 'wikilink', weight: 1 }
      ]
    })
  })

  it('不同寫法解析到同一篇時合併為一條邊，權重相加', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    note(db, '資料夾/b.md')
    setWikilinks(db, a, [
      { target: 'b', count: 1 },
      { target: '資料夾/b', count: 2 }
    ])
    expect(getGraph(db).edges).toEqual([
      { source: 'a.md', target: '資料夾/b.md', type: 'wikilink', weight: 3 }
    ])
  })

  it('5000 篇筆記、約 1 萬條連結時仍在 200ms 內完成', () => {
    const db = openDb(':memory:')
    const n = 5000
    db.transaction(() => {
      for (let i = 0; i < n; i++) note(db, `資料夾${i % 20}/筆記${i}.md`)
    })()
    db.transaction(() => {
      for (let i = 1; i < n; i++) {
        setWikilinks(
          db,
          i + 1,
          [
            { target: `筆記${(i * 7919) % i}`, count: 1 },
            { target: `筆記${(i * 31) % n}`, count: 1 }
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
    expect(ms).toBeLessThan(200)
  })
})
