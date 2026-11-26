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
const sources = [source(1, 'Running'), source(2, 'Cooking')]

/** One complete round of Q&A */
function round(c: Conversation, q: string, id: string, a: string): Conversation {
  let next = withAnswerId(askQuestion(c, q), id)
  next = applyAnswerChunk(next, { id, delta: '', done: false, sources, range: null, vector: true })
  next = applyAnswerChunk(next, { id, delta: a, done: false })
  return applyAnswerChunk(next, { id, delta: '', done: true, cited: [1] })
}

describe('conversation', () => {
  it('sends a question, receives sources, streams the answer, finishes', () => {
    let c = askQuestion(emptyConversation(), 'How far did I run?')
    expect(c.entries.map((e) => e.role)).toEqual(['user', 'assistant'])
    expect(lastAnswer(c)?.status).toBe('searching')
    expect(isRunning(c)).toBe(true)

    c = withAnswerId(c, 'r1')
    const range = { from: '2026-09-01', to: '2026-09-30' }
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: false, sources, range, vector: false })
    expect(lastAnswer(c)).toMatchObject({ status: 'running', sources, range, vector: false })
    c = applyAnswerChunk(c, { id: 'r1', delta: '5 km [1]', done: false })
    // Chunks for other requests are ignored
    c = applyAnswerChunk(c, { id: 'other', delta: 'x', done: false })
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: true, cited: [1] })
    expect(lastAnswer(c)).toMatchObject({ text: '5 km [1]', status: 'done', cited: [1] })
    expect(isRunning(c)).toBe(false)
  })

  it('keeps chunks that arrive before the id', () => {
    let c = askQuestion(emptyConversation(), 'q')
    c = applyAnswerChunk(c, { id: 'r1', delta: '', done: false, sources })
    c = applyAnswerChunk(c, { id: 'r1', delta: 'first', done: false })
    expect(lastAnswer(c)?.text).toBe('')
    c = withAnswerId(c, 'r1')
    expect(lastAnswer(c)).toMatchObject({ text: 'first', status: 'running', early: [] })
  })

  it('ignores chunks after stopping; errors carry the reason', () => {
    let c = withAnswerId(askQuestion(emptyConversation(), 'q'), 'r1')
    c = stopAnswer(c)
    c = applyAnswerChunk(c, { id: 'r1', delta: 'late', done: false })
    expect(lastAnswer(c)).toMatchObject({ status: 'stopped', text: '' })

    c = withAnswerId(askQuestion(c, 'q2'), 'r2')
    c = applyAnswerChunk(c, { id: 'r2', delta: '', done: true, error: 'offline' })
    expect(lastAnswer(c)).toMatchObject({ status: 'error', error: 'offline' })

    c = failAnswer(askQuestion(c, 'q3'), 'No vault')
    expect(lastAnswer(c)).toMatchObject({ status: 'error', error: 'No vault' })
  })

  it('chatHistory takes only Q&A with content that did not fail', () => {
    let c = round(emptyConversation(), 'first question', 'r1', 'answer one [1]')
    c = failAnswer(askQuestion(c, 'failed question'), 'x')
    c = stopAnswer(withAnswerId(askQuestion(c, 'stopped question'), 'r3'))
    c = round(c, 'second question', 'r4', 'answer two')
    expect(chatHistory(c)).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'answer one [1]' },
      { role: 'user', content: 'second question' },
      { role: 'assistant', content: 'answer two' }
    ])
  })

  it('copying replaces [n] with [[title]], keeping numbers that do not exist', () => {
    const a = lastAnswer(
      round(emptyConversation(), 'q', 'r1', 'running [1], cooking [2], other [7]')
    )!
    expect(answerForCopy(a)).toBe('running [[Running]], cooking [[Cooking]], other [7]')
  })

  it('splits sources into cited and others; while streaming, decides by the current text', () => {
    const done = lastAnswer(round(emptyConversation(), 'q', 'r1', 'running [1]'))!
    expect(splitSources(done)).toEqual({ cited: [sources[0]], other: [sources[1]] })
    const streaming: Answer = { ...done, status: 'running', cited: [], text: 'cooking [2]' }
    expect(splitSources(streaming)).toEqual({ cited: [sources[1]], other: [sources[0]] })
  })
})
