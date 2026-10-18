import { describe, expect, it } from 'vitest'
import type { AskSource } from '../../shared/types'
import {
  answerForCopy,
  applyAnswerChunk,
  askQuestion,
  emptyConversation,
  failAnswer,
  chatHistory,
  isRunning,
  lastAnswer,
  splitSources,
  stopAnswer,
  withAnswerId,
  type Answer,
  type Conversation
} from './conversation'

const source = (n: number, title: string): AskSource => ({
  n,
  path: `${title}.md`,
  title,
  line: 1,
  snippet: [],
  date: '2026-09-01'
})
const sources = [source(1, '跑步'), source(2, '料理')]

/** 一輪完整的問答 */
function round(c: Conversation, q: string, id: string, a: string): Conversation {
  let next = withAnswerId(askQuestion(c, q), id)
  next = applyAnswerChunk(next, { id, delta: '', done: false, sources, range: null, vector: true })
  next = applyAnswerChunk(next, { id, delta: a, done: false })
  return applyAnswerChunk(next, { id, delta: '', done: true, cited: [1] })
}

describe('conversation', () => {
  it('送出問題、收到來源、串流回答、完成', () => {
    let c = askQuestion(emptyConversation(), '跑了多遠？')
    expect(c.entries.map((e) => e.role)).toEqual(['user', 'assistant'])
    expect(lastAnswer(c)?.status).toBe('searching')
    expect(isRunning(c)).toBe(true)

    c = withAnswerId(c, 'r1')
    const range = { from: '2026-09-01', to: '2026-09-30' }
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: false, sources, range, vector: false })
    expect(lastAnswer(c)).toMatchObject({ status: 'running', sources, range, vector: false })
    c = applyAnswerChunk(c, { id: 'r1', delta: '五公里 [1]', done: false })
    // 其他 request 的片段忽略
    c = applyAnswerChunk(c, { id: 'other', delta: 'x', done: false })
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: true, cited: [1] })
    expect(lastAnswer(c)).toMatchObject({ text: '五公里 [1]', status: 'done', cited: [1] })
    expect(isRunning(c)).toBe(false)
  })

  it('拿到 id 之前收到的片段先存著', () => {
    let c = askQuestion(emptyConversation(), 'q')
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: false, sources })
    c = applyAnswerChunk(c, { id: 'r1', delta: '甲', done: false })
    expect(lastAnswer(c)?.text).toBe('')
    c = withAnswerId(c, 'r1')
    expect(lastAnswer(c)).toMatchObject({ text: '甲', status: 'running', early: [] })
  })

  it('停止後忽略之後的片段；錯誤帶上原因', () => {
    let c = withAnswerId(askQuestion(emptyConversation(), 'q'), 'r1')
    c = stopAnswer(c)
    c = applyAnswerChunk(c, { id: 'r1', delta: '晚到', done: false })
    expect(lastAnswer(c)).toMatchObject({ status: 'stopped', text: '' })

    c = withAnswerId(askQuestion(c, 'q2'), 'r2')
    c = applyAnswerChunk(c, { id: 'r2', delta: '', done: true, error: 'offline' })
    expect(lastAnswer(c)).toMatchObject({ status: 'error', error: 'offline' })

    c = failAnswer(askQuestion(c, 'q3'), 'No vault')
    expect(lastAnswer(c)).toMatchObject({ status: 'error', error: 'No vault' })
  })

  it('chatHistory 只取有內容且沒有失敗的問答', () => {
    let c = round(emptyConversation(), '第一題', 'r1', '答一 [1]')
    c = failAnswer(askQuestion(c, '失敗的題'), 'x')
    c = stopAnswer(withAnswerId(askQuestion(c, '停掉的題'), 'r3'))
    c = round(c, '第二題', 'r4', '答二')
    expect(chatHistory(c)).toEqual([
      { role: 'user', content: '第一題' },
      { role: 'assistant', content: '答一 [1]' },
      { role: 'user', content: '第二題' },
      { role: 'assistant', content: '答二' }
    ])
  })

  it('複製時 [n] 換成 [[標題]]，不存在的編號保留', () => {
    const a = lastAnswer(round(emptyConversation(), 'q', 'r1', '跑步 [1]、料理 [2]、其他 [7]'))!
    expect(answerForCopy(a)).toBe('跑步 [[跑步]]、料理 [[料理]]、其他 [7]')
  })

  it('來源分成被引用的與其他的；串流中依目前的文字判斷', () => {
    const done = lastAnswer(round(emptyConversation(), 'q', 'r1', '跑步 [1]'))!
    expect(splitSources(done)).toEqual({ cited: [sources[0]], other: [sources[1]] })
    const streaming: Answer = { ...done, status: 'running', cited: [], text: '料理 [2]' }
    expect(splitSources(streaming)).toEqual({ cited: [sources[1]], other: [sources[0]] })
  })
})
