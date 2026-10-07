import { useState } from 'react'
import { GraphView } from './GraphView'
import type { Point } from './model'
import { loadPref, savePref } from './prefs'
import { useGraphData } from './useGraphData'

const LABELS_KEY = 'knowmon.graph.labels'

export interface GlobalGraphProps {
  /** false 時隱藏但保留（重新打開不需重建整張圖） */
  visible: boolean
  version: number
  current: string | null
  theme: string
  /** 座標快取（每個 vault 一份，由 App 保存） */
  positions: Map<string, Point>
  onOpen: (path: string, newTab: boolean) => void
  onError: (e: unknown) => void
}

/** 全域圖譜：所有筆記與 wikilink */
export function GlobalGraph(props: GlobalGraphProps): React.JSX.Element {
  const data = useGraphData(props.version, props.onError)
  const [labels, setLabels] = useState(() => loadPref(LABELS_KEY, ['on', 'off'], 'on') === 'on')
  const [relayoutKey, setRelayoutKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)

  return (
    <div className="graph global-graph" style={props.visible ? undefined : { display: 'none' }}>
      <div className="graph-toolbar">
        <span className="graph-count">
          {data ? `${data.nodes.length} notes · ${data.edges.length} links` : 'Loading…'}
          {progress !== null && ` · Laying out… ${Math.round(progress * 100)}%`}
        </span>
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
      </div>
      {data && (
        <GraphView
          data={data}
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
