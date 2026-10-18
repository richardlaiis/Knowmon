import { describe, expect, it } from 'vitest'
import { parseNumber, parseTimeRange, withoutTimeRange } from './timeRange'

// 2026-10-14（週三）中午，本地時區
const NOW = new Date(2026, 9, 14, 12).getTime()
const range = (text: string, now = NOW): [string, string] | null => {
  const m = parseTimeRange(text, now)
  return m ? [m.range.from, m.range.to] : null
}

describe('parseNumber', () => {
  it('阿拉伯數字、中文數字、英文數字', () => {
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber('三')).toBe(3)
    expect(parseNumber('兩')).toBe(2)
    expect(parseNumber('十')).toBe(10)
    expect(parseNumber('十二')).toBe(12)
    expect(parseNumber('二十三')).toBe(23)
    expect(parseNumber('three')).toBe(3)
    expect(parseNumber('a')).toBe(1)
    expect(parseNumber('x')).toBeNaN()
  })
})

describe('parseTimeRange', () => {
  it('今天、昨天、前天', () => {
    expect(range('今天寫了什麼')).toEqual(['2026-10-14', '2026-10-14'])
    expect(range('昨天的會議')).toEqual(['2026-10-13', '2026-10-13'])
    expect(range('前天')).toEqual(['2026-10-12', '2026-10-12'])
    expect(range('What did I write yesterday?')).toEqual(['2026-10-13', '2026-10-13'])
    expect(range('notes from today')).toEqual(['2026-10-14', '2026-10-14'])
  })

  it('週從週一開始', () => {
    expect(range('這週的進度')).toEqual(['2026-10-12', '2026-10-18'])
    expect(range('本星期')).toEqual(['2026-10-12', '2026-10-18'])
    expect(range('上週讀了什麼')).toEqual(['2026-10-05', '2026-10-11'])
    expect(range('上個禮拜')).toEqual(['2026-10-05', '2026-10-11'])
    expect(range('上上週')).toEqual(['2026-09-28', '2026-10-04'])
    expect(range('last week')).toEqual(['2026-10-05', '2026-10-11'])
    // 週一與週日當天
    expect(range('這週', new Date(2026, 9, 12, 0, 5).getTime())).toEqual([
      '2026-10-12',
      '2026-10-18'
    ])
    expect(range('這週', new Date(2026, 9, 18, 23).getTime())).toEqual(['2026-10-12', '2026-10-18'])
  })

  it('月、跨年的上個月', () => {
    expect(range('上個月的筆記')).toEqual(['2026-09-01', '2026-09-30'])
    expect(range('這個月')).toEqual(['2026-10-01', '2026-10-31'])
    expect(range('本月')).toEqual(['2026-10-01', '2026-10-31'])
    expect(range('上上個月')).toEqual(['2026-08-01', '2026-08-31'])
    expect(range('last month')).toEqual(['2026-09-01', '2026-09-30'])
    const jan = new Date(2027, 0, 10).getTime()
    expect(range('上個月', jan)).toEqual(['2026-12-01', '2026-12-31'])
    expect(range('上上個月', jan)).toEqual(['2026-11-01', '2026-11-30'])
  })

  it('年', () => {
    expect(range('今年')).toEqual(['2026-01-01', '2026-12-31'])
    expect(range('去年的計畫')).toEqual(['2025-01-01', '2025-12-31'])
    expect(range('前年')).toEqual(['2024-01-01', '2024-12-31'])
    expect(range('2025 年的日記')).toEqual(['2025-01-01', '2025-12-31'])
    expect(range('what did I plan in 2025')).toEqual(['2025-01-01', '2025-12-31'])
    expect(range('this year')).toEqual(['2026-01-01', '2026-12-31'])
  })

  it('最近 N 天／週／個月（含今天）', () => {
    expect(range('最近 7 天')).toEqual(['2026-10-08', '2026-10-14'])
    expect(range('過去三天')).toEqual(['2026-10-12', '2026-10-14'])
    expect(range('最近兩週')).toEqual(['2026-10-01', '2026-10-14'])
    expect(range('近一個星期')).toEqual(['2026-10-08', '2026-10-14'])
    expect(range('最近三個月')).toEqual(['2026-07-15', '2026-10-14'])
    expect(range('最近十天')).toEqual(['2026-10-05', '2026-10-14'])
    expect(range('in the past 3 days')).toEqual(['2026-10-12', '2026-10-14'])
    expect(range('last two weeks')).toEqual(['2026-10-01', '2026-10-14'])
    expect(range('the past week')).toEqual(['2026-10-08', '2026-10-14'])
    expect(range('the past month')).toEqual(['2026-09-15', '2026-10-14'])
  })

  it('日期、日期範圍、年月', () => {
    expect(range('2026-09-03 做了什麼')).toEqual(['2026-09-03', '2026-09-03'])
    expect(range('2026/9/3')).toEqual(['2026-09-03', '2026-09-03'])
    expect(range('2026 年 9 月 3 日')).toEqual(['2026-09-03', '2026-09-03'])
    expect(range('2026-09-01 到 2026-09-15')).toEqual(['2026-09-01', '2026-09-15'])
    expect(range('2026-09-15 ~ 2026-09-01')).toEqual(['2026-09-01', '2026-09-15'])
    expect(range('from 2026-09-01 to 2026-09-15')).toEqual(['2026-09-01', '2026-09-15'])
    expect(range('2026-09 的讀書筆記')).toEqual(['2026-09-01', '2026-09-30'])
    expect(range('2024 年 2 月')).toEqual(['2024-02-01', '2024-02-29'])
  })

  it('沒寫年份的月份取最近一次', () => {
    expect(range('9 月寫了什麼')).toEqual(['2026-09-01', '2026-09-30'])
    expect(range('十月份')).toEqual(['2026-10-01', '2026-10-31'])
    expect(range('十二月')).toEqual(['2025-12-01', '2025-12-31'])
    expect(range('notes in September')).toEqual(['2026-09-01', '2026-09-30'])
    expect(range('March 2025')).toEqual(['2025-03-01', '2025-03-31'])
    expect(range('in May')).toEqual(['2026-05-01', '2026-05-31'])
  })

  it('不該當成時間範圍', () => {
    expect(range('最近在想什麼')).toBeNull()
    expect(range('深度工作的重點')).toBeNull()
    expect(range('May I ask about habits?')).toBeNull()
    expect(range('第 3 章')).toBeNull()
    expect(range('2026-13-01')).toBeNull()
    expect(range('一個月有幾天')).toBeNull()
    expect(range('build 1234 failed')).toBeNull()
  })

  it('回傳片語的位置，取最前面的一個', () => {
    const q = '上個月和這週讀了什麼'
    const m = parseTimeRange(q, NOW)!
    expect(m.range).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(q.slice(m.index, m.index + m.length)).toBe('上個月')
    expect(
      withoutTimeRange('我上個月 讀了什麼書', parseTimeRange('我上個月 讀了什麼書', NOW))
    ).toBe('我 讀了什麼書')
    expect(withoutTimeRange('深度工作', null)).toBe('深度工作')
  })
})
