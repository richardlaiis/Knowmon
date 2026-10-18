// Agent 任務的狀態（純函式）：送出任務、取得 request id、套用 main 推送的步驟與文字。
// 只存在記憶體，換 vault 時清空。
import type { AgentChunk, AgentStep, ChatTurn } from '../../shared/types'

/** 任務過程依到達順序排列：模型的文字與工具步驟交錯 */
export type AgentItem = { kind: 'text'; text: string } | { kind: 'step'; step: AgentStep }

export interface AgentTask {
  task: string
  /** main 回傳的 request id；拿到之前為 null */
  id: string | null
  status: 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  items: AgentItem[]
  /** 拿到 id 之前先收到的片段 */
  early: AgentChunk[]
}

export interface AgentSession {
  tasks: AgentTask[]
}

export const emptySession = (): AgentSession => ({ tasks: [] })

export function lastTask(s: AgentSession): AgentTask | null {
  return s.tasks[s.tasks.length - 1] ?? null
}

export function isTaskRunning(s: AgentSession): boolean {
  return lastTask(s)?.status === 'running'
}

/** 正在等待使用者確認的步驟 */
export function pendingConfirm(s: AgentSession): AgentStep | null {
  const t = lastTask(s)
  if (t?.status !== 'running') return null
  for (const item of t.items) {
    if (item.kind === 'step' && item.step.status === 'confirm') return item.step
  }
  return null
}

/** 最後一個步驟之後的文字（最終回答）；之前的是步驟之間的說明 */
export function finalText(t: AgentTask): string {
  const i = t.items.findLastIndex((x) => x.kind === 'step')
  return t.items
    .slice(i + 1)
    .map((x) => (x.kind === 'text' ? x.text : ''))
    .join('')
}

/** 送給 main 的脈絡：之前的任務與最終回答（不含工具過程） */
export function agentHistory(s: AgentSession): ChatTurn[] {
  return s.tasks.flatMap((t): ChatTurn[] => {
    const answer = finalText(t).trim()
    if (t.status === 'running' || t.status === 'error' || !answer) return []
    return [
      { role: 'user', content: t.task },
      { role: 'assistant', content: answer }
    ]
  })
}

export function startTask(s: AgentSession, task: string): AgentSession {
  const t: AgentTask = { task, id: null, status: 'running', error: null, items: [], early: [] }
  return { tasks: [...s.tasks, t] }
}

function updateLast(s: AgentSession, f: (t: AgentTask) => AgentTask): AgentSession {
  const t = lastTask(s)
  if (!t) return s
  const next = f(t)
  return next === t ? s : { tasks: [...s.tasks.slice(0, -1), next] }
}

/** 取得 request id，套用之前先收到的片段 */
export function withTaskId(s: AgentSession, id: string): AgentSession {
  return updateLast(s, (t) => {
    if (t.id !== null || t.status !== 'running') return t
    return t.early.filter((c) => c.id === id).reduce(applyTo, { ...t, id, early: [] })
  })
}

export function applyAgentChunk(s: AgentSession, c: AgentChunk): AgentSession {
  return updateLast(s, (t) => applyTo(t, c))
}

function applyTo(t: AgentTask, c: AgentChunk): AgentTask {
  if (t.status !== 'running') return t
  if (t.id === null) return { ...t, early: [...t.early, c] }
  if (c.id !== t.id) return t
  let items = t.items
  if (c.step) {
    const step = c.step
    const i = items.findIndex((x) => x.kind === 'step' && x.step.index === step.index)
    items =
      i >= 0
        ? items.map((x, j) => (j === i ? { kind: 'step', step } : x))
        : [...items, { kind: 'step', step }]
  }
  if (c.delta) {
    const last = items[items.length - 1]
    items =
      last?.kind === 'text'
        ? [...items.slice(0, -1), { kind: 'text', text: last.text + c.delta }]
        : [...items, { kind: 'text', text: c.delta }]
  }
  const next = items === t.items ? t : { ...t, items }
  if (!c.done) return next
  if (c.error) return { ...next, status: 'error', error: c.error }
  return { ...next, status: 'done' }
}

/** 使用者按下停止：之後到達的片段都忽略（等待中的確認由 main 視為拒絕） */
export function stopTask(s: AgentSession): AgentSession {
  return updateLast(s, (t) => (t.status === 'running' ? { ...t, status: 'stopped' } : t))
}

export function failTask(s: AgentSession, error: string): AgentSession {
  return updateLast(s, (t) => (t.status === 'running' ? { ...t, status: 'error', error } : t))
}
