// 從問題中解析時間範圍（「上個月」「最近 7 天」「2026-09」…）。main 與 renderer 共用。
// 日期一律本地時區、含兩端；週從週一開始。只取第一個（最前面、最長的）時間片語。
import { dayNumber, dayString, localDay } from './time'
import type { DateRange } from './types'

export interface TimeRangeMatch {
  range: DateRange
  /** 時間片語在原文中的位置（UTF-16 index）與長度，用來從檢索查詢中移除 */
  index: number
  length: number
}

interface Today {
  day: string
  n: number
  y: number
  m: number
}

type Rule = [RegExp, (m: RegExpExecArray, t: Today) => DateRange | null]

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()
const shift = (day: string, days: number): string => dayString(dayNumber(day) + days)

function addMonths(y: number, m: number, delta: number): [number, number] {
  const i = y * 12 + (m - 1) + delta
  return [Math.floor(i / 12), (i % 12) + 1]
}

function monthRange(y: number, m: number): DateRange | null {
  if (m < 1 || m > 12 || y < 1900 || y > 2100) return null
  return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) }
}

function yearRange(y: number): DateRange | null {
  return y < 1900 || y > 2100 ? null : { from: `${y}-01-01`, to: `${y}-12-31` }
}

/** 週一 – 週日；weeksAgo = 0 是本週。1970-01-01 是週四 */
function weekRange(t: Today, weeksAgo: number): DateRange {
  const monday = t.n - ((t.n + 3) % 7) - weeksAgo * 7
  return { from: dayString(monday), to: dayString(monday + 6) }
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}
const EN_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
}

/** 阿拉伯數字或 99 以內的中文數字；無法解析時 NaN */
export function parseNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  if (s.toLowerCase() in EN_NUMBERS) return EN_NUMBERS[s.toLowerCase()]
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    const tens = a ? CN_DIGITS[a] : 1
    const ones = b ? CN_DIGITS[b] : 0
    return tens === undefined || ones === undefined || s.split('十').length > 2
      ? NaN
      : tens * 10 + ones
  }
  return s.length === 1 && s in CN_DIGITS ? CN_DIGITS[s] : NaN
}

/** 「2026-09-01」「2026/9/1」「2026 年 9 月 1 日」 */
const DATE = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日號号]`

function parseDate(token: string): string | null {
  const [y, m, d] = (token.match(/\d+/g) ?? []).map(Number)
  if (!monthRange(y, m) || d < 1 || d > daysInMonth(y, m)) return null
  return ymd(y, m, d)
}

/** 往前 n 個單位，到今天為止（含今天） */
function rolling(t: Today, n: number, unit: string): DateRange | null {
  if (!Number.isFinite(n) || n < 1 || n > 1000) return null
  const u = unit.toLowerCase()
  if (/^(天|日|day)/.test(u)) return { from: shift(t.day, -(n - 1)), to: t.day }
  if (/(星期|禮拜|礼拜|週|周|week)/.test(u)) return { from: shift(t.day, -(n * 7 - 1)), to: t.day }
  const months = /年|year/.test(u) ? n * 12 : n
  const [y, m] = addMonths(t.y, t.m, -months)
  const d = Math.min(Number(t.day.slice(8)), daysInMonth(y, m))
  return { from: shift(ymd(y, m, d), 1), to: t.day }
}

const CN_NUM = '\\d+|[一二兩两三四五六七八九十]{1,3}'
const EN_NUM = '\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]

const RULES: Rule[] = [
  // 日期範圍
  [
    new RegExp(
      `(${DATE})\\s*(?:到|至|~|～|–|—|-|\\bto\\b|\\buntil\\b|\\bthrough\\b)\\s*(${DATE})`,
      'gi'
    ),
    (m) => {
      const a = parseDate(m[1])
      const b = parseDate(m[2])
      if (!a || !b) return null
      return a <= b ? { from: a, to: b } : { from: b, to: a }
    }
  ],
  // 單一日期
  [
    new RegExp(DATE, 'g'),
    (m) => {
      const d = parseDate(m[0])
      return d ? { from: d, to: d } : null
    }
  ],
  // 年月：2026-09、2026 年 9 月
  [
    /\d{4}[-/.]\d{1,2}(?![-/.]?\d)|\d{4}\s*年\s*\d{1,2}\s*月(?!\s*\d)/g,
    (m) => {
      const [y, mo] = (m[0].match(/\d+/g) ?? []).map(Number)
      return monthRange(y, mo)
    }
  ],
  // 9 月、九月份（沒寫年份時取最近一次，含本月）
  [
    new RegExp(`(?<![\\d年個个])(${CN_NUM})\\s*月(?:份)?(?!\\s*\\d)`, 'g'),
    (m, t) => {
      const mo = parseNumber(m[1])
      if (!(mo >= 1 && mo <= 12)) return null
      return monthRange(mo > t.m ? t.y - 1 : t.y, mo)
    }
  ],
  // September、September 2026（may 必須有年份或前面是 in / during / from / of / since）
  [
    new RegExp(`(?<![a-z])(${MONTHS.join('|')})(?:\\s+(\\d{4}))?(?![a-z])`, 'gi'),
    (m, t) => {
      const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1
      if (m[2]) return monthRange(Number(m[2]), mo)
      if (mo === 5 && !/\b(in|during|from|of|since)\s+$/i.test(m.input.slice(0, m.index))) {
        return null
      }
      return monthRange(mo > t.m ? t.y - 1 : t.y, mo)
    }
  ],
  // 今天、昨天、前天
  [/今天|今日|(?<![a-z])today(?![a-z])/gi, (_m, t) => ({ from: t.day, to: t.day })],
  [
    /前天|(?<![a-z])the day before yesterday(?![a-z])/gi,
    (_m, t) => ({ from: shift(t.day, -2), to: shift(t.day, -2) })
  ],
  [
    /昨天|昨日|(?<![a-z])yesterday(?![a-z])/gi,
    (_m, t) => ({ from: shift(t.day, -1), to: shift(t.day, -1) })
  ],
  // 週
  [
    /(?:這|这|本)[個个]?(?:星期|禮拜|礼拜|週|周)|(?<![a-z])this week(?![a-z])/gi,
    (_m, t) => weekRange(t, 0)
  ],
  [/上上[個个]?(?:星期|禮拜|礼拜|週|周)/g, (_m, t) => weekRange(t, 2)],
  [
    /上[個个]?(?:星期|禮拜|礼拜|週|周)|(?<![a-z])(?:last|previous) week(?![a-z])/gi,
    (_m, t) => weekRange(t, 1)
  ],
  // 月
  [/(?:這|这|本)[個个]?月|(?<![a-z])this month(?![a-z])/gi, (_m, t) => monthRange(t.y, t.m)],
  [/上上[個个]?月/g, (_m, t) => monthRange(...addMonths(t.y, t.m, -2))],
  [
    /上[個个]?月|(?<![a-z])(?:last|previous) month(?![a-z])/gi,
    (_m, t) => monthRange(...addMonths(t.y, t.m, -1))
  ],
  // 年
  [/今年|(?<![a-z])this year(?![a-z])/gi, (_m, t) => yearRange(t.y)],
  [/前年/g, (_m, t) => yearRange(t.y - 2)],
  [/去年|(?<![a-z])(?:last|previous) year(?![a-z])/gi, (_m, t) => yearRange(t.y - 1)],
  // 最近 N 天／週／個月／年
  [
    new RegExp(
      `(?:最近|過去|过去|近|前)\\s*(${CN_NUM})\\s*(天|日|[個个]?星期|[個个]?禮拜|[個个]?礼拜|週|周|[個个]月|年)`,
      'g'
    ),
    (m, t) => rolling(t, parseNumber(m[1]), m[2])
  ],
  [
    new RegExp(
      `(?<![a-z])(?:the\\s+)?(?:past|last|previous)\\s+(${EN_NUM})\\s+(days?|weeks?|months?|years?)(?![a-z])`,
      'gi'
    ),
    (m, t) => rolling(t, parseNumber(m[1]), m[2])
  ],
  [/(?<![a-z])(?:the\s+)?past\s+(day|week|month|year)(?![a-z])/gi, (m, t) => rolling(t, 1, m[1])],
  // 年份：2026 年、in 2026
  [
    /\d{4}\s*年(?!\s*\d)|(?<=\b(?:in|during|from|since)\s+)\d{4}(?![-/.]?\d)/gi,
    (m) => yearRange(Number(m[0].match(/\d{4}/)![0]))
  ]
]

/** 解析 text 中第一個時間片語；沒有時回傳 null */
export function parseTimeRange(text: string, now: number = Date.now()): TimeRangeMatch | null {
  const day = localDay(now)
  const t: Today = {
    day,
    n: dayNumber(day),
    y: Number(day.slice(0, 4)),
    m: Number(day.slice(5, 7))
  }
  let best: TimeRangeMatch | null = null
  for (const [re, toRange] of RULES) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const range = toRange(m, t)
      if (!range) continue
      if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) {
        best = { range, index: m.index, length: m[0].length }
      }
      break
    }
  }
  return best
}

/** 移除時間片語（檢索查詢用），多餘的空白合併 */
export function withoutTimeRange(text: string, match: TimeRangeMatch | null): string {
  if (!match) return text
  return (text.slice(0, match.index) + ' ' + text.slice(match.index + match.length))
    .replace(/\s+/g, ' ')
    .trim()
}
