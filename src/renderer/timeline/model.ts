// Pure functions for the timeline: grouping by date, splitting sessions, monthly bar charts. No DOM.
import { localDay, sessionize } from '../../shared/time'
import type { ActivityEvent, NoteSummary } from '../../shared/types'

const collator = new Intl.Collator('zh-Hant', { numeric: true })

export interface EventDay {
  day: string
  notes: NoteSummary[]
}

/** Event date: notes with an eventDate grouped by date (newest first, by title within a day); returns the number of undated notes */
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
  /** Notes created in this session */
  created: boolean
  edits: number
}

export interface ActivitySession {
  start: number
  end: number
  /** In order of first appearance */
  notes: SessionNote[]
}

export interface ActivityDay {
  day: string
  /** Newest first */
  sessions: ActivitySession[]
}

/**
 * Written time: events (sorted by time) are split into sessions and grouped by their start date (local time zone), newest first.
 * A session crossing midnight belongs to the day it started.
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

/** Count per month (ascending), filling months between the earliest and latest without data with 0 */
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

/** Groups by month (keeping the original order) */
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
