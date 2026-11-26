// Agent task state (pure functions): sending a task, getting the request id, applying the steps and text pushed by main.
// Kept only in memory and cleared when switching vaults.
import type { AgentChunk, AgentStep, ChatTurn } from '../../shared/types'

/** The task's progress in order of arrival: model text interleaved with tool steps */
export type AgentItem = { kind: 'text'; text: string } | { kind: 'step'; step: AgentStep }

export interface AgentTask {
  task: string
  /** The request id returned by main; null until it arrives */
  id: string | null
  status: 'running' | 'done' | 'stopped' | 'error'
  error: string | null
  items: AgentItem[]
  /** Chunks received before the id arrived */
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

/** The step waiting for the user's confirmation */
export function pendingConfirm(s: AgentSession): AgentStep | null {
  const t = lastTask(s)
  if (t?.status !== 'running') return null
  for (const item of t.items) {
    if (item.kind === 'step' && item.step.status === 'confirm') return item.step
  }
  return null
}

/** Text after the last step (the final answer); text before it explains the steps */
export function finalText(t: AgentTask): string {
  const i = t.items.findLastIndex((x) => x.kind === 'step')
  return t.items
    .slice(i + 1)
    .map((x) => (x.kind === 'text' ? x.text : ''))
    .join('')
}

/** Context sent to main: earlier tasks and final answers (without the tool steps) */
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

/** Takes the request id and applies chunks received before it */
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

/** The user clicked Stop: ignore every chunk that arrives afterwards (main treats a pending confirmation as rejected) */
export function stopTask(s: AgentSession): AgentSession {
  return updateLast(s, (t) => (t.status === 'running' ? { ...t, status: 'stopped' } : t))
}

export function failTask(s: AgentSession, error: string): AgentSession {
  return updateLast(s, (t) => (t.status === 'running' ? { ...t, status: 'error', error } : t))
}
