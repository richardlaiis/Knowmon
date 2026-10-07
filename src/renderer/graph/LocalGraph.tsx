import { useMemo, useState } from 'react'
import { GraphView } from './GraphView'
import { localSubgraph, type Point } from './model'
import { loadPref, savePref } from './prefs'
import { useGraphData } from './useGraphData'

const DEPTH_KEY = 'knowmon.graph.depth'
const DEPTHS = ['1', '2', '3'] as const

export interface LocalGraphProps {
  path: string
  version: number
  theme: string
  positions: Map<string, Point>
  onOpen: (path: string, newTab: boolean) => void
  onError: (e: unknown) => void
}

/** 單篇局部圖：目前筆記與 depth 步內相連的筆記 */
export function LocalGraph(props: LocalGraphProps): React.JSX.Element {
  const global = useGraphData(props.version, props.onError)
  const [depth, setDepth] = useState(() => loadPref(DEPTH_KEY, DEPTHS, '1'))
  const [fitKey, setFitKey] = useState(0)
  const data = useMemo(
    () => (global ? localSubgraph(global, props.path, Number(depth)) : null),
    [global, props.path, depth]
  )

  return (
    <div className="graph local-graph">
      <div className="graph-toolbar">
        <span className="graph-count">{data ? `${data.nodes.length} notes` : 'Loading…'}</span>
        <label title="How many links away from this note">
          Depth
          <select
            value={depth}
            onChange={(e) => {
              const d = e.target.value as (typeof DEPTHS)[number]
              setDepth(d)
              savePref(DEPTH_KEY, d)
            }}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setFitKey((k) => k + 1)} title="Zoom to fit">
          Fit
        </button>
      </div>
      {data && (
        <GraphView
          data={data}
          current={props.path}
          onOpen={props.onOpen}
          positions={props.positions}
          labels
          theme={props.theme}
          relayoutKey={0}
          fitKey={fitKey}
          autoFit
        />
      )}
    </div>
  )
}
