// 空白頁顯示的快捷鍵提示（資料與按鍵拆分，畫面在 App.tsx）

export interface ShortcutHint {
  /** 以 + 連接的按鍵，例如 'Ctrl+Shift+F'；Ctrl 在 macOS 顯示為 ⌘ */
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

/** 'Ctrl+Shift+F' → ['Ctrl', 'Shift', 'F']；mac 時 Ctrl 換成 ⌘ */
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
