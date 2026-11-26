import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIME_SETTINGS,
  clampTimeSettings,
  dayNumber,
  dayString,
  localDay,
  sessionize
} from './time'

describe('clampTimeSettings', () => {
  it('returns the defaults for invalid input', () => {
    expect(clampTimeSettings(null)).toEqual(DEFAULT_TIME_SETTINGS)
    expect(clampTimeSettings('x')).toEqual(DEFAULT_TIME_SETTINGS)
  })

  it('applies only valid fields, clamping out-of-range values and rounding decimals', () => {
    expect(
      clampTimeSettings({
        sessionGapMinutes: 1000,
        sessionMaxNotes: '5',
        sameDayWindowDays: 1.6,
        other: 1
      })
    ).toEqual({ sessionGapMinutes: 240, sessionMaxNotes: 20, sameDayWindowDays: 2 })
    expect(clampTimeSettings({ sessionGapMinutes: -3, sessionMaxNotes: NaN })).toEqual({
      ...DEFAULT_TIME_SETTINGS,
      sessionGapMinutes: 5
    })
  })

  it('merges on top of base', () => {
    const base = { sessionGapMinutes: 60, sessionMaxNotes: 10, sameDayWindowDays: 3 }
    expect(clampTimeSettings({ sessionMaxNotes: 50 }, base)).toEqual({
      ...base,
      sessionMaxNotes: 50
    })
  })
})

describe('date conversion', () => {
  it('dayNumber and dayString are inverses, correct across months and leap years', () => {
    expect(dayNumber('1970-01-01')).toBe(0)
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2)
    expect(dayNumber('2026-01-01') - dayNumber('2025-12-31')).toBe(1)
    for (const d of ['2024-02-29', '2026-10-08', '1999-12-31'])
      expect(dayString(dayNumber(d))).toBe(d)
  })

  it('localDay uses the local time zone', () => {
    const t = new Date(2026, 9, 8, 23, 59).getTime()
    expect(localDay(t)).toBe('2026-10-08')
    expect(localDay(t + 2 * 60_000)).toBe('2026-10-09')
  })
})

describe('sessionize', () => {
  const ev = (...ts: number[]): { ts: number }[] => ts.map((t) => ({ ts: t }))

  it('splits only when the gap exceeds gap; exactly gap stays in the same session', () => {
    expect(sessionize(ev(0, 10, 20, 50, 51, 100), 30).map((s) => s.map((e) => e.ts))).toEqual([
      [0, 10, 20, 50, 51],
      [100]
    ])
    expect(sessionize(ev(0, 31), 30)).toHaveLength(2)
  })

  it('returns an empty array when there are no events', () => {
    expect(sessionize([], 30)).toEqual([])
  })
})
