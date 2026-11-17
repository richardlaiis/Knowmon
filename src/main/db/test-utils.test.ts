import { describe, expect, it } from 'vitest'
import { PERF_SCALE_CI, perfBudget } from './test-utils'

describe('perfBudget', () => {
  it('本機照原本的上限', () => {
    expect(perfBudget(500, {})).toBe(500)
  })

  it('CI 上放寬', () => {
    expect(perfBudget(500, { CI: 'true' })).toBe(500 * PERF_SCALE_CI)
  })
})
