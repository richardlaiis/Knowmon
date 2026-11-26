import { describe, expect, it } from 'vitest'
import type { ActivityEvent, NoteSummary } from '../../shared/types'
import { groupActivity, groupByEventDate, groupByMonth, monthHistogram } from './model'

const MIN = 60_000
const at = (h: number, m = 0, day = 8): number => new Date(2026, 9, day, h, m).getTime()
const ev = (path: string, ts: number, kind: 'create' | 'edit' = 'edit'): ActivityEvent => ({
  path,
  title: path.replace(/\.md$/, ''),
  ts,
  kind
})
const summary = (path: string, eventDate: string | null): NoteSummary => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  eventDate,
  modifiedAt: 0
})

describe('groupByEventDate', () => {
  it('groups by date, newest first, by title within a day; counts undated notes', () => {
    const { days, undated } = groupByEventDate([
      summary('b.md', '2026-10-05'),
      summary('x.md', null),
      summary('Journal/2026-10-06.md', '2026-10-06'),
      summary('a.md', '2026-10-05')
    ])
    expect(days.map((d) => [d.day, d.notes.map((n) => n.title)])).toEqual([
      ['2026-10-06', ['2026-10-06']],
      ['2026-10-05', ['a', 'b']]
    ])
    expect(undated).toBe(1)
  })
})

describe('groupActivity', () => {
  it('splits into sessions grouped by start date (newest first), recording new notes and edit counts', () => {
    const days = groupActivity(
      [
        ev('a.md', at(9), 'create'),
        ev('a.md', at(9, 10)),
        ev('b.md', at(9, 20)),
        ev('a.md', at(9, 30)),
        ev('c.md', at(14)),
        ev('a.md', at(23, 50, 9)),
        ev('b.md', at(0, 10, 10)) // crosses midnight, counted on 10/9
      ],
      30 * MIN
    )
    expect(days.map((d) => d.day)).toEqual(['2026-10-09', '2026-10-08'])
    expect(days[0].sessions).toHaveLength(1)
    expect(days[0].sessions[0].notes.map((n) => n.path)).toEqual(['a.md', 'b.md'])
    const [afternoon, morning] = days[1].sessions
    expect(afternoon).toEqual({
      start: at(14),
      end: at(14),
      notes: [{ path: 'c.md', title: 'c', created: false, edits: 1 }]
    })
    expect(morning.start).toBe(at(9))
    expect(morning.end).toBe(at(9, 30))
    expect(morning.notes).toEqual([
      { path: 'a.md', title: 'a', created: true, edits: 2 },
      { path: 'b.md', title: 'b', created: false, edits: 1 }
    ])
  })

  it('empty when there are no events', () => {
    expect(groupActivity([], MIN)).toEqual([])
  })
})

describe('monthHistogram', () => {
  it('totals per month, filling months without data with 0, across years', () => {
    expect(
      monthHistogram([
        { day: '2026-01-03', count: 2 },
        { day: '2025-11-30', count: 1 },
        { day: '2026-01-20', count: 1 }
      ])
    ).toEqual([
      { month: '2025-11', count: 1 },
      { month: '2025-12', count: 0 },
      { month: '2026-01', count: 3 }
    ])
    expect(monthHistogram([])).toEqual([])
  })
})

describe('groupByMonth', () => {
  it('dates in neighboring same months are grouped together', () => {
    expect(
      groupByMonth([{ day: '2026-10-08' }, { day: '2026-10-01' }, { day: '2026-09-30' }]).map(
        (g) => [g.month, g.days.length]
      )
    ).toEqual([
      ['2026-10', 2],
      ['2026-09', 1]
    ])
  })
})
