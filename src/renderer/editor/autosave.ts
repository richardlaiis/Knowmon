// 停止輸入一段時間後自動儲存；切換筆記、改名、刪除前要先 flush

export interface Autosave {
  schedule(path: string, content: string): void
  /** 立即寫出尚未儲存的內容 */
  flush(): Promise<void>
  /** 放棄尚未儲存的內容（例如筆記已被外部刪除） */
  cancel(): void
  isDirty(path: string): boolean
}

export function createAutosave(
  save: (path: string, content: string) => Promise<void>,
  delayMs = 500,
  onError: (e: unknown) => void = console.error
): Autosave {
  let pending: { path: string; content: string } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> = Promise.resolve()

  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const flush = (): Promise<void> => {
    clear()
    const job = pending
    pending = null
    if (job) {
      // 依序寫入，避免舊內容比新內容晚寫到磁碟
      inflight = inflight.then(() => save(job.path, job.content)).catch(onError)
    }
    return inflight
  }

  return {
    schedule(path, content) {
      if (pending && pending.path !== path) void flush()
      pending = { path, content }
      clear()
      timer = setTimeout(() => void flush(), delayMs)
    },
    flush,
    cancel() {
      clear()
      pending = null
    },
    isDirty: (path) => pending?.path === path
  }
}
