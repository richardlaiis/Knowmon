import { describe, expect, it } from 'vitest'
import { DEFAULT_TIME_SETTINGS, localDay } from '../../shared/time'
import { insertEvent, listLinks, openDb, setWikilinks, upsertNote, type DB } from '.'
import { getGraph } from './graph'
import { perfBudget } from './test-utils'
import { listActivity, rebuildTimeLinks } from './time'

const MIN = 60_000
const T0 = new Date(2026, 9, 8, 9, 0).getTime() // local time 2026-10-08 09:00

function note(db: DB, path: string, eventDate: string | null = null): number {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return upsertNote(db, { path, title, createdAt: 0, modifiedAt: 0, eventDate, contentHash: path })
}

describe('rebuildTimeLinks', () => {
  it('writes the three time edge types; recomputing replaces old time edges and keeps wikilinks', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md', '2026-10-01')
    const b = note(db, 'b.md', '2026-10-01')
    setWikilinks(db, a, [{ target: 'b', count: 1 }])
    insertEvent(db, a, T0, 'edit')
    insertEvent(db, b, T0 + 10 * MIN, 'edit')
    insertEvent(db, b, T0 + 20 * MIN, 'open') // open doesn't count

    rebuildTimeLinks(db, DEFAULT_TIME_SETTINGS)
    const types = (): string[] => listLinks(db).map((l) => `${l.type} ${l.src}→${l.dst}`)
    expect(types().sort()).toEqual([
      `same_day ${a}→${b}`,
      `same_session ${a}→${b}`,
      `sequence ${a}→${b}`,
      `wikilink ${a}→${b}`
    ])

    // With the session cut to 5 minutes, the two edits are no longer in the same session
    rebuildTimeLinks(db, { ...DEFAULT_TIME_SETTINGS, sessionGapMinutes: 5 })
    expect(types().filter((t) => t.startsWith('same_session'))).toEqual([])
    expect(types()).toHaveLength(3)
  })

  it('finishes within 500ms for 1000 notes and 50,000 edit events', () => {
    const db = openDb(':memory:')
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        note(db, `Journal${i % 10}/note${i}.md`, `2026-${String((i % 12) + 1).padStart(2, '0')}-01`)
      }
      // Edit one note every 5 minutes, with a 2-hour break every 20 edits (about 20 notes per session)
      for (let i = 0; i < 50_000; i++) {
        insertEvent(
          db,
          ((i * 7919) % 1000) + 1,
          T0 + i * 5 * MIN + Math.floor(i / 20) * 120 * MIN,
          'edit'
        )
      }
    })()
    const t = performance.now()
    rebuildTimeLinks(db, DEFAULT_TIME_SETTINGS)
    const ms = performance.now() - t
    expect(listLinks(db, 'same_session').length).toBeGreaterThan(1000)
    expect(ms).toBeLessThan(perfBudget(500))
  })
})

describe('time data in getGraph', () => {
  it('lists different types for the same pair separately; activeDays counts only create / edit, by local date', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md', '2026-10-01')
    const b = note(db, 'b.md', '2026-10-01')
    setWikilinks(db, a, [{ target: 'b', count: 2 }])
    insertEvent(db, a, T0 - 10 * 60 * MIN, 'create') // 23:00 the day before
    insertEvent(db, a, T0, 'edit')
    insertEvent(db, a, T0 + 5 * MIN, 'edit')
    insertEvent(db, b, T0 + 24 * 60 * MIN, 'open')
    rebuildTimeLinks(db, DEFAULT_TIME_SETTINGS)
    const g = getGraph(db)
    expect(g.edges.map((e) => `${e.type}:${e.weight}`)).toEqual([
      'same_day:1',
      'sequence:1',
      'wikilink:2'
    ])
    expect(g.nodes.map((n) => n.activeDays)).toEqual([
      [localDay(T0 - 10 * 60 * MIN), '2026-10-08'],
      []
    ])
  })
})

describe('listActivity', () => {
  it('create / edit in [from, to), sorted by time', () => {
    const db = openDb(':memory:')
    const a = note(db, 'Folder/a.md')
    insertEvent(db, a, T0 + 2, 'edit')
    insertEvent(db, a, T0, 'create')
    insertEvent(db, a, T0 + 1, 'open')
    insertEvent(db, a, T0 + 3, 'edit')
    expect(listActivity(db, T0, T0 + 3)).toEqual([
      { path: 'Folder/a.md', title: 'a', ts: T0, kind: 'create' },
      { path: 'Folder/a.md', title: 'a', ts: T0 + 2, kind: 'edit' }
    ])
  })
})
