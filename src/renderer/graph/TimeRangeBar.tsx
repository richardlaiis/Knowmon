import { dayString } from '../../shared/time'
import { moveRange, type TimeAxis, type TimeFilter } from './timeFilter'

export interface TimeRangeBarProps {
  /** The range of all dates (dayNumber); null when there are none */
  domain: [number, number] | null
  filter: TimeFilter
  onChange: (f: TimeFilter) => void
}

/** The graph's time filter bar: the timeline, a two-handle slider, and whether to show undated notes */
export function TimeRangeBar({ domain, filter, onChange }: TimeRangeBarProps): React.JSX.Element {
  const range = filter.range ?? domain
  const span = domain ? domain[1] - domain[0] : 0
  const pct = (d: number): number => (span === 0 ? 0 : ((d - domain![0]) / span) * 100)
  const fromOnTop =
    !!domain && !!range && range[0] === range[1] && range[0] > (domain[0] + domain[1]) / 2
  const move = (end: 0 | 1, value: number): void => {
    if (!domain || !range) return
    const next = moveRange(range, domain, end, value)
    const full = next[0] === domain[0] && next[1] === domain[1]
    onChange({ ...filter, range: full ? null : next })
  }

  return (
    <div className="graph-toolbar time-bar">
      <label title="Which time to filter by">
        <select
          value={filter.axis}
          onChange={(e) => onChange({ ...filter, axis: e.target.value as TimeAxis, range: null })}
        >
          <option value="event">Event date</option>
          <option value="written">Written</option>
        </select>
      </label>
      {domain && range ? (
        <>
          <span className="range-label">{dayString(range[0])}</span>
          <div className="range-slider">
            <div className="range-track" />
            <div
              className="range-fill"
              style={{ left: `${pct(range[0])}%`, right: `${100 - pct(range[1])}%` }}
            />
            <input
              type="range"
              aria-label="From"
              // When both handles overlap on the right half, put "start" on top, otherwise it can't be dragged
              className={fromOnTop ? 'on-top' : undefined}
              min={domain[0]}
              max={domain[1]}
              step={1}
              value={range[0]}
              disabled={span === 0}
              onChange={(e) => move(0, Number(e.target.value))}
            />
            <input
              type="range"
              aria-label="To"
              min={domain[0]}
              max={domain[1]}
              step={1}
              value={range[1]}
              disabled={span === 0}
              onChange={(e) => move(1, Number(e.target.value))}
            />
          </div>
          <span className="range-label">{dayString(range[1])}</span>
        </>
      ) : (
        <span className="range-slider-empty">No dates</span>
      )}
      <label
        title={
          filter.axis === 'event' ? 'Notes without an event date' : 'Notes with no recorded edits'
        }
      >
        <input
          type="checkbox"
          checked={filter.undated}
          onChange={(e) => onChange({ ...filter, undated: e.target.checked })}
        />
        Undated
      </label>
      <button
        onClick={() => onChange({ ...filter, range: null, undated: true })}
        disabled={filter.range === null && filter.undated}
        title="Show all notes"
      >
        Reset
      </button>
    </div>
  )
}
