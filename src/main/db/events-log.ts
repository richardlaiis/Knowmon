// note_events 的真相來源：<vault>/.knowmon/events.jsonl（append-only）。
// DB 裡的 note_events 只是索引，DB 重建時從這裡重播。
import fs from 'node:fs'
import type { NoteEventKind } from '../../shared/types'

export type LogEntry =
  | { ts: number; kind: NoteEventKind; path: string }
  | { ts: number; op: 'rename'; from: string; to: string }
  | { ts: number; op: 'delete'; path: string }

export class EventsLog {
  constructor(readonly file: string) {}

  append(entry: LogEntry): void {
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n')
  }

  /** 讀出所有紀錄；壞掉的行（例如寫到一半斷電）直接略過 */
  readAll(): LogEntry[] {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return []
    }
    const out: LogEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // 略過損毀的行
      }
    }
    return out
  }
}

export interface ReplayedEvent {
  ts: number
  kind: NoteEventKind
}

/** 重播日誌：rename 搬移歷程、delete 清除歷程。回傳「目前路徑 → 事件」。 */
export function replay(entries: LogEntry[]): Map<string, ReplayedEvent[]> {
  const byPath = new Map<string, ReplayedEvent[]>()
  for (const e of entries) {
    if ('kind' in e) {
      const list = byPath.get(e.path) ?? []
      list.push({ ts: e.ts, kind: e.kind })
      byPath.set(e.path, list)
    } else if (e.op === 'rename') {
      // 支援資料夾改名：from 底下的所有路徑一起搬
      for (const [p, list] of [...byPath]) {
        const moved = movedPath(p, e.from, e.to)
        if (moved === null) continue
        byPath.delete(p)
        byPath.set(moved, [...(byPath.get(moved) ?? []), ...list])
      }
    } else if (e.op === 'delete') {
      for (const p of [...byPath.keys()]) {
        if (movedPath(p, e.path, e.path) !== null) byPath.delete(p)
      }
    }
  }
  return byPath
}

/** p 等於 from 或位於 from 資料夾底下時，回傳搬到 to 之後的路徑，否則 null */
export function movedPath(p: string, from: string, to: string): string | null {
  if (p === from) return to
  if (p.startsWith(from + '/')) return to + p.slice(from.length)
  return null
}
