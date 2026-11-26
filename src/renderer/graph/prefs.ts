// Graph display preferences, stored in the renderer's localStorage (defaults when it can't be accessed)
export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Still usable when it can't be saved
  }
}
