// Summary state (pure functions): starting, getting the request id, applying chunks pushed by main.
import type { SummaryChunk, SummaryLanguage } from '../../shared/types'

export interface SummaryState {
  /** The request id returned by main; null until it arrives */
  id: string | null
  path: string
  /** The summary is of the selected text */
  selection: boolean
  text: string
  status: 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  /** Chunks received before the id arrived (shouldn't happen in theory, kept just in case) */
  early: SummaryChunk[]
}

export function startSummary(path: string, selection: boolean): SummaryState {
  return { id: null, path, selection, text: '', status: 'running', error: null, early: [] }
}

/** Takes the request id and applies chunks received before it */
export function withId(s: SummaryState, id: string): SummaryState {
  const early = s.early.filter((c) => c.id === id)
  return early.reduce(applyChunk, { ...s, id, early: [] })
}

export function applyChunk(s: SummaryState, c: SummaryChunk): SummaryState {
  if (s.id === null) return s.status === 'running' ? { ...s, early: [...s.early, c] } : s
  if (c.id !== s.id || s.status !== 'running') return s
  const text = s.text + c.delta
  if (!c.done) return { ...s, text }
  if (c.error) return { ...s, text, status: 'error', error: c.error }
  return { ...s, text, status: 'done' }
}

/** The user clicked Stop: ignore every chunk that arrives afterwards */
export function stopSummary(s: SummaryState): SummaryState {
  return s.status === 'running' ? { ...s, status: 'stopped' } : s
}

export function failSummary(s: SummaryState, error: string): SummaryState {
  return { ...s, status: 'error', error }
}

const LANGUAGE_KEY = 'knowmon.summary.language'

/** Summary language preference (shared by all vaults), Traditional Chinese by default */
export function loadSummaryLanguage(): SummaryLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh-TW'
  } catch {
    return 'zh-TW'
  }
}

export function saveSummaryLanguage(language: SummaryLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language)
  } catch {
    // If it can't be saved, only the next launch is affected
  }
}
