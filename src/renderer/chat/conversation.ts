// Q&A conversation state (pure functions): sending a question, getting the request id, applying chunks pushed by main.
// Conversations exist only in memory and are cleared when switching vaults.
import type { AnswerChunk, AskSource, ChatTurn, DateRange } from '../../shared/types'

export interface Question {
  role: 'user'
  text: string
}

export interface Answer {
  role: 'assistant'
  /** The request id returned by main; null until it arrives */
  id: string | null
  text: string
  status: 'searching' | 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  sources: AskSource[]
  /** Numbers actually cited in the answer (only once finished) */
  cited: number[]
  range: DateRange | null
  /** false = no vectors were used this time */
  vector: boolean
  /** Chunks received before the id arrived (shouldn't happen in theory, kept just in case) */
  early: AnswerChunk[]
}

export type ChatEntry = Question | Answer

export interface Conversation {
  entries: ChatEntry[]
}

export const emptyConversation = (): Conversation => ({ entries: [] })

/** The last answer */
export function lastAnswer(c: Conversation): Answer | null {
  const e = c.entries[c.entries.length - 1]
  return e?.role === 'assistant' ? e : null
}

export function isRunning(c: Conversation): boolean {
  const a = lastAnswer(c)
  return !!a && (a.status === 'searching' || a.status === 'running')
}

/** Conversation history sent to main: only finished Q&A (failed, or stopped without content, don't count) */
export function chatHistory(c: Conversation): ChatTurn[] {
  const out: ChatTurn[] = []
  for (let i = 0; i + 1 < c.entries.length; i += 2) {
    const q = c.entries[i]
    const a = c.entries[i + 1]
    if (q.role !== 'user' || a.role !== 'assistant' || !a.text.trim()) continue
    if (a.status === 'error') continue
    out.push({ role: 'user', content: q.text }, { role: 'assistant', content: a.text })
  }
  return out
}

export function askQuestion(c: Conversation, question: string): Conversation {
  const answer: Answer = {
    role: 'assistant',
    id: null,
    text: '',
    status: 'searching',
    error: null,
    sources: [],
    cited: [],
    range: null,
    vector: true,
    early: []
  }
  return { entries: [...c.entries, { role: 'user', text: question }, answer] }
}

function updateLast(c: Conversation, f: (a: Answer) => Answer): Conversation {
  const a = lastAnswer(c)
  if (!a) return c
  const next = f(a)
  return next === a ? c : { entries: [...c.entries.slice(0, -1), next] }
}

/** Takes the request id and applies chunks received before it */
export function withAnswerId(c: Conversation, id: string): Conversation {
  return updateLast(c, (a) => {
    if (a.id !== null || !isActive(a)) return a
    return a.early.filter((x) => x.id === id).reduce(applyTo, { ...a, id, early: [] })
  })
}

export function applyAnswerChunk(c: Conversation, chunk: AnswerChunk): Conversation {
  return updateLast(c, (a) => applyTo(a, chunk))
}

const isActive = (a: Answer): boolean => a.status === 'searching' || a.status === 'running'

function applyTo(a: Answer, c: AnswerChunk): Answer {
  if (a.id === null) return isActive(a) ? { ...a, early: [...a.early, c] } : a
  if (c.id !== a.id || !isActive(a)) return a
  let next: Answer = { ...a, text: a.text + c.delta }
  if (c.sources) {
    next = {
      ...next,
      status: 'running',
      sources: c.sources,
      range: c.range ?? null,
      vector: c.vector ?? true
    }
  }
  if (!c.done) return next
  if (c.error) return { ...next, status: 'error', error: c.error }
  return { ...next, status: 'done', cited: c.cited ?? [] }
}

/** The user clicked Stop: ignore every chunk that arrives afterwards */
export function stopAnswer(c: Conversation): Conversation {
  return updateLast(c, (a) => (isActive(a) ? { ...a, status: 'stopped' } : a))
}

export function failAnswer(c: Conversation, error: string): Conversation {
  return updateLast(c, (a) => (isActive(a) ? { ...a, status: 'error', error } : a))
}

/** Text for copying: [n] becomes [[source title]], so it's still a working link when pasted into a note */
export function answerForCopy(a: Answer): string {
  const titles = new Map(a.sources.map((s) => [s.n, s.title]))
  return a.text
    .replace(/\[(\d+)\]/g, (m, n: string) => {
      const t = titles.get(Number(n))
      return t ? `[[${t}]]` : m
    })
    .trim()
}

/** Source order: cited ones first (by number), the rest listed separately */
export function splitSources(a: Answer): { cited: AskSource[]; other: AskSource[] } {
  // While streaming the final citations aren't known yet, so look in the current text
  const used = new Set(
    a.status === 'done' ? a.cited : [...a.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
  )
  return {
    cited: a.sources.filter((s) => used.has(s.n)),
    other: a.sources.filter((s) => !used.has(s.n))
  }
}

const MODE_KEY = 'knowmon.ai.mode'
export type AiMode = 'chat' | 'agent' | 'summary'

/** Whether the AI tab shows chat, the agent or the summary (shared by all vaults), chat by default */
export function loadAiMode(): AiMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'summary' || v === 'agent' ? v : 'chat'
  } catch {
    return 'chat'
  }
}

export function saveAiMode(mode: AiMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // If it can't be saved, only the next launch is affected
  }
}
