import { useEffect, useState } from 'react'
import type { GraphData } from '../../shared/types'

/** 取得圖譜資料；version 改變（索引可能變動）時重新取得 */
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
