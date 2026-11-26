// Shortcut hints shown on the empty page (the data and key splitting; the view is in App.tsx)

export interface ShortcutHint {
  /** Keys joined with +, for example 'Ctrl+Shift+F'; Ctrl shows as ⌘ on macOS */
  keys: string
  label: string
}

export const EMPTY_STATE_HINTS: readonly ShortcutHint[] = [
  { keys: 'Ctrl+O', label: 'Jump to a note' },
  { keys: 'Ctrl+Shift+F', label: 'Search' },
  { keys: 'Ctrl+G', label: 'Graph view' },
  { keys: 'Ctrl+Shift+T', label: 'Timeline' },
  { keys: 'Ctrl+Shift+S', label: 'Summarize' }
]

/** 'Ctrl+Shift+F' → ['Ctrl', 'Shift', 'F']; on a Mac, Ctrl becomes ⌘ */
export function splitKeys(keys: string, mac: boolean): string[] {
  return keys
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (mac && k === 'Ctrl' ? '⌘' : k))
}

export function isMacPlatform(userAgent: string): boolean {
  return /Mac/.test(userAgent)
}
