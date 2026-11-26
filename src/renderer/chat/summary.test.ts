import { describe, expect, it } from 'vitest'
import { applyChunk, failSummary, startSummary, stopSummary, withId } from './summary'

describe('summary state', () => {
  it('applies chunks in order and finishes on done', () => {
    let s = withId(startSummary('a.md', false), 'x')
    s = applyChunk(s, { id: 'x', delta: '- Key', done: false })
    s = applyChunk(s, { id: 'other', delta: 'other', done: false })
    s = applyChunk(s, { id: 'x', delta: ' points', done: false })
    s = applyChunk(s, { id: 'x', delta: '', done: true })
    expect(s).toMatchObject({ text: '- Key points', status: 'done', error: null })
  })

  it('chunks received before the id are applied once the id arrives', () => {
    let s = startSummary('a.md', true)
    s = applyChunk(s, { id: 'x', delta: 'early', done: false })
    s = applyChunk(s, { id: 'y', delta: 'old', done: false })
    s = withId(s, 'x')
    expect(s).toMatchObject({ id: 'x', text: 'early', selection: true, early: [] })
  })

  it('errors and stopping', () => {
    const s = withId(startSummary('a.md', false), 'x')
    expect(applyChunk(s, { id: 'x', delta: '', done: true, error: 'offline' })).toMatchObject({
      status: 'error',
      error: 'offline'
    })
    const stopped = stopSummary(applyChunk(s, { id: 'x', delta: 'one', done: false }))
    expect(applyChunk(stopped, { id: 'x', delta: 'two', done: false })).toMatchObject({
      text: 'one',
      status: 'stopped'
    })
    expect(failSummary(s, 'boom')).toMatchObject({ status: 'error', error: 'boom' })
  })
})
