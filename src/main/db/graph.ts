// 圖譜資料：筆記為節點，已解析的 wikilink 為邊（尚未建立的目標不列入）
import type { GraphData, GraphEdge, GraphNode } from '../../shared/types'
import type { DB } from '.'

export function getGraph(db: DB): GraphData {
  const nodes = db
    .prepare('SELECT path, title, event_date AS eventDate FROM notes ORDER BY path')
    .all() as GraphNode[]
  // 同一對筆記可能有多列（[[a]] 與 [[資料夾/a]] 解析到同一篇），合併並加總權重
  const edges = db
    .prepare(
      `SELECT s.path AS source, d.path AS target, l.type AS type, SUM(l.weight) AS weight
       FROM links l
       JOIN notes s ON s.id = l.src
       JOIN notes d ON d.id = l.dst
       WHERE l.type = 'wikilink' AND l.src != l.dst
       GROUP BY l.src, l.dst, l.type
       ORDER BY s.path, d.path`
    )
    .all() as GraphEdge[]
  return { nodes, edges }
}
