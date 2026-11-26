// The source of truth for note_events: <vault>/.knowmon/events.jsonl (append-only).
// note_events in the DB is only an index, replayed from here when the DB is rebuilt.
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

  /** Reads every entry; corrupt lines (for example from a power cut mid-write) are skipped */
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
        // Skip corrupt lines
      }
    }
    return out
  }
}

export interface ReplayedEvent {
  ts: number
  kind: NoteEventKind
}

/** Replays the log: rename moves history and delete clears it. Returns "current path → events". */
export function replay(entries: LogEntry[]): Map<string, ReplayedEvent[]> {
  const byPath = new Map<string, ReplayedEvent[]>()
  for (const e of entries) {
    if ('kind' in e) {
      const list = byPath.get(e.path) ?? []
      list.push({ ts: e.ts, kind: e.kind })
      byPath.set(e.path, list)
    } else if (e.op === 'rename') {
      // Folder renames: every path under from moves along
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

/** When p equals from or is inside the from folder, returns its path after moving to to; otherwise null */
export function movedPath(p: string, from: string, to: string): string | null {
  if (p === from) return to
  if (p.startsWith(from + '/')) return to + p.slice(from.length)
  return null
}
