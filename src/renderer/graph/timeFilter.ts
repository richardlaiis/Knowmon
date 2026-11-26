// Time range filtering for the graph (pure functions). Only decides which nodes to hide, without affecting layout.
import { dayNumber } from '../../shared/time'
import type { GraphData, GraphNode } from '../../shared/types'

/** event: when the events in the content happened (eventDate); written: when it was written (dates with create / edit) */
export type TimeAxis = 'event' | 'written'

export interface TimeFilter {
  axis: TimeAxis
  /** The range (dayNumber, inclusive at both ends); null means unlimited */
  range: [number, number] | null
  /** Whether to show notes with no date on this timeline */
  undated: boolean
}

/** A node's dates on this timeline (dayNumber, ascending) */
export function nodeDays(n: GraphNode, axis: TimeAxis): number[] {
  if (axis === 'event') return n.eventDate ? [dayNumber(n.eventDate)] : []
  return n.activeDays.map(dayNumber)
}

/** The earliest and latest of all node dates; null when there are none */
export function timeDomain(data: GraphData, axis: TimeAxis): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const n of data.nodes) {
    const days = nodeDays(n, axis)
    if (!days.length) continue
    min = Math.min(min, days[0])
    max = Math.max(max, days[days.length - 1])
  }
  return min <= max ? [min, max] : null
}

/** Nodes to hide: undated ones when undated notes aren't shown, or ones with no date in range */
export function hiddenByTime(data: GraphData, f: TimeFilter): Set<string> {
  const hidden = new Set<string>()
  for (const n of data.nodes) {
    const days = nodeDays(n, f.axis)
    if (!days.length) {
      if (!f.undated) hidden.add(n.path)
    } else if (f.range) {
      const [from, to] = f.range
      if (!days.some((d) => d >= from && d <= to)) hidden.add(n.path)
    }
  }
  return hidden
}

/**
 * The range after moving one end of the two-handle slider: kept within the domain, with the start never past the end
 * (dragging too far pushes the other end along).
 */
export function moveRange(
  range: [number, number],
  domain: [number, number],
  end: 0 | 1,
  value: number
): [number, number] {
  const v = Math.min(domain[1], Math.max(domain[0], Math.round(value)))
  return end === 0 ? [v, Math.max(v, range[1])] : [Math.min(v, range[0]), v]
}

/** Clamps to the domain (the range may exceed it after a data update); null (unlimited) when it equals the domain */
export function clampRange(
  range: [number, number] | null,
  domain: [number, number] | null
): [number, number] | null {
  if (!range || !domain) return null
  const from = Math.max(domain[0], Math.min(range[0], domain[1]))
  const to = Math.min(domain[1], Math.max(range[1], from))
  return from === domain[0] && to === domain[1] ? null : [from, to]
}
