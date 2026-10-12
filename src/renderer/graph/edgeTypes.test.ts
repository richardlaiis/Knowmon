import { describe, expect, it } from 'vitest'
import { parseEdgeTypes, serializeEdgeTypes } from './edgeTypes'

const sorted = (s: Set<string>): string[] => [...s].sort()

describe('edge type prefs', () => {
  it('沒有紀錄時全選', () => {
    expect(parseEdgeTypes(null).size).toBe(5)
  })

  it('來回轉換', () => {
    const on = new Set(['wikilink', 'semantic'] as const)
    expect(serializeEdgeTypes(on)).toBe('wikilink,-same_session,-same_day,-sequence,semantic')
    expect(sorted(parseEdgeTypes(serializeEdgeTypes(on)))).toEqual(['semantic', 'wikilink'])
    expect(parseEdgeTypes(serializeEdgeTypes(new Set())).size).toBe(0)
  })

  it('階段 4 的舊格式：沒提到的原有類型關閉，新的 semantic 預設開啟', () => {
    expect(sorted(parseEdgeTypes('wikilink,same_day'))).toEqual([
      'same_day',
      'semantic',
      'wikilink'
    ])
    expect(sorted(parseEdgeTypes(''))).toEqual(['semantic'])
  })
})
