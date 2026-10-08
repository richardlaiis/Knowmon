// 時間軸視圖：依「事件時間」（eventDate）或「寫作時間」（create / edit 事件，分成 session）列出筆記
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPref, savePref } from '../graph/prefs'
import type { ActivityEvent, NoteSummary } from '../../shared/types'
import {
  groupActivity,
  groupByEventDate,
  groupByMonth,
  monthHistogram,
  type ActivityDay,
  type EventDay,
  type MonthBar
} from './model'

const MODE_KEY = 'knowmon.timeline.mode'
const MODES = ['event', 'written'] as const
type Mode = (typeof MODES)[number]

export interface TimelineViewProps {
  /** false 時隱藏但保留（捲動位置不變），也不重新取得資料 */
  visible: boolean
  version: number
  current: string | null
  /** session 的間隔（分鐘），與 same_session 邊相同 */
  sessionGapMinutes: number
  onOpen: (path: string, newTab: boolean) => void
  onOpenSettings: () => void
  onError: (e: unknown) => void
}

type Data = { mode: 'event'; notes: NoteSummary[] } | { mode: 'written'; events: ActivityEvent[] }

const DAY_MS = 86_400_000

export function TimelineView(props: TimelineViewProps): React.JSX.Element {
  const { visible, version, onError } = props
  const [mode, setMode] = useState<Mode>(() => loadPref(MODE_KEY, MODES, 'event'))
  const [data, setData] = useState<Data | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    let stale = false
    const load: Promise<Data> =
      mode === 'event'
        ? window.api.notes.list().then((notes) => ({ mode, notes }))
        : window.api.timeline.activity(0, Date.now() + DAY_MS).then((events) => ({ mode, events }))
    load.then((d) => !stale && setData(d)).catch((e) => !stale && onError(e))
    return () => {
      stale = true
    }
  }, [visible, version, mode, onError])

  const view = useMemo(() => {
    if (!data) return null
    if (data.mode === 'event') {
      const { days, undated } = groupByEventDate(data.notes)
      const bars = monthHistogram(days.map((d) => ({ day: d.day, count: d.notes.length })))
      return { mode: data.mode, months: groupByMonth(days), bars, undated }
    }
    const days = groupActivity(data.events, props.sessionGapMinutes * 60_000)
    const bars = monthHistogram(
      days.map((d) => ({
        day: d.day,
        count: new Set(d.sessions.flatMap((s) => s.notes.map((n) => n.path))).size
      }))
    )
    return { mode: data.mode, months: groupByMonth(days), bars, undated: 0 }
  }, [data, props.sessionGapMinutes])

  const chooseMode = (m: Mode): void => {
    setMode(m)
    savePref(MODE_KEY, m)
    list.current?.scrollTo({ top: 0 })
  }

  const jumpTo = (month: string): void => {
    const el = list.current?.querySelector(`[data-month="${month}"]`)
    el?.scrollIntoView({ block: 'start' })
  }

  const open = (e: React.MouseEvent, path: string): void => {
    props.onOpen(path, e.ctrlKey || e.metaKey || e.button === 1)
  }
  const noteButton = (path: string, title: string, extra?: React.ReactNode): React.JSX.Element => (
    <button
      key={path}
      className={`timeline-note${path === props.current ? ' current' : ''}`}
      title={path}
      onClick={(e) => open(e, path)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && open(e, path)}
    >
      <span className="timeline-title">{title}</span>
      {folderOf(path) && <span className="timeline-folder">{folderOf(path)}</span>}
      {extra}
    </button>
  )

  const loading = !view || view.mode !== mode

  return (
    <div className="timeline" style={visible ? undefined : { display: 'none' }}>
      <div className="graph-toolbar">
        <div className="segmented" role="group" aria-label="Time">
          <button
            className={mode === 'event' ? 'active' : ''}
            onClick={() => chooseMode('event')}
            title="When the note's content happened (frontmatter date: or a dated file name)"
          >
            Event date
          </button>
          <button
            className={mode === 'written' ? 'active' : ''}
            onClick={() => chooseMode('written')}
            title="When notes were created or edited, grouped into work sessions"
          >
            Written
          </button>
        </div>
        <span className="graph-count">{loading ? 'Loading…' : summaryText(view)}</span>
        <button onClick={props.onOpenSettings} title="Time settings (session length…)">
          Settings
        </button>
      </div>
      {!loading && view.bars.length > 0 && <Histogram bars={view.bars} onPick={jumpTo} />}
      <div className="timeline-list" ref={list}>
        {!loading &&
          view.months.map((m) => (
            <section key={m.month} data-month={m.month}>
              <h2 className="timeline-month">{formatMonth(m.month)}</h2>
              {view.mode === 'event'
                ? (m.days as EventDay[]).map((d) => (
                    <div key={d.day} className="timeline-day">
                      <h3>{formatDay(d.day)}</h3>
                      <div className="timeline-notes">
                        {d.notes.map((n) => noteButton(n.path, n.title))}
                      </div>
                    </div>
                  ))
                : (m.days as ActivityDay[]).map((d) => (
                    <div key={d.day} className="timeline-day">
                      <h3>{formatDay(d.day)}</h3>
                      {d.sessions.map((s) => (
                        <div key={s.start} className="timeline-session">
                          <span className="session-time">
                            {formatTime(s.start)}
                            {s.end - s.start >= 60_000 && `–${formatTime(s.end)}`}
                          </span>
                          <div className="timeline-notes">
                            {s.notes.map((n) =>
                              noteButton(
                                n.path,
                                n.title,
                                n.created && <span className="badge">new</span>
                              )
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
            </section>
          ))}
        {!loading && view.months.length === 0 && (
          <p className="graph-empty">
            {mode === 'event'
              ? 'No dated notes. Add date: to the frontmatter, or start a file name with YYYY-MM-DD.'
              : 'No edits recorded yet.'}
          </p>
        )}
        {!loading && view.undated > 0 && (
          <p className="timeline-undated">
            {view.undated} note{view.undated === 1 ? '' : 's'} without an event date
          </p>
        )}
      </div>
    </div>
  )
}

function Histogram({
  bars,
  onPick
}: {
  bars: MonthBar[]
  onPick: (month: string) => void
}): React.JSX.Element {
  const max = Math.max(...bars.map((b) => b.count))
  return (
    <div className="timeline-histogram">
      {bars.map((b) => (
        <button
          key={b.month}
          className="bar"
          disabled={b.count === 0}
          title={`${formatMonth(b.month)}: ${b.count} note${b.count === 1 ? '' : 's'}`}
          onClick={() => onPick(b.month)}
        >
          <span style={{ height: `${Math.max(b.count ? 8 : 0, (b.count / max) * 100)}%` }} />
        </button>
      ))}
    </div>
  )
}

function summaryText(view: { mode: Mode; months: { days: unknown[] }[] }): string {
  const days = view.months.reduce((n, m) => n + m.days.length, 0)
  return `${days} day${days === 1 ? '' : 's'}`
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}
