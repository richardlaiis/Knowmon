// 左右面板的寬度與開關（純函式 + localStorage 讀寫）
export interface LayoutPrefs {
  left: number
  right: number
  leftOpen: boolean
  rightOpen: boolean
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  left: 280,
  right: 300,
  leftOpen: true,
  rightOpen: true
}

export const PANE_LIMITS = {
  left: { min: 180, max: 560 },
  right: { min: 220, max: 640 }
} as const

/** 編輯器至少保留這麼寬 */
export const EDITOR_MIN = 360

/**
 * 限制面板寬度：在 [min, max] 之間，且不能把編輯器擠到 EDITOR_MIN 以下。
 * other 是另一側面板目前佔用的寬度（關閉時為 0）。
 */
export function clampWidth(
  width: number,
  limits: { min: number; max: number },
  windowWidth: number,
  other: number
): number {
  const room = windowWidth - other - EDITOR_MIN
  const max = Math.max(limits.min, Math.min(limits.max, room))
  return Math.round(Math.min(max, Math.max(limits.min, width)))
}

const KEY = 'knowmon.layout'

export function parseLayout(raw: string | null): LayoutPrefs {
  try {
    const v = raw ? JSON.parse(raw) : null
    if (!v || typeof v !== 'object') return DEFAULT_LAYOUT
    const num = (x: unknown, d: number): number =>
      typeof x === 'number' && Number.isFinite(x) ? x : d
    const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d)
    return {
      left: num(v.left, DEFAULT_LAYOUT.left),
      right: num(v.right, DEFAULT_LAYOUT.right),
      leftOpen: bool(v.leftOpen, DEFAULT_LAYOUT.leftOpen),
      rightOpen: bool(v.rightOpen, DEFAULT_LAYOUT.rightOpen)
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function loadLayout(): LayoutPrefs {
  try {
    return parseLayout(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(p: LayoutPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // 無法儲存時仍可使用
  }
}
