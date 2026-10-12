import { describe, expect, it } from 'vitest'
import { applyChunk, failSummary, startSummary, stopSummary, withId } from './summary'

describe('summary state', () => {
  it('依序套用片段，done 時完成', () => {
    let s = withId(startSummary('a.md', false), 'x')
    s = applyChunk(s, { id: 'x', delta: '- 重', done: false })
    s = applyChunk(s, { id: 'other', delta: '別人的', done: false })
    s = applyChunk(s, { id: 'x', delta: '點', done: false })
    s = applyChunk(s, { id: 'x', delta: '', done: true })
    expect(s).toMatchObject({ text: '- 重點', status: 'done', error: null })
  })

  it('取得 id 之前收到的片段會在取得 id 時套用', () => {
    let s = startSummary('a.md', true)
    s = applyChunk(s, { id: 'x', delta: '早', done: false })
    s = applyChunk(s, { id: 'y', delta: '舊的', done: false })
    s = withId(s, 'x')
    expect(s).toMatchObject({ id: 'x', text: '早', selection: true, early: [] })
  })

  it('錯誤、停止', () => {
    const s = withId(startSummary('a.md', false), 'x')
    expect(applyChunk(s, { id: 'x', delta: '', done: true, error: '離線' })).toMatchObject({
      status: 'error',
      error: '離線'
    })
    const stopped = stopSummary(applyChunk(s, { id: 'x', delta: '一', done: false }))
    expect(applyChunk(stopped, { id: 'x', delta: '二', done: false })).toMatchObject({
      text: '一',
      status: 'stopped'
    })
    expect(failSummary(s, 'boom')).toMatchObject({ status: 'error', error: 'boom' })
  })
})
