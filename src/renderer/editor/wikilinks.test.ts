import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../shared/types'
import { openWikilinkQuery, wikilinkAt, wikilinkOptions } from './wikilinks'

const note = (path: string): NoteSummary => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  eventDate: null,
  modifiedAt: 0
})

describe('openWikilinkQuery', () => {
  it('returns the text typed so far when the cursor is after [[', () => {
    expect(openWikilinkQuery('See [[')).toBe('')
    expect(openWikilinkQuery('See [[Atom')).toBe('Atom')
    expect(openWikilinkQuery('[[a]] and [[b c')).toBe('b c')
  })

  it('does not complete when the link is closed or | or # has been typed', () => {
    expect(openWikilinkQuery('[[a]]')).toBeNull()
    expect(openWikilinkQuery('[[a|label')).toBeNull()
    expect(openWikilinkQuery('[[a#heading')).toBeNull()
    expect(openWikilinkQuery('[single bracket')).toBeNull()
  })
})

describe('wikilinkAt', () => {
  const line = 'See [[Atomic Habits|book]] and [[Deep Work#Chapter 2]]'
  it('returns the link target at the click position', () => {
    expect(wikilinkAt(line, 5)).toBe('Atomic Habits')
    expect(wikilinkAt(line, 26)).toBe('Atomic Habits')
    expect(wikilinkAt(line, 36)).toBe('Deep Work')
  })

  it('returns null when not on a link or when it is only a heading', () => {
    expect(wikilinkAt(line, 0)).toBeNull()
    expect(wikilinkAt('[[#heading]]', 3)).toBeNull()
  })
})

describe('wikilinkOptions', () => {
  const notes = [
    note('Books/Atomic Habits.md'),
    note('Archive/Atomic Habits.md'),
    note('Welcome.md')
  ]

  it('a note with a duplicate name inserts a target with its folder, and shows the folder', () => {
    expect(wikilinkOptions(notes, 'atom')).toEqual([
      { label: 'Atomic Habits', detail: 'Archive', text: 'Archive/Atomic Habits' },
      { label: 'Atomic Habits', detail: 'Books', text: 'Atomic Habits' }
    ])
  })

  it('notes in the root have no folder description', () => {
    expect(wikilinkOptions(notes, 'Welcome')).toEqual([
      { label: 'Welcome', detail: '', text: 'Welcome' }
    ])
  })
})
