import { describe, expect, it } from 'vitest'
import type { Backlink } from '../../../shared/types'
import { groupBacklinks } from './backlinks'

const link = (path: string, line: number): Backlink => ({
  path,
  title: path.replace(/\.md$/, ''),
  line,
  context: [{ text: `line ${line}`, match: false }]
})

describe('groupBacklinks', () => {
  it('groups by source note, keeping the order', () => {
    const groups = groupBacklinks([link('a.md', 1), link('a.md', 5), link('b.md', 2)])
    expect(groups.map((g) => [g.path, g.items.map((i) => i.line)])).toEqual([
      ['a.md', [1, 5]],
      ['b.md', [2]]
    ])
    expect(groupBacklinks([])).toEqual([])
  })
})
