import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, EDITOR_MIN, PANE_LIMITS, clampWidth, parseLayout } from './layout'

describe('clampWidth', () => {
  const L = PANE_LIMITS.left

  it('限制在上下限之間並取整數', () => {
    expect(clampWidth(100, L, 2000, 300)).toBe(L.min)
    expect(clampWidth(9999, L, 2000, 300)).toBe(L.max)
    expect(clampWidth(300.6, L, 2000, 300)).toBe(301)
  })

  it('不把編輯器擠到最小寬度以下', () => {
    expect(clampWidth(500, L, 1000, 300)).toBe(1000 - 300 - EDITOR_MIN)
  })

  it('視窗太窄時仍至少保留面板的最小寬度', () => {
    expect(clampWidth(500, L, 600, 300)).toBe(L.min)
  })
})

describe('parseLayout', () => {
  it('讀回存的值，缺少或型別錯誤的欄位用預設值', () => {
    expect(parseLayout(JSON.stringify({ left: 320, rightOpen: false }))).toEqual({
      ...DEFAULT_LAYOUT,
      left: 320,
      rightOpen: false
    })
    expect(parseLayout(JSON.stringify({ left: 'x', leftOpen: 1 }))).toEqual(DEFAULT_LAYOUT)
  })

  it('沒有資料或 JSON 壞掉時用預設值', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{壞掉')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('null')).toEqual(DEFAULT_LAYOUT)
  })
})
