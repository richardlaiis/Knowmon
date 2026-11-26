// Derives time edges (same_session, same_day, sequence) from notes and edit events. Pure functions, no DB access.
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

/** Undirected edges: the path that sorts first is src, so a pair of notes has only one row */
function undirected(a: TimeNote, b: TimeNote): [number, number] {
  return a.path < b.path ? [a.id, b.id] : [b.id, a.id]
}

/**
 * Notes edited in the same session are all linked to each other, weighted by the number of shared sessions.
 * edits must be sorted by time; a session editing more than maxNotes notes is treated as a batch operation and skipped.
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

/** Links notes whose event_dates are at most windowDays days apart, weighted 1 / (1 + days apart) */
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

/** Within a folder (including the vault root), notes with an event_date are sorted by date (by path within a day), and each links to the next */
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
