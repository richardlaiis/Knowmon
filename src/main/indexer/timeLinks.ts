// 由筆記與編輯事件推導時間邊（same_session、same_day、sequence）。純函式，不碰 DB。
import { dayNumber, sessionize } from '../../shared/time'
import type { TimeSettings } from '../../shared/types'

export type TimeLinkType = 'same_session' | 'same_day' | 'sequence'

export interface TimeNote {
  id: number
  path: string
  eventDate: string | null
}

export interface EditEvent {
  noteId: number
  ts: number
}

export interface TimeLink {
  src: number
  dst: number
  type: TimeLinkType
  weight: number
}

export function deriveTimeLinks(
  notes: readonly TimeNote[],
  edits: readonly EditEvent[],
  settings: TimeSettings
): TimeLink[] {
  return [
    ...sessionLinks(notes, edits, settings.sessionGapMinutes * 60_000, settings.sessionMaxNotes),
    ...sameDayLinks(notes, settings.sameDayWindowDays),
    ...sequenceLinks(notes)
  ]
}

/** 無方向的邊：路徑字典序較小的一端當 src，同一對筆記只會有一列 */
function undirected(a: TimeNote, b: TimeNote): [number, number] {
  return a.path < b.path ? [a.id, b.id] : [b.id, a.id]
}

/**
 * 同一個 session 內被編輯的筆記兩兩相連，權重為共同出現的 session 數。
 * edits 必須依時間排序；編輯超過 maxNotes 篇的 session 視為批次操作，略過。
 */
export function sessionLinks(
  notes: readonly TimeNote[],
  edits: readonly EditEvent[],
  gapMs: number,
  maxNotes: number
): TimeLink[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const weights = new Map<string, TimeLink>()
  for (const session of sessionize(edits, gapMs)) {
    const ids = [...new Set(session.map((e) => e.noteId))].filter((id) => byId.has(id))
    if (ids.length < 2 || ids.length > maxNotes) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [src, dst] = undirected(byId.get(ids[i])!, byId.get(ids[j])!)
        const key = `${src}:${dst}`
        const link = weights.get(key)
        if (link) link.weight++
        else weights.set(key, { src, dst, type: 'same_session', weight: 1 })
      }
    }
  }
  return [...weights.values()]
}

/** event_date 相差 windowDays 天以內的筆記相連，權重 1 / (1 + 相差天數) */
export function sameDayLinks(notes: readonly TimeNote[], windowDays: number): TimeLink[] {
  const dated = notes
    .filter((n) => n.eventDate !== null)
    .map((n) => ({ note: n, day: dayNumber(n.eventDate!) }))
    .sort((a, b) => a.day - b.day)
  const out: TimeLink[] = []
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length && dated[j].day - dated[i].day <= windowDays; j++) {
      const [src, dst] = undirected(dated[i].note, dated[j].note)
      out.push({ src, dst, type: 'same_day', weight: 1 / (1 + dated[j].day - dated[i].day) })
    }
  }
  return out
}

/** 同一資料夾（含 vault 根目錄）中有 event_date 的筆記，依日期（同日依路徑）排序，前一篇連到下一篇 */
export function sequenceLinks(notes: readonly TimeNote[]): TimeLink[] {
  const folders = new Map<string, TimeNote[]>()
  for (const n of notes) {
    if (n.eventDate === null) continue
    const folder = n.path.slice(0, Math.max(0, n.path.lastIndexOf('/')))
    const list = folders.get(folder) ?? []
    list.push(n)
    folders.set(folder, list)
  }
  const out: TimeLink[] = []
  for (const list of folders.values()) {
    list.sort((a, b) => compare(a.eventDate!, b.eventDate!) || compare(a.path, b.path))
    for (let i = 1; i < list.length; i++) {
      out.push({ src: list[i - 1].id, dst: list[i].id, type: 'sequence', weight: 1 })
    }
  }
  return out
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
