// Converts between the AI settings dialog's context length and output limit fields (strings) and ChatLimits
import type { ChatLimits } from '../../shared/types'

export interface ChatLimitsDraft {
  contextTokens: string
  /** An empty string = model default */
  maxOutputTokens: string
}

export function limitsToDraft(l: ChatLimits): ChatLimitsDraft {
  return {
    contextTokens: String(l.contextTokens),
    maxOutputTokens: l.maxOutputTokens === null ? '' : String(l.maxOutputTokens)
  }
}

/** A context that isn't a number keeps the old value; a blank output limit = model default. main's cleanChatLimits checks the ranges again */
export function draftToLimits(d: ChatLimitsDraft, base: ChatLimits): ChatLimits {
  const num = (s: string): number | null => {
    const n = Number(s)
    return s.trim() !== '' && Number.isFinite(n) ? n : null
  }
  return {
    contextTokens: num(d.contextTokens) ?? base.contextTokens,
    maxOutputTokens:
      d.maxOutputTokens.trim() === '' ? null : (num(d.maxOutputTokens) ?? base.maxOutputTokens)
  }
}
