// Schema and queries. The DB is only an index: on a schema version mismatch it is deleted and rebuilt (history is replayed from events.jsonl).
import fs from 'node:fs'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { createLinkResolver, type LinkResolver } from '../../shared/links'
import type { Note, NoteEvent, NoteEventKind, NoteSummary } from '../../shared/types'

export type DB = Database.Database

export const SCHEMA_VERSION = 3

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

-- Edges have a type and a weight. A NULL dst on a wikilink means the target note doesn't exist yet; target keeps the original text so it can be connected later.
CREATE TABLE links (
  src    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst    INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  target TEXT,
  type   TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  meta   TEXT
);
CREATE INDEX links_src ON links(src, type);
CREATE INDEX links_dst ON links(dst, type);

-- Full-text search, rowid = notes.id. trigram is needed to search Chinese.
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='trigram');
CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
END;
CREATE TRIGGER notes_fts_title AFTER UPDATE OF title ON notes BEGIN
  UPDATE notes_fts SET title = new.title WHERE rowid = new.id;
END;

-- Text chunks for LLM retrieval. AUTOINCREMENT: ids are never reused, so embeddings returning in the background can't land on a new chunk with the same id.
-- The vector tables (vec_chunks, vec_notes) are created when the first embedding arrives (the dimension depends on the model); see vectors.ts.
CREATE TABLE chunks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  line     INTEGER NOT NULL,
  heading  TEXT NOT NULL,
  text     TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX chunks_note ON chunks(note_id, seq);
CREATE INDEX chunks_pending ON chunks(embedded) WHERE embedded = 0;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Opens (creating or rebuilding as needed) the database. file is ':memory:' in tests. */
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
  loadVectorExtension(db)
  if ((db.pragma('user_version', { simple: true }) as number) === 0) {
    db.exec(SCHEMA)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

/**
 * When packaged, node_modules is inside app.asar, but SQLite reads the file directly with dlopen, bypassing Electron's asar redirection,
 * so the path must point to app.asar.unpacked as unpacked by asarUnpack (see electron-builder.yml). Paths outside an asar are returned unchanged.
 */
export function unpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked')
}

/** Loads sqlite-vec; if that fails (an unsupported platform), vector features are disabled and everything else works */
function loadVectorExtension(db: DB): void {
  try {
    db.loadExtension(unpackedPath(sqliteVec.getLoadablePath()))
  } catch (e) {
    console.warn('sqlite-vec is unavailable, vector search is disabled:', e)
  }
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

/** Inserts or updates a note by path and returns its id */
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

export function listNoteSummaries(db: DB): NoteSummary[] {
  return db
    .prepare(
      'SELECT path, title, event_date AS eventDate, modified_at AS modifiedAt FROM notes ORDER BY path'
    )
    .all() as NoteSummary[]
}

// ---- Full-text index ----

export function setNoteBody(db: DB, noteId: number, title: string, body: string): void {
  db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(noteId)
  db.prepare('INSERT INTO notes_fts (rowid, title, body) VALUES (?, ?, ?)').run(noteId, title, body)
}

export function getNoteBody(db: DB, noteId: number): string | null {
  const row = db.prepare('SELECT body FROM notes_fts WHERE rowid = ?').get(noteId) as
    { body: string } | undefined
  return row ? row.body : null
}

// ---- Links ----

export interface LinkRow {
  src: number
  dst: number | null
  target: string | null
  type: string
  weight: number
}

/** Builds a wikilink resolver from the current notes */
export function linkResolver(db: DB): (target: string) => number | null {
  const rows = db.prepare('SELECT id, path FROM notes').all() as { id: number; path: string }[]
  const ids = new Map(rows.map((r) => [r.path, r.id]))
  const resolve: LinkResolver = createLinkResolver(rows.map((r) => r.path))
  return (target) => {
    const path = resolve(target)
    return path === null ? null : ids.get(path)!
  }
}

/** Replaces all of a note's wikilinks with new ones */
export function setWikilinks(
  db: DB,
  src: number,
  links: { target: string; count: number }[],
  resolve: (target: string) => number | null = linkResolver(db)
): void {
  db.prepare("DELETE FROM links WHERE src = ? AND type = 'wikilink'").run(src)
  const insert = db.prepare(
    "INSERT INTO links (src, dst, target, type, weight) VALUES (?, ?, ?, 'wikilink', ?)"
  )
  for (const l of links) insert.run(src, resolve(l.target), l.target, l.count)
}

/** After notes are created, renamed or deleted, re-resolves every wikilink target (without rereading files) */
export function relinkWikilinks(
  db: DB,
  resolve: (target: string) => number | null = linkResolver(db)
): void {
  const rows = db.prepare("SELECT rowid, dst, target FROM links WHERE type = 'wikilink'").all() as {
    rowid: number
    dst: number | null
    target: string
  }[]
  const update = db.prepare('UPDATE links SET dst = ? WHERE rowid = ?')
  db.transaction(() => {
    for (const r of rows) {
      const dst = resolve(r.target)
      if (dst !== r.dst) update.run(dst, r.rowid)
    }
  })()
}

export function listLinks(db: DB, type?: string): LinkRow[] {
  const sql =
    'SELECT src, dst, target, type, weight FROM links' +
    (type === undefined ? '' : ' WHERE type = ?') +
    ' ORDER BY rowid'
  const stmt = db.prepare(sql)
  return (type === undefined ? stmt.all() : stmt.all(type)) as LinkRow[]
}
