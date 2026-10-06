// schema 與查詢。DB 只是索引：schema 版本不符時直接刪掉重建（歷程會從 events.jsonl 重播）。
import fs from 'node:fs'
import Database from 'better-sqlite3'
import type { Note, NoteEvent, NoteEventKind } from '../../shared/types'

export type DB = Database.Database

export const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE notes (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  modified_at  INTEGER NOT NULL,
  event_date   TEXT,
  content_hash TEXT NOT NULL
);

CREATE TABLE note_events (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('create', 'edit', 'open'))
);
CREATE INDEX note_events_note ON note_events(note_id, kind, ts);
CREATE INDEX note_events_ts ON note_events(ts);
`

/** 開啟（必要時建立/重建）資料庫。file 為 ':memory:' 時用於測試。 */
export function openDb(file: string): DB {
  let db = new Database(file)
  const version = db.pragma('user_version', { simple: true }) as number
  if (version !== SCHEMA_VERSION && version !== 0 && file !== ':memory:') {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
    db = new Database(file)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  if ((db.pragma('user_version', { simple: true }) as number) === 0) {
    db.exec(SCHEMA)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

interface NoteRow {
  id: number
  path: string
  title: string
  created_at: number
  modified_at: number
  event_date: string | null
  content_hash: string
}

function toNote(r: NoteRow): Note {
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    eventDate: r.event_date,
    contentHash: r.content_hash
  }
}

export function getNoteByPath(db: DB, path: string): Note | null {
  const row = db.prepare('SELECT * FROM notes WHERE path = ?').get(path) as NoteRow | undefined
  return row ? toNote(row) : null
}

export function listAllNotes(db: DB): Note[] {
  return (db.prepare('SELECT * FROM notes ORDER BY path').all() as NoteRow[]).map(toNote)
}

export type NoteInput = Omit<Note, 'id'>

/** 依 path 新增或更新筆記，回傳 id */
export function upsertNote(db: DB, n: NoteInput): number {
  const row = db
    .prepare(
      `INSERT INTO notes (path, title, created_at, modified_at, event_date, content_hash)
       VALUES (@path, @title, @createdAt, @modifiedAt, @eventDate, @contentHash)
       ON CONFLICT(path) DO UPDATE SET
         title = excluded.title,
         modified_at = excluded.modified_at,
         event_date = excluded.event_date,
         content_hash = excluded.content_hash
       RETURNING id`
    )
    .get(n) as { id: number }
  return row.id
}

export function updateNotePath(db: DB, from: string, to: string, title: string): void {
  db.prepare('UPDATE notes SET path = ?, title = ? WHERE path = ?').run(to, title, from)
}

export function deleteNote(db: DB, path: string): void {
  db.prepare('DELETE FROM notes WHERE path = ?').run(path)
}

export function insertEvent(db: DB, noteId: number, ts: number, kind: NoteEventKind): void {
  db.prepare('INSERT INTO note_events (note_id, ts, kind) VALUES (?, ?, ?)').run(noteId, ts, kind)
}

export function lastEventTs(db: DB, noteId: number, kind: NoteEventKind): number | null {
  const row = db
    .prepare('SELECT MAX(ts) AS ts FROM note_events WHERE note_id = ? AND kind = ?')
    .get(noteId, kind) as { ts: number | null }
  return row.ts
}

export function listEvents(db: DB, noteId?: number): NoteEvent[] {
  const sql =
    'SELECT note_id AS noteId, ts, kind FROM note_events' +
    (noteId === undefined ? '' : ' WHERE note_id = ?') +
    ' ORDER BY ts, rowid'
  const stmt = db.prepare(sql)
  return (noteId === undefined ? stmt.all() : stmt.all(noteId)) as NoteEvent[]
}

export function countEvents(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM note_events').get() as { n: number }).n
}
