import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, EDITOR_MIN, PANE_LIMITS, clampWidth, parseLayout } from './layout'

describe('clampWidth', () => {
  const L = PANE_LIMITS.left

  it('clamps between the limits and rounds to integers', () => {
    expect(clampWidth(100, L, 2000, 300)).toBe(L.min)
    expect(clampWidth(9999, L, 2000, 300)).toBe(L.max)
    expect(clampWidth(300.6, L, 2000, 300)).toBe(301)
  })

  it('does not squeeze the editor below its minimum width', () => {
    expect(clampWidth(500, L, 1000, 300)).toBe(1000 - 300 - EDITOR_MIN)
  })

  it('keeps at least the panel minimum width when the window is too narrow', () => {
    expect(clampWidth(500, L, 600, 300)).toBe(L.min)
  })
})

describe('parseLayout', () => {
  it('reads back saved values, using defaults for missing or mistyped fields', () => {
    expect(parseLayout(JSON.stringify({ left: 320, rightOpen: false }))).toEqual({
      ...DEFAULT_LAYOUT,
      left: 320,
      rightOpen: false
    })
    expect(parseLayout(JSON.stringify({ left: 'x', leftOpen: 1 }))).toEqual(DEFAULT_LAYOUT)
  })

  it('uses the defaults when there is no data or the JSON is broken', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{broken')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('null')).toEqual(DEFAULT_LAYOUT)
  })
})
