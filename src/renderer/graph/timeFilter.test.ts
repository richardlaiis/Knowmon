import { describe, expect, it } from 'vitest'
import { dayNumber } from '../../shared/time'
import type { GraphData, GraphNode } from '../../shared/types'
import { clampRange, hiddenByTime, moveRange, timeDomain } from './timeFilter'

const node = (path: string, eventDate: string | null, activeDays: string[] = []): GraphNode => ({
  path,
  title: path,
  eventDate,
  activeDays
})
const data: GraphData = {
  nodes: [
    node('a', '2026-10-01', ['2026-09-01', '2026-10-05']),
    node('b', '2026-10-03', ['2026-10-02']),
    node('c', null, ['2026-10-04']),
    node('d', null)
  ],
  edges: []
}
const d = dayNumber

describe('timeDomain', () => {
  it('依時間軸取最小與最大日期，沒有日期時為 null', () => {
    expect(timeDomain(data, 'event')).toEqual([d('2026-10-01'), d('2026-10-03')])
    expect(timeDomain(data, 'written')).toEqual([d('2026-09-01'), d('2026-10-05')])
    expect(timeDomain({ nodes: [node('x', null)], edges: [] }, 'event')).toBeNull()
  })
})

describe('hiddenByTime', () => {
  const hidden = (...args: Parameters<typeof hiddenByTime>): string[] =>
    [...hiddenByTime(...args)].sort()

  it('事件時間：日期在範圍外的隱藏；未標日期的依 undated 決定', () => {
    const range: [number, number] = [d('2026-10-02'), d('2026-10-03')]
    expect(hidden(data, { axis: 'event', range, undated: true })).toEqual(['a'])
    expect(hidden(data, { axis: 'event', range, undated: false })).toEqual(['a', 'c', 'd'])
    expect(hidden(data, { axis: 'event', range: null, undated: false })).toEqual(['c', 'd'])
  })

  it('寫作時間：任何一天落在範圍內就顯示', () => {
    const range: [number, number] = [d('2026-10-04'), d('2026-10-30')]
    expect(hidden(data, { axis: 'written', range, undated: true })).toEqual(['b'])
    expect(hidden(data, { axis: 'written', range, undated: false })).toEqual(['b', 'd'])
  })
})

describe('moveRange', () => {
  const domain: [number, number] = [0, 100]
  it('限制在 domain 內，拖過另一端時推著走', () => {
    expect(moveRange([10, 20], domain, 0, 15)).toEqual([15, 20])
    expect(moveRange([10, 20], domain, 0, 30)).toEqual([30, 30])
    expect(moveRange([10, 20], domain, 1, 5)).toEqual([5, 5])
    expect(moveRange([10, 20], domain, 1, 999)).toEqual([10, 100])
    expect(moveRange([10, 20], domain, 0, -5.4)).toEqual([0, 20])
  })
})

describe('clampRange', () => {
  it('限制在 domain 內；涵蓋整個 domain 或沒有 domain 時為 null', () => {
    expect(clampRange([5, 50], [10, 40])).toBeNull()
    expect(clampRange([5, 20], [10, 40])).toEqual([10, 20])
    expect(clampRange([50, 60], [10, 40])).toEqual([40, 40])
    expect(clampRange([15, 20], null)).toBeNull()
    expect(clampRange(null, [10, 40])).toBeNull()
  })
})
