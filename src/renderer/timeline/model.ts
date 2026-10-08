// 時間軸的純函式：依日期分組、session 切分、每月長條圖。不碰 DOM。
import { localDay, sessionize } from '../../shared/time'
import type { ActivityEvent, NoteSummary } from '../../shared/types'

const collator = new Intl.Collator('zh-Hant', { numeric: true })

export interface EventDay {
  day: string
  notes: NoteSummary[]
}

/** 事件時間：有 eventDate 的筆記依日期分組（新的在前，同一天依標題）；回傳沒有日期的篇數 */
export function groupByEventDate(notes: readonly NoteSummary[]): {
  days: EventDay[]
  undated: number
} {
  const byDay = new Map<string, NoteSummary[]>()
  let undated = 0
  for (const n of notes) {
    if (!n.eventDate) {
      undated++
      continue
    }
    const list = byDay.get(n.eventDate) ?? []
    list.push(n)
    byDay.set(n.eventDate, list)
  }
  const days = [...byDay]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, notes: list.sort((a, b) => collator.compare(a.title, b.title)) }))
  return { days, undated }
}

export interface SessionNote {
  path: string
  title: string
  /** 這個 session 裡建立的 */
  created: boolean
  edits: number
}

export interface ActivitySession {
  start: number
  end: number
  /** 依第一次出現的順序 */
  notes: SessionNote[]
}

export interface ActivityDay {
  day: string
  /** 新的在前 */
  sessions: ActivitySession[]
}

/**
 * 寫作時間：事件（依時間排序）切成 session 後依開始的日期（本地時區）分組，新的在前。
 * 跨過午夜的 session 算在開始那天。
 */
export function groupActivity(events: readonly ActivityEvent[], gapMs: number): ActivityDay[] {
  const days: ActivityDay[] = []
  for (const session of sessionize(events, gapMs).reverse()) {
    const notes = new Map<string, SessionNote>()
    for (const e of session) {
      const n = notes.get(e.path) ?? { path: e.path, title: e.title, created: false, edits: 0 }
      if (e.kind === 'create') n.created = true
      else n.edits++
      notes.set(e.path, n)
    }
    const s = {
      start: session[0].ts,
      end: session[session.length - 1].ts,
      notes: [...notes.values()]
    }
    const day = localDay(s.start)
    if (days.length && days[days.length - 1].day === day) days[days.length - 1].sessions.push(s)
    else days.push({ day, sessions: [s] })
  }
  return days
}

export interface MonthBar {
  month: string // YYYY-MM
  count: number
}

/** 每月的數量（遞增），最早到最晚之間沒有資料的月份補 0 */
export function monthHistogram(days: readonly { day: string; count: number }[]): MonthBar[] {
  const counts = new Map<string, number>()
  for (const d of days) {
    const m = d.day.slice(0, 7)
    counts.set(m, (counts.get(m) ?? 0) + d.count)
  }
  const months = [...counts.keys()].sort()
  if (!months.length) return []
  const out: MonthBar[] = []
  let [y, m] = months[0].split('-').map(Number)
  const last = months[months.length - 1]
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push({ month: key, count: counts.get(key) ?? 0 })
    if (key >= last) break
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** 依月份分組（保持原本的順序） */
export function groupByMonth<T extends { day: string }>(
  days: readonly T[]
): { month: string; days: T[] }[] {
  const out: { month: string; days: T[] }[] = []
  for (const d of days) {
    const month = d.day.slice(0, 7)
    if (out.length && out[out.length - 1].month === month) out[out.length - 1].days.push(d)
    else out.push({ month, days: [d] })
  }
  return out
}
