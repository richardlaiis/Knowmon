import { describe, expect, it } from 'vitest'
import { clip, findAll, toSegments } from './segments'

describe('toSegments', () => {
  it('合併重疊與相鄰的範圍', () => {
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

  it('沒有範圍時整段都不是命中，去掉頭尾空白', () => {
    expect(toSegments('  a  b \n', [])).toEqual([{ text: 'a b', match: false }])
    expect(toSegments('', [])).toEqual([])
  })
})

describe('clip', () => {
  it('短文字不截', () => {
    expect(clip('abc', [[1, 2]], 10)).toEqual({ text: 'abc', ranges: [[1, 2]] })
  })

  it('截取命中前後並平移範圍', () => {
    const text = '0123456789'.repeat(10)
    const c = clip(text, [[50, 52]], 20, 5)
    expect(c.text).toBe('…' + text.slice(45, 65) + '…')
    expect(c.ranges).toEqual([[6, 8]])
    expect(c.text.slice(6, 8)).toBe('01')
  })

  it('命中靠近結尾時視窗往前移', () => {
    const text = 'x'.repeat(100)
    const c = clip(text, [[98, 100]], 20)
    expect(c.text).toBe('…' + 'x'.repeat(20))
    expect(c.ranges).toEqual([[19, 21]])
  })
})

describe('findAll', () => {
  it('不分大小寫找出所有位置', () => {
    expect(findAll('Deep deep DEEP', 'deep')).toEqual([
      [0, 4],
      [5, 9],
      [10, 14]
    ])
    expect(findAll('aaa', '')).toEqual([])
  })
})
