// 問答對話的狀態（純函式）：送出問題、取得 request id、套用 main 推送的片段。
// 對話只存在記憶體，換 vault 時清空。
import type { AnswerChunk, AskSource, ChatTurn, DateRange } from '../../shared/types'

export interface Question {
  role: 'user'
  text: string
}

export interface Answer {
  role: 'assistant'
  /** main 回傳的 request id；拿到之前為 null */
  id: string | null
  text: string
  status: 'searching' | 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  sources: AskSource[]
  /** 回答中實際引用的編號（完成後才有） */
  cited: number[]
  range: DateRange | null
  /** false = 這次沒有用到向量 */
  vector: boolean
  /** 拿到 id 之前先收到的片段（理論上不會發生，保險起見先存著） */
  early: AnswerChunk[]
}

export type ChatEntry = Question | Answer

export interface Conversation {
  entries: ChatEntry[]
}

export const emptyConversation = (): Conversation => ({ entries: [] })

/** 最後一則回答 */
export function lastAnswer(c: Conversation): Answer | null {
  const e = c.entries[c.entries.length - 1]
  return e?.role === 'assistant' ? e : null
}

export function isRunning(c: Conversation): boolean {
  const a = lastAnswer(c)
  return !!a && (a.status === 'searching' || a.status === 'running')
}

/** 送給 main 的對話紀錄：只取完成的問答（失敗、停止且沒有內容的不算） */
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

/** 取得 request id，套用之前先收到的片段 */
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

/** 使用者按下停止：之後到達的片段都忽略 */
export function stopAnswer(c: Conversation): Conversation {
  return updateLast(c, (a) => (isActive(a) ? { ...a, status: 'stopped' } : a))
}

export function failAnswer(c: Conversation, error: string): Conversation {
  return updateLast(c, (a) => (isActive(a) ? { ...a, status: 'error', error } : a))
}

/** 複製用的文字：[n] 換成 [[來源標題]]，貼進筆記仍是有效的連結 */
export function answerForCopy(a: Answer): string {
  const titles = new Map(a.sources.map((s) => [s.n, s.title]))
  return a.text
    .replace(/\[(\d+)\]/g, (m, n: string) => {
      const t = titles.get(Number(n))
      return t ? `[[${t}]]` : m
    })
    .trim()
}

/** 來源排序：被引用的在前（依編號），其餘的另外列出 */
export function splitSources(a: Answer): { cited: AskSource[]; other: AskSource[] } {
  // 串流中還不知道最後引用了哪些，先從目前的文字找
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

/** AI 分頁目前顯示對話、agent 或總結（所有 vault 共用），預設對話 */
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
    // 無法儲存時只影響下次啟動
  }
}
