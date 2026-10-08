// 時間層的 DB 操作：重算時間邊、時間軸的事件查詢
import { deriveTimeLinks, type TimeLinkType } from '../indexer/timeLinks'
import type { ActivityEvent, TimeSettings } from '../../shared/types'
import type { DB } from '.'

export const TIME_LINK_TYPES: readonly TimeLinkType[] = ['same_session', 'same_day', 'sequence']

/** 刪掉所有時間邊，依目前的筆記、編輯事件與設定重新寫入 */
export function rebuildTimeLinks(db: DB, settings: TimeSettings): void {
  const notes = db.prepare('SELECT id, path, event_date AS eventDate FROM notes').all() as {
    id: number
    path: string
    eventDate: string | null
  }[]
  const edits = db
    .prepare("SELECT note_id AS noteId, ts FROM note_events WHERE kind = 'edit' ORDER BY ts, rowid")
    .all() as { noteId: number; ts: number }[]
  const links = deriveTimeLinks(notes, edits, settings)
  const remove = db.prepare('DELETE FROM links WHERE type = ?')
  const insert = db.prepare('INSERT INTO links (src, dst, type, weight) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    for (const type of TIME_LINK_TYPES) remove.run(type)
    for (const l of links) insert.run(l.src, l.dst, l.type, l.weight)
  })()
}

/** [from, to) 之間的 create / edit 事件，依時間排序 */
export function listActivity(db: DB, from: number, to: number): ActivityEvent[] {
  return db
    .prepare(
      `SELECT n.path AS path, n.title AS title, e.ts AS ts, e.kind AS kind
       FROM note_events e JOIN notes n ON n.id = e.note_id
       WHERE e.kind IN ('create', 'edit') AND e.ts >= ? AND e.ts < ?
       ORDER BY e.ts, e.rowid`
    )
    .all(from, to) as ActivityEvent[]
}
