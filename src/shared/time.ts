// 時間層共用的純函式：日期換算、session 切分、時間參數的預設值與範圍。main 與 renderer 共用。
import type { TimeSettings } from './types'

export const DEFAULT_TIME_SETTINGS: TimeSettings = {
  sessionGapMinutes: 30,
  sessionMaxNotes: 20,
  sameDayWindowDays: 0
}

/** 每個參數允許的範圍（含兩端） */
export const TIME_LIMITS: Record<keyof TimeSettings, [number, number]> = {
  sessionGapMinutes: [5, 240],
  sessionMaxNotes: [2, 200],
  sameDayWindowDays: [0, 7]
}

/** 以 base 為底套用 input 中合法的欄位：非數字略過，超出範圍的取最近的邊界，小數四捨五入 */
export function clampTimeSettings(
  input: unknown,
  base: TimeSettings = DEFAULT_TIME_SETTINGS
): TimeSettings {
  const out = { ...base }
  if (!input || typeof input !== 'object') return out
  for (const key of Object.keys(TIME_LIMITS) as (keyof TimeSettings)[]) {
    const v = (input as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const [min, max] = TIME_LIMITS[key]
    out[key] = Math.min(max, Math.max(min, Math.round(v)))
  }
  return out
}

const DAY_MS = 86_400_000

/** YYYY-MM-DD → 自 1970-01-01 起的天數（不受時區影響） */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** dayNumber 的反函數 */
export function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** 時間戳記在本地時區的日期（YYYY-MM-DD） */
export function localDay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 把依時間排序的事件切成 session：相鄰兩筆間隔超過 gapMs 就開始新的 session。
 * 等於 gapMs 仍算同一個 session。
 */
export function sessionize<E extends { ts: number }>(events: readonly E[], gapMs: number): E[][] {
  const out: E[][] = []
  let cur: E[] = []
  for (const e of events) {
    if (cur.length && e.ts - cur[cur.length - 1].ts > gapMs) {
      out.push(cur)
      cur = []
    }
    cur.push(e)
  }
  if (cur.length) out.push(cur)
  return out
}
