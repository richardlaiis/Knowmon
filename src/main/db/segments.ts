// Splits text into TextSegments (match / no match) for search snippets and backlink context
import type { TextSegment } from '../../shared/types'

export type Range = [from: number, to: number]

/** Splits by ranges; overlapping or adjacent ranges are merged. Runs of whitespace become one space. */
export function toSegments(text: string, ranges: readonly Range[]): TextSegment[] {
  const sorted = ranges
    .map(([a, b]): Range => [Math.max(0, a), Math.min(text.length, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: Range[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const out: TextSegment[] = []
  const push = (s: string, match: boolean): void => {
    const t = s.replace(/\s+/g, ' ')
    if (t) out.push({ text: t, match })
  }
  let pos = 0
  for (const [a, b] of merged) {
    push(text.slice(pos, a), false)
    push(text.slice(a, b), true)
    pos = b
  }
  push(text.slice(pos), false)
  if (out.length) {
    out[0].text = out[0].text.trimStart()
    out[out.length - 1].text = out[out.length - 1].text.trimEnd()
  }
  return out.filter((s) => s.text)
}

/**
 * Keeps only about max characters of text around the first match, adding "…" where text was cut.
 * Returns the cut text and the shifted ranges.
 */
export function clip(
  text: string,
  ranges: readonly Range[],
  max: number,
  before = 40
): { text: string; ranges: Range[] } {
  if (text.length <= max) return { text, ranges: [...ranges] }
  const first = ranges.length ? Math.min(...ranges.map((r) => r[0])) : 0
  // When the match is near the end, move the window back to fill max as much as possible
  const lead = Math.min(before, Math.floor(max / 2))
  const start = Math.max(0, Math.min(first - lead, text.length - max))
  const end = Math.min(text.length, start + max)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const shift = prefix.length - start
  return {
    text: prefix + text.slice(start, end) + suffix,
    ranges: ranges
      .filter(([a, b]) => b > start && a < end)
      .map(([a, b]): Range => [Math.max(a, start) + shift, Math.min(b, end) + shift])
  }
}

/** Finds every position of needle in text, case-insensitively */
export function findAll(text: string, needle: string): Range[] {
  const hay = text.toLowerCase()
  const n = needle.toLowerCase()
  // Positions are unreliable when toLowerCase changes the length (a few Unicode characters), so match on the original text instead
  const [h, k] =
    hay.length === text.length && n.length === needle.length ? [hay, n] : [text, needle]
  const out: Range[] = []
  if (!k) return out
  for (let i = h.indexOf(k); i >= 0; i = h.indexOf(k, i + k.length)) out.push([i, i + k.length])
  return out
}
