import { describe, expect, it } from 'vitest'
import { PERF_SCALE_CI, perfBudget } from './test-utils'

describe('perfBudget', () => {
  it('keeps the original limit locally', () => {
    expect(perfBudget(500, {})).toBe(500)
  })

  it('is relaxed on CI', () => {
    expect(perfBudget(500, { CI: 'true' })).toBe(500 * PERF_SCALE_CI)
  })
})
