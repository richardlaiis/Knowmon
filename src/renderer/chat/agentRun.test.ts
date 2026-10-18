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
    withTaskId(startTask(s, '任務'), 'r1')
  )
}

describe('agentRun', () => {
  it('文字與步驟依到達順序排列，同 index 的步驟取代', () => {
    const s = run([
      { delta: '我先' },
      { delta: '搜尋。' },
      { step: step(0, 'running') },
      { step: step(0, 'done', '找到 3 篇') },
      { delta: '結論' },
      { delta: '是…' }
    ])
    expect(lastTask(s)!.items).toEqual([
      { kind: 'text', text: '我先搜尋。' },
      { kind: 'step', step: step(0, 'done', '找到 3 篇') },
      { kind: 'text', text: '結論是…' }
    ])
    expect(finalText(lastTask(s)!)).toBe('結論是…')
    expect(isTaskRunning(s)).toBe(true)
  })

  it('done 與錯誤', () => {
    expect(lastTask(run([{ delta: 'a', done: true }]))!.status).toBe('done')
    const failed = lastTask(run([{ done: true, error: 'Cannot connect' }]))!
    expect(failed).toMatchObject({ status: 'error', error: 'Cannot connect' })
  })

  it('拿到 id 之前的片段先存著；其他任務的片段忽略', () => {
    let s = startTask(emptySession(), '任務')
    s = applyAgentChunk(s, chunk({ delta: '早到的' }))
    s = applyAgentChunk(s, chunk({ id: 'other', delta: '別人的' }))
    s = withTaskId(s, 'r1')
    s = applyAgentChunk(s, chunk({ id: 'other', delta: '別人的' }))
    expect(finalText(lastTask(s)!)).toBe('早到的')
  })

  it('等待確認的步驟；停止後不再算等待，之後的片段忽略', () => {
    const s = run([{ step: step(0, 'done') }, { step: step(1, 'confirm') }])
    expect(pendingConfirm(s)?.index).toBe(1)
    const stopped = stopTask(s)
    expect(pendingConfirm(stopped)).toBeNull()
    expect(applyAgentChunk(stopped, chunk({ delta: 'x' }))).toBe(stopped)
    expect(lastTask(stopped)!.status).toBe('stopped')
  })

  it('history 只取完成的任務與最終回答', () => {
    let s = run([{ delta: '說明' }, { step: step(0, 'done') }, { delta: '答案' }, { done: true }])
    s = failTask(startTask(s, '失敗的'), 'boom')
    s = run([{ step: step(0, 'done') }, { done: true }], s) // 沒有最終回答
    s = startTask(s, '進行中')
    expect(agentHistory(s)).toEqual([
      { role: 'user', content: '任務' },
      { role: 'assistant', content: '答案' }
    ])
  })
})
