// Shared pure functions for the time layer: date conversion, session splitting, and defaults and ranges for the time parameters. Shared by main and renderer.
import type { TimeSettings } from './types'

export const DEFAULT_TIME_SETTINGS: TimeSettings = {
  sessionGapMinutes: 30,
  sessionMaxNotes: 20,
  sameDayWindowDays: 0
}

/** Allowed range for each parameter (inclusive) */
export const TIME_LIMITS: Record<keyof TimeSettings, [number, number]> = {
  sessionGapMinutes: [5, 240],
  sessionMaxNotes: [2, 200],
  sameDayWindowDays: [0, 7]
}

/** Applies the valid fields of input on top of base: non-numbers are skipped, out-of-range values are clamped to the nearest bound, and decimals are rounded */
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

/** YYYY-MM-DD → days since 1970-01-01 (independent of time zone) */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** The inverse of dayNumber */
export function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** The date of a timestamp in the local time zone (YYYY-MM-DD) */
export function localDay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Splits time-sorted events into sessions: a gap longer than gapMs between neighbors starts a new session.
 * A gap exactly equal to gapMs stays in the same session.
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
