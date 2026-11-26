import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutosave', () => {
  it('writes only the last content after typing stops', async () => {
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

  it('flush writes immediately, and switching notes writes the previous one first', async () => {
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

  it('cancel discards unsaved content', async () => {
    const save = vi.fn(async () => {})
    const a = createAutosave(save, 500)
    a.schedule('a.md', 'A')
    a.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('writes happen in order, with failures passed to onError', async () => {
    const order: string[] = []
    const onError = vi.fn()
    const save = vi.fn(async (_p: string, c: string) => {
      await new Promise((r) => setTimeout(r, c === 'slow' ? 100 : 0))
      if (c === 'bad') throw new Error('write failed')
      order.push(c)
    })
    const a = createAutosave(save, 500, onError)
    a.schedule('a.md', 'slow')
    void a.flush()
    a.schedule('a.md', 'bad')
    void a.flush()
    a.schedule('a.md', 'fast')
    const done = a.flush()
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(order).toEqual(['slow', 'fast'])
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
