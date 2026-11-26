import { useMemo, useState } from 'react'
import type { LinkType } from '../../shared/types'
import { EdgeTypeFilter } from './EdgeTypeFilter'
import { loadEdgeTypes, saveEdgeTypes } from './edgeTypes'
import { GraphView } from './GraphView'
import { filterEdges, localSubgraph, type Point } from './model'
import { loadPref, savePref } from './prefs'
import { useGraphData } from './useGraphData'

const DEPTH_KEY = 'knowmon.graph.depth'
const DEPTHS = ['1', '2', '3'] as const
const TYPES_KEY = 'knowmon.graph.localTypes'

export interface LocalGraphProps {
  path: string
  version: number
  theme: string
  positions: Map<string, Point>
  onOpen: (path: string, newTab: boolean) => void
  onError: (e: unknown) => void
}

/** The per-note local graph: the current note and notes within depth steps (following only the selected edge types) */
export function LocalGraph(props: LocalGraphProps): React.JSX.Element {
  const global = useGraphData(props.version, props.onError)
  const [depth, setDepth] = useState(() => loadPref(DEPTH_KEY, DEPTHS, '1'))
  const [fitKey, setFitKey] = useState(0)
  const [types, setTypes] = useState<Set<LinkType>>(() => loadEdgeTypes(TYPES_KEY))
  // Filter edge types before the BFS: types that are off don't count as "linked"
  const data = useMemo(
    () => (global ? localSubgraph(filterEdges(global, types), props.path, Number(depth)) : null),
    [global, types, props.path, depth]
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
      <div className="graph-toolbar">
        <EdgeTypeFilter
          value={types}
          onChange={(next) => {
            setTypes(next)
            saveEdgeTypes(TYPES_KEY, next)
          }}
        />
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
