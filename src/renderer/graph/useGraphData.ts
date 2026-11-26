import { useEffect, useState } from 'react'
import type { GraphData } from '../../shared/types'

/** Fetches the graph data, refetching when version changes (the index may have changed) */
export function useGraphData(version: number, onError: (e: unknown) => void): GraphData | null {
  const [data, setData] = useState<GraphData | null>(null)
  useEffect(() => {
    let stale = false
    window.api.graph
      .get()
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && onError(e))
    return () => {
      stale = true
    }
  }, [version, onError])
  return data
}
