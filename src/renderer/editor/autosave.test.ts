import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutosave', () => {
  it('停止輸入後只寫最後一次內容', async () => {
    const save = vi.fn(async () => {})
    const a = createAutosave(save, 500)
    a.schedule('a.md', '1')
    await vi.advanceTimersByTimeAsync(300)
    a.schedule('a.md', '12')
    expect(a.isDirty('a.md')).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('a.md', '12')
    expect(a.isDirty('a.md')).toBe(false)
  })

  it('flush 立即寫出，切換筆記時先寫前一篇', async () => {
    const save = vi.fn(async () => {})
    const a = createAutosave(save, 500)
    a.schedule('a.md', 'A')
    a.schedule('b.md', 'B')
    await a.flush()
    expect(save.mock.calls).toEqual([
      ['a.md', 'A'],
      ['b.md', 'B']
    ])
  })

  it('cancel 放棄未儲存內容', async () => {
    const save = vi.fn(async () => {})
    const a = createAutosave(save, 500)
    a.schedule('a.md', 'A')
    a.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('寫入依序進行，失敗時交給 onError', async () => {
    const order: string[] = []
    const onError = vi.fn()
    const save = vi.fn(async (_p: string, c: string) => {
      await new Promise((r) => setTimeout(r, c === '慢' ? 100 : 0))
      if (c === '壞') throw new Error('寫入失敗')
      order.push(c)
    })
    const a = createAutosave(save, 500, onError)
    a.schedule('a.md', '慢')
    void a.flush()
    a.schedule('a.md', '壞')
    void a.flush()
    a.schedule('a.md', '快')
    const done = a.flush()
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(order).toEqual(['慢', '快'])
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
