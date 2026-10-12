// LLM 狀態的顯示文字（純函式）與訂閱 hook
import { useEffect, useState } from 'react'
import type { LlmStatus } from '../../shared/types'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'off'

/** 側欄底部的一行狀態 */
export function describeStatus(s: LlmStatus | null): { tone: StatusTone; label: string } {
  if (!s) return { tone: 'off', label: 'AI: checking…' }
  if (!s.online) return { tone: 'off', label: 'AI offline' }
  if (s.error) return { tone: 'warn', label: 'AI: needs attention' }
  if (s.busy || s.embedded < s.total) {
    return { tone: 'busy', label: `Indexing ${s.embedded}/${s.total}` }
  }
  return { tone: 'ok', label: 'AI ready' }
}

/** 目前 vault 的 LLM 狀態；main 推送變更 */
export function useLlmStatus(vault: string | null): LlmStatus | null {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  useEffect(() => {
    if (!vault) return
    let stale = false
    const off = window.api.llm.onStatus((s) => !stale && setStatus(s))
    window.api.llm
      .status()
      .then((s) => !stale && setStatus(s))
      .catch(() => {})
    return () => {
      stale = true
      off()
    }
  }, [vault])
  return vault ? status : null
}
