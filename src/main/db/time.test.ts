import { describe, expect, it } from 'vitest'
import { DEFAULT_TIME_SETTINGS, localDay } from '../../shared/time'
import { insertEvent, listLinks, openDb, setWikilinks, upsertNote, type DB } from '.'
import { getGraph } from './graph'
import { listActivity, rebuildTimeLinks } from './time'

const MIN = 60_000
const T0 = new Date(2026, 9, 8, 9, 0).getTime() // 本地時間 2026-10-08 09:00

function note(db: DB, path: string, eventDate: string | null = null): number {
  const title = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return upsertNote(db, { path, title, createdAt: 0, modifiedAt: 0, eventDate, contentHash: path })
}

describe('rebuildTimeLinks', () => {
  it('寫入三種時間邊，重算時取代舊的時間邊、保留 wikilink', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md', '2026-10-01')
    const b = note(db, 'b.md', '2026-10-01')
    setWikilinks(db, a, [{ target: 'b', count: 1 }])
    insertEvent(db, a, T0, 'edit')
    insertEvent(db, b, T0 + 10 * MIN, 'edit')
    insertEvent(db, b, T0 + 20 * MIN, 'open') // open 不算

    rebuildTimeLinks(db, DEFAULT_TIME_SETTINGS)
    const types = (): string[] => listLinks(db).map((l) => `${l.type} ${l.src}→${l.dst}`)
    expect(types().sort()).toEqual([
      `same_day ${a}→${b}`,
      `same_session ${a}→${b}`,
      `sequence ${a}→${b}`,
      `wikilink ${a}→${b}`
    ])

    // session 縮短到 5 分鐘後兩次編輯不再同一段
    rebuildTimeLinks(db, { ...DEFAULT_TIME_SETTINGS, sessionGapMinutes: 5 })
    expect(types().filter((t) => t.startsWith('same_session'))).toEqual([])
    expect(types()).toHaveLength(3)
  })

  it('1000 篇筆記、5 萬筆編輯事件時在 500ms 內完成', () => {
    const db = openDb(':memory:')
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        note(db, `日記${i % 10}/筆記${i}.md`, `2026-${String((i % 12) + 1).padStart(2, '0')}-01`)
      }
      // 每 5 分鐘編輯一篇，每 20 筆休息 2 小時（每個 session 約 20 篇）
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
    expect(ms).toBeLessThan(500)
  })
})

describe('getGraph 的時間資料', () => {
  it('同一對筆記的不同類型分開列出；activeDays 只算 create / edit，依本地日期', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md', '2026-10-01')
    const b = note(db, 'b.md', '2026-10-01')
    setWikilinks(db, a, [{ target: 'b', count: 2 }])
    insertEvent(db, a, T0 - 10 * 60 * MIN, 'create') // 前一天 23:00
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
  it('[from, to) 之間的 create / edit，依時間排序', () => {
    const db = openDb(':memory:')
    const a = note(db, '資料夾/a.md')
    insertEvent(db, a, T0 + 2, 'edit')
    insertEvent(db, a, T0, 'create')
    insertEvent(db, a, T0 + 1, 'open')
    insertEvent(db, a, T0 + 3, 'edit')
    expect(listActivity(db, T0, T0 + 3)).toEqual([
      { path: '資料夾/a.md', title: 'a', ts: T0, kind: 'create' },
      { path: '資料夾/a.md', title: 'a', ts: T0 + 2, kind: 'edit' }
    ])
  })
})
