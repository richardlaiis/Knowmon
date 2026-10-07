// 把文字切成 TextSegment（命中/非命中），供搜尋摘要與反向連結上下文使用
import type { TextSegment } from '../../shared/types'

export type Range = [from: number, to: number]

/** 依 ranges 切段；重疊或相鄰的範圍會合併。連續空白壓成一個空格。 */
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
 * 只保留 text 中第一個命中附近約 max 個字元，前後被截掉時加上「…」。
 * 回傳截取後的文字與平移過的 ranges。
 */
export function clip(
  text: string,
  ranges: readonly Range[],
  max: number,
  before = 40
): { text: string; ranges: Range[] } {
  if (text.length <= max) return { text, ranges: [...ranges] }
  const first = ranges.length ? Math.min(...ranges.map((r) => r[0])) : 0
  // 命中靠近結尾時視窗往前移，盡量填滿 max
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

/** 不分大小寫找出 needle 在 text 中的所有位置 */
export function findAll(text: string, needle: string): Range[] {
  const hay = text.toLowerCase()
  const n = needle.toLowerCase()
  // toLowerCase 改變長度（少數 Unicode 字元）時位置不可靠，改用原文比對
  const [h, k] =
    hay.length === text.length && n.length === needle.length ? [hay, n] : [text, needle]
  const out: Range[] = []
  if (!k) return out
  for (let i = h.indexOf(k); i >= 0; i = h.indexOf(k, i + k.length)) out.push([i, i + k.length])
  return out
}
