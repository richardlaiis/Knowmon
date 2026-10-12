// 總結的狀態（純函式）：開始、取得 request id、套用 main 推送的片段。
import type { SummaryChunk, SummaryLanguage } from '../../shared/types'

export interface SummaryState {
  /** main 回傳的 request id；拿到之前為 null */
  id: string | null
  path: string
  /** 總結的是選取文字 */
  selection: boolean
  text: string
  status: 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  /** 拿到 id 之前先收到的片段（理論上不會發生，保險起見先存著） */
  early: SummaryChunk[]
}

export function startSummary(path: string, selection: boolean): SummaryState {
  return { id: null, path, selection, text: '', status: 'running', error: null, early: [] }
}

/** 取得 request id，套用之前先收到的片段 */
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

/** 使用者按下停止：之後到達的片段都忽略 */
export function stopSummary(s: SummaryState): SummaryState {
  return s.status === 'running' ? { ...s, status: 'stopped' } : s
}

export function failSummary(s: SummaryState, error: string): SummaryState {
  return { ...s, status: 'error', error }
}

const LANGUAGE_KEY = 'knowmon.summary.language'

/** 總結語言偏好（所有 vault 共用），預設繁體中文 */
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
    // 無法儲存時只影響下次啟動
  }
}
