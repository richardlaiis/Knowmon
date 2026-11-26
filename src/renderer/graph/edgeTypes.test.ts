import { describe, expect, it } from 'vitest'
import { parseEdgeTypes, serializeEdgeTypes } from './edgeTypes'

const sorted = (s: Set<string>): string[] => [...s].sort()

describe('edge type prefs', () => {
  it('selects everything when there is no saved preference', () => {
    expect(parseEdgeTypes(null).size).toBe(5)
  })

  it('round trips', () => {
    const on = new Set(['wikilink', 'semantic'] as const)
    expect(serializeEdgeTypes(on)).toBe('wikilink,-same_session,-same_day,-sequence,semantic')
    expect(sorted(parseEdgeTypes(serializeEdgeTypes(on)))).toEqual(['semantic', 'wikilink'])
    expect(parseEdgeTypes(serializeEdgeTypes(new Set())).size).toBe(0)
  })

  it('the old phase 4 format: existing types not mentioned are off, and the new semantic defaults to on', () => {
    expect(sorted(parseEdgeTypes('wikilink,same_day'))).toEqual([
      'same_day',
      'semantic',
      'wikilink'
    ])
    expect(sorted(parseEdgeTypes(''))).toEqual(['semantic'])
  })
})
