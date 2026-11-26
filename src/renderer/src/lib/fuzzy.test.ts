import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../../shared/types'
import { fuzzyScore, rankNotes } from './fuzzy'

const note = (path: string, modifiedAt = 0): NoteSummary => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  eventDate: null,
  modifiedAt
})

describe('fuzzyScore', () => {
  it('returns null when there is no match, and 0 for an empty query', () => {
    // CJK on purpose: no word separators, so only order and contiguity affect the score
    expect(fuzzyScore('xyz', '原子習慣')).toBeNull()
    expect(fuzzyScore('慣習', '原子習慣')).toBeNull()
    expect(fuzzyScore('', '任何')).toBe(0)
  })

  it('consecutive matches > scattered matches, matches at the start > in the middle', () => {
    const contiguous = fuzzyScore('習慣', '原子習慣')!
    const scattered = fuzzyScore('原慣', '原子習慣')!
    expect(contiguous).toBeGreaterThan(scattered)
    expect(fuzzyScore('原子', '原子習慣')!).toBeGreaterThan(contiguous)
  })

  it('is case-insensitive and ignores spaces in the query', () => {
    expect(fuzzyScore('DW', 'deep work')).not.toBeNull()
    expect(fuzzyScore('deep work', 'DeepWork')).not.toBeNull()
  })

  it('gives a bonus for word starts after separators', () => {
    expect(fuzzyScore('dw', 'deep-work')!).toBeGreaterThan(fuzzyScore('dw', 'deepswork')!)
  })
})

describe('rankNotes', () => {
  const notes = [
    note('Books/Atomic Habits.md', 3),
    note('Books/Deep Work.md', 1),
    note('Journal/2026-10-06.md', 5),
    note('Habits/Checklist.md', 2)
  ]

  it('empty query: recently opened first, then by modification time', () => {
    expect(rankNotes(notes, '', ['Books/Deep Work.md']).map((n) => n.path)).toEqual([
      'Books/Deep Work.md',
      'Journal/2026-10-06.md',
      'Books/Atomic Habits.md',
      'Habits/Checklist.md'
    ])
  })

  it('title matches beat path-only matches', () => {
    expect(rankNotes(notes, 'habits').map((n) => n.path)).toEqual([
      'Books/Atomic Habits.md',
      'Habits/Checklist.md'
    ])
  })

  it('can match folder paths', () => {
    expect(rankNotes(notes, 'Journal 10').map((n) => n.path)).toEqual(['Journal/2026-10-06.md'])
  })

  it('limit works', () => {
    expect(rankNotes(notes, '', [], 2)).toHaveLength(2)
  })
})
