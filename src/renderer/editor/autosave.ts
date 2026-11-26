// Autosaves after typing pauses; flush before switching notes, renaming or deleting

export interface Autosave {
  schedule(path: string, content: string): void
  /** Writes out unsaved content immediately */
  flush(): Promise<void>
  /** Discards unsaved content (for example when the note was deleted externally) */
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
      // Write in order so old content never reaches the disk after newer content
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
