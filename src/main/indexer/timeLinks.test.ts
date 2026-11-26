import { describe, expect, it } from 'vitest'
import { DEFAULT_TIME_SETTINGS } from '../../shared/time'
import {
  deriveTimeLinks,
  sameDayLinks,
  sequenceLinks,
  sessionLinks,
  type EditEvent,
  type TimeNote
} from './timeLinks'

const MIN = 60_000
const notes: TimeNote[] = [
  { id: 1, path: 'a.md', eventDate: null },
  { id: 2, path: 'b.md', eventDate: '2026-10-05' },
  { id: 3, path: 'c.md', eventDate: '2026-10-05' },
  { id: 4, path: 'journal/2026-10-04.md', eventDate: '2026-10-04' },
  { id: 5, path: 'journal/2026-10-06.md', eventDate: '2026-10-06' },
  { id: 6, path: 'journal/2026-10-05.md', eventDate: '2026-10-05' }
]
const edit = (noteId: number, minute: number): EditEvent => ({ noteId, ts: minute * MIN })

describe('sessionLinks', () => {
  it('notes edited in the same session are all linked, weighted by shared sessions', () => {
    const edits = [edit(3, 0), edit(1, 10), edit(3, 20), edit(2, 45), edit(1, 200), edit(3, 210)]
    expect(sessionLinks(notes, edits, 30 * MIN, 20)).toEqual([
      // c.md comes later, so a.md is src
      { src: 1, dst: 3, type: 'same_session', weight: 2 },
      { src: 2, dst: 3, type: 'same_session', weight: 1 },
      { src: 1, dst: 2, type: 'same_session', weight: 1 }
    ])
  })

  it('single-note sessions, sessions over maxNotes and missing notes produce no edges', () => {
    const edits = [edit(1, 0), edit(1, 5), edit(99, 6), edit(1, 100), edit(2, 101), edit(3, 102)]
    expect(sessionLinks(notes, edits, 30 * MIN, 2)).toEqual([])
  })
})

describe('sameDayLinks', () => {
  it('links only the same day by default', () => {
    const links = sameDayLinks(notes, 0)
    expect(links.map((l) => [l.src, l.dst])).toEqual([
      [2, 3],
      [2, 6],
      [3, 6]
    ])
    expect(links.every((l) => l.weight === 1 && l.type === 'same_day')).toBe(true)
  })

  it('also links within windowDays, with weight decreasing by days apart', () => {
    const links = sameDayLinks(notes, 1)
    const w = (a: number, b: number): number | undefined =>
      links.find((l) => l.src === a && l.dst === b)?.weight
    expect(links).toHaveLength(3 + 3 + 3) // 3 pairs on the same day; 10-04 with the 3 on 10-05; 10-06 with the 3 on 10-05
    expect(w(2, 4)).toBe(0.5)
    expect(w(4, 5)).toBeUndefined() // 2 days apart
  })
})

describe('sequenceLinks', () => {
  it('chains notes in the same folder by date (earlier → later), skipping undated ones', () => {
    expect(sequenceLinks(notes).map((l) => [l.src, l.dst])).toEqual([
      [2, 3], // root: same day, by path
      [4, 6],
      [6, 5]
    ])
  })
})

describe('deriveTimeLinks', () => {
  it('merges the three edge types using the configured parameters', () => {
    const links = deriveTimeLinks(notes, [edit(1, 0), edit(2, 40)], {
      ...DEFAULT_TIME_SETTINGS,
      sessionGapMinutes: 45
    })
    expect(links.filter((l) => l.type === 'same_session')).toHaveLength(1)
    expect(links.filter((l) => l.type === 'same_day')).toHaveLength(3)
    expect(links.filter((l) => l.type === 'sequence')).toHaveLength(3)
  })
})
