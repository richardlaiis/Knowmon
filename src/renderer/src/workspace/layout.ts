// Widths and visibility of the left and right panels (pure functions + localStorage)
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

/** The editor always keeps at least this width */
export const EDITOR_MIN = 360

/**
 * Clamps a panel width: within [min, max], without squeezing the editor below EDITOR_MIN.
 * other is the width currently taken by the panel on the other side (0 when closed).
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
    // Still usable when it can't be saved
  }
}
