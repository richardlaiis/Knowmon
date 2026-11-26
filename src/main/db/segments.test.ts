import { describe, expect, it } from 'vitest'
import { clip, findAll, toSegments } from './segments'

describe('toSegments', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(
      toSegments('abcdefgh', [
        [4, 6],
        [1, 3],
        [2, 4]
      ])
    ).toEqual([
      { text: 'a', match: false },
      { text: 'bcdef', match: true },
      { text: 'gh', match: false }
    ])
  })

  it('without ranges nothing is a match, and surrounding whitespace is trimmed', () => {
    expect(toSegments('  a  b \n', [])).toEqual([{ text: 'a b', match: false }])
    expect(toSegments('', [])).toEqual([])
  })
})

describe('clip', () => {
  it('does not cut short text', () => {
    expect(clip('abc', [[1, 2]], 10)).toEqual({ text: 'abc', ranges: [[1, 2]] })
  })

  it('cuts around the match and shifts the ranges', () => {
    const text = '0123456789'.repeat(10)
    const c = clip(text, [[50, 52]], 20, 5)
    expect(c.text).toBe('…' + text.slice(45, 65) + '…')
    expect(c.ranges).toEqual([[6, 8]])
    expect(c.text.slice(6, 8)).toBe('01')
  })

  it('moves the window back when the match is near the end', () => {
    const text = 'x'.repeat(100)
    const c = clip(text, [[98, 100]], 20)
    expect(c.text).toBe('…' + 'x'.repeat(20))
    expect(c.ranges).toEqual([[19, 21]])
  })
})

describe('findAll', () => {
  it('finds every position case-insensitively', () => {
    expect(findAll('Deep deep DEEP', 'deep')).toEqual([
      [0, 4],
      [5, 9],
      [10, 14]
    ])
    expect(findAll('aaa', '')).toEqual([])
  })
})
