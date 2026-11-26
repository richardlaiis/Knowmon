import { describe, expect, it } from 'vitest'
import type { AgentChunk, AgentStep } from '../../shared/types'
import {
  agentHistory,
  applyAgentChunk,
  emptySession,
  failTask,
  finalText,
  isTaskRunning,
  lastTask,
  pendingConfirm,
  startTask,
  stopTask,
  withTaskId,
  type AgentSession
} from './agentRun'

const step = (index: number, status: AgentStep['status'], label = `step ${index}`): AgentStep => ({
  index,
  tool: 'search_notes',
  args: {},
  status,
  label,
  notes: []
})
const chunk = (c: Partial<AgentChunk>): AgentChunk => ({ id: 'r1', delta: '', done: false, ...c })

function run(chunks: Partial<AgentChunk>[], s: AgentSession = emptySession()): AgentSession {
  return chunks.reduce(
    (acc, c) => applyAgentChunk(acc, chunk(c)),
    withTaskId(startTask(s, 'task'), 'r1')
  )
}

describe('agentRun', () => {
  it('orders text and steps by arrival, replacing steps with the same index', () => {
    const s = run([
      { delta: 'Let me ' },
      { delta: 'search.' },
      { step: step(0, 'running') },
      { step: step(0, 'done', 'Found 3 notes') },
      { delta: 'The answer ' },
      { delta: 'is…' }
    ])
    expect(lastTask(s)!.items).toEqual([
      { kind: 'text', text: 'Let me search.' },
      { kind: 'step', step: step(0, 'done', 'Found 3 notes') },
      { kind: 'text', text: 'The answer is…' }
    ])
    expect(finalText(lastTask(s)!)).toBe('The answer is…')
    expect(isTaskRunning(s)).toBe(true)
  })

  it('done and errors', () => {
    expect(lastTask(run([{ delta: 'a', done: true }]))!.status).toBe('done')
    const failed = lastTask(run([{ done: true, error: 'Cannot connect' }]))!
    expect(failed).toMatchObject({ status: 'error', error: 'Cannot connect' })
  })

  it('keeps chunks that arrive before the id; ignores chunks for other tasks', () => {
    let s = startTask(emptySession(), 'task')
    s = applyAgentChunk(s, chunk({ delta: 'early' }))
    s = applyAgentChunk(s, chunk({ id: 'other', delta: 'other' }))
    s = withTaskId(s, 'r1')
    s = applyAgentChunk(s, chunk({ id: 'other', delta: 'other' }))
    expect(finalText(lastTask(s)!)).toBe('early')
  })

  it('a step waiting for confirmation; after stopping it no longer counts as waiting, and later chunks are ignored', () => {
    const s = run([{ step: step(0, 'done') }, { step: step(1, 'confirm') }])
    expect(pendingConfirm(s)?.index).toBe(1)
    const stopped = stopTask(s)
    expect(pendingConfirm(stopped)).toBeNull()
    expect(applyAgentChunk(stopped, chunk({ delta: 'x' }))).toBe(stopped)
    expect(lastTask(stopped)!.status).toBe('stopped')
  })

  it('history takes only finished tasks and final answers', () => {
    let s = run([
      { delta: 'explanation' },
      { step: step(0, 'done') },
      { delta: 'answer' },
      { done: true }
    ])
    s = failTask(startTask(s, 'failed'), 'boom')
    s = run([{ step: step(0, 'done') }, { done: true }], s) // no final answer
    s = startTask(s, 'running')
    expect(agentHistory(s)).toEqual([
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'answer' }
    ])
  })
})
