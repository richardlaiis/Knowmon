// Display text for the LLM status (pure functions) and the subscription hook
import { useEffect, useState } from 'react'
import { PROVIDER_LABELS } from '../../shared/llm'
import type { LlmStatus } from '../../shared/types'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'off'

/** The one-line status at the bottom of the sidebar */
export function describeStatus(s: LlmStatus | null): { tone: StatusTone; label: string } {
  if (!s) return { tone: 'off', label: 'AI: checking…' }
  if (!s.online) return { tone: 'off', label: 'AI offline' }
  if (s.error) return { tone: 'warn', label: 'AI: needs attention' }
  // In cloud mode, with Ollama offline there's no embedding progress, so "Indexing" isn't shown
  if (s.ollamaOnline && (s.busy || s.embedded < s.total)) {
    return { tone: 'busy', label: `Indexing ${s.embedded}/${s.total}` }
  }
  const provider = s.settings.provider
  return {
    tone: 'ok',
    label: provider === 'ollama' ? 'AI ready' : `AI ready · ${PROVIDER_LABELS[provider]}`
  }
}

/** The current vault's LLM status; main pushes changes */
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
