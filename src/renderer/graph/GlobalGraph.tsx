import { useMemo, useState } from 'react'
import type { LinkType } from '../../shared/types'
import { EdgeTypeFilter } from './EdgeTypeFilter'
import { loadEdgeTypes, saveEdgeTypes } from './edgeTypes'
import { GraphView } from './GraphView'
import { filterEdges, type Point } from './model'
import { loadPref, savePref } from './prefs'
import { TimeRangeBar } from './TimeRangeBar'
import { clampRange, hiddenByTime, timeDomain, type TimeFilter } from './timeFilter'
import { useGraphData } from './useGraphData'

const LABELS_KEY = 'knowmon.graph.labels'
const TYPES_KEY = 'knowmon.graph.types'
const AXIS_KEY = 'knowmon.graph.timeAxis'
const UNDATED_KEY = 'knowmon.graph.undated'

export interface GlobalGraphProps {
  /** false 時隱藏但保留（重新打開不需重建整張圖） */
  visible: boolean
  version: number
  current: string | null
  theme: string
  /** 座標快取（每個 vault 一份，由 App 保存） */
  positions: Map<string, Point>
  onOpen: (path: string, newTab: boolean) => void
  onOpenSettings: () => void
  onError: (e: unknown) => void
}

/** 全域圖譜：所有筆記，可依邊類型與時間範圍篩選 */
export function GlobalGraph(props: GlobalGraphProps): React.JSX.Element {
  const all = useGraphData(props.version, props.onError)
  const [labels, setLabels] = useState(() => loadPref(LABELS_KEY, ['on', 'off'], 'on') === 'on')
  const [types, setTypes] = useState<Set<LinkType>>(() => loadEdgeTypes(TYPES_KEY))
  const [time, setTime] = useState<TimeFilter>(() => ({
    axis: loadPref(AXIS_KEY, ['event', 'written'], 'event'),
    range: null,
    undated: loadPref(UNDATED_KEY, ['on', 'off'], 'on') === 'on'
  }))
  const [relayoutKey, setRelayoutKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)

  const data = useMemo(() => (all ? filterEdges(all, types) : null), [all, types])
  const domain = useMemo(() => (all ? timeDomain(all, time.axis) : null), [all, time.axis])
  // 資料更新後範圍可能超出新的日期範圍
  const filter = useMemo(() => ({ ...time, range: clampRange(time.range, domain) }), [time, domain])
  const hidden = useMemo(() => (all ? hiddenByTime(all, filter) : new Set<string>()), [all, filter])
  const shown = data ? data.nodes.length - hidden.size : 0
  const shownEdges = data
    ? data.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)).length
    : 0

  const changeTime = (f: TimeFilter): void => {
    setTime(f)
    savePref(AXIS_KEY, f.axis)
    savePref(UNDATED_KEY, f.undated ? 'on' : 'off')
  }

  return (
    <div className="graph global-graph" style={props.visible ? undefined : { display: 'none' }}>
      <div className="graph-toolbar">
        <span className="graph-count">
          {data
            ? `${hidden.size ? `${shown} of ` : ''}${data.nodes.length} notes · ${shownEdges} edges`
            : 'Loading…'}
          {progress !== null && ` · Laying out… ${Math.round(progress * 100)}%`}
        </span>
        <EdgeTypeFilter
          value={types}
          onChange={(next) => {
            setTypes(next)
            saveEdgeTypes(TYPES_KEY, next)
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => {
              setLabels(e.target.checked)
              savePref(LABELS_KEY, e.target.checked ? 'on' : 'off')
            }}
          />
          Labels
        </label>
        <button onClick={() => setFitKey((k) => k + 1)} title="Zoom to fit">
          Fit
        </button>
        <button
          onClick={() => setRelayoutKey((k) => k + 1)}
          title="Discard positions and lay out again"
        >
          Re-layout
        </button>
        <button onClick={props.onOpenSettings} title="Time settings (session length…)">
          Settings
        </button>
      </div>
      {all && <TimeRangeBar domain={domain} filter={filter} onChange={changeTime} />}
      {data && (
        <GraphView
          data={data}
          hidden={hidden}
          current={props.current}
          onOpen={props.onOpen}
          positions={props.positions}
          labels={labels}
          theme={props.theme}
          relayoutKey={relayoutKey}
          fitKey={fitKey}
          onProgress={setProgress}
        />
      )}
      {data && data.nodes.length === 0 && <p className="graph-empty">No notes yet.</p>}
    </div>
  )
}
