// Graph data: notes are nodes, and resolved wikilinks and time edges are edges (targets that don't exist yet are left out)
import { localDay } from '../../shared/time'
import type { GraphData, GraphEdge, GraphNode } from '../../shared/types'
import type { DB } from '.'

export function getGraph(db: DB): GraphData {
  const rows = db
    .prepare('SELECT id, path, title, event_date AS eventDate FROM notes ORDER BY path')
    .all() as (Omit<GraphNode, 'activeDays'> & { id: number })[]
  const days = activeDays(db)
  const nodes = rows.map(({ id, ...n }) => ({ ...n, activeDays: days.get(id) ?? [] }))
  // A pair of notes may have several rows ([[a]] and [[資料夾/a]] resolving to the same note), so merge them and sum the weights
  const edges = db
    .prepare(
      `SELECT s.path AS source, d.path AS target, l.type AS type, SUM(l.weight) AS weight
       FROM links l
       JOIN notes s ON s.id = l.src
       JOIN notes d ON d.id = l.dst
       WHERE l.src != l.dst
       GROUP BY l.src, l.dst, l.type
       ORDER BY s.path, d.path, l.type`
    )
    .all() as GraphEdge[]
  return { nodes, edges }
}

/** Dates on which each note has create / edit events (local time zone, ascending, unique) */
function activeDays(db: DB): Map<number, string[]> {
  const rows = db
    .prepare(
      "SELECT note_id AS id, ts FROM note_events WHERE kind IN ('create', 'edit') ORDER BY note_id, ts"
    )
    .all() as { id: number; ts: number }[]
  const out = new Map<number, string[]>()
  for (const r of rows) {
    const list = out.get(r.id) ?? []
    const day = localDay(r.ts)
    if (list[list.length - 1] !== day) list.push(day)
    out.set(r.id, list)
  }
  return out
}
