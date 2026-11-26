import { describe, expect, it } from 'vitest'
import { draftToLimits, limitsToDraft } from './chatLimits'

describe('chatLimits', () => {
  const base = { contextTokens: 8192, maxOutputTokens: 1000 }

  it('round trips; no output limit is blank', () => {
    expect(limitsToDraft(base)).toEqual({ contextTokens: '8192', maxOutputTokens: '1000' })
    expect(limitsToDraft({ contextTokens: 4096, maxOutputTokens: null })).toEqual({
      contextTokens: '4096',
      maxOutputTokens: ''
    })
    expect(draftToLimits(limitsToDraft(base), base)).toEqual(base)
  })

  it('a blank output limit = model default; non-numbers keep the old value', () => {
    expect(draftToLimits({ contextTokens: ' 16384 ', maxOutputTokens: ' ' }, base)).toEqual({
      contextTokens: 16384,
      maxOutputTokens: null
    })
    expect(draftToLimits({ contextTokens: '', maxOutputTokens: 'abc' }, base)).toEqual(base)
  })
})
