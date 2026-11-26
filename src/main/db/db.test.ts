import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  deleteNote,
  getNoteByPath,
  insertEvent,
  getNoteBody,
  lastEventTs,
  listEvents,
  listLinks,
  openDb,
  relinkWikilinks,
  setNoteBody,
  setWikilinks,
  updateNotePath,
  upsertNote
} from '.'

const sample = {
  path: 'Journal/2026-10-06.md',
  title: '2026-10-06',
  createdAt: 100,
  modifiedAt: 200,
  eventDate: null,
  contentHash: 'h1'
}

describe('db', () => {
  it('upsert is keyed by path and keeps id and created_at on update', () => {
    const db = openDb(':memory:')
    const id = upsertNote(db, sample)
    const id2 = upsertNote(db, { ...sample, createdAt: 999, modifiedAt: 300, contentHash: 'h2' })
    expect(id2).toBe(id)
    expect(getNoteByPath(db, sample.path)).toEqual({
      ...sample,
      id,
      modifiedAt: 300,
      contentHash: 'h2'
    })
  })

  it('events can be queried and are deleted with their note', () => {
    const db = openDb(':memory:')
    const id = upsertNote(db, sample)
    insertEvent(db, id, 1, 'create')
    insertEvent(db, id, 5, 'edit')
    insertEvent(db, id, 9, 'edit')
    expect(lastEventTs(db, id, 'edit')).toBe(9)
    expect(lastEventTs(db, id, 'open')).toBeNull()
    expect(listEvents(db, id).map((e) => e.kind)).toEqual(['create', 'edit', 'edit'])

    updateNotePath(db, sample.path, 'b.md', 'b')
    expect(getNoteByPath(db, 'b.md')?.id).toBe(id)
    deleteNote(db, 'b.md')
    expect(listEvents(db)).toEqual([])
  })

  it('an unresolved wikilink has a NULL dst until relink fills it in; deleting the target sets it back to NULL', () => {
    const db = openDb(':memory:')
    const a = upsertNote(db, sample)
    setWikilinks(db, a, [
      { target: 'B', count: 2 },
      { target: '2026-10-06', count: 1 }
    ])
    expect(listLinks(db).map((l) => [l.target, l.dst, l.weight])).toEqual([
      ['B', null, 2],
      ['2026-10-06', a, 1]
    ])
    const b = upsertNote(db, { ...sample, path: 'Folder/b.md', title: 'b' })
    relinkWikilinks(db)
    expect(listLinks(db, 'wikilink').map((l) => l.dst)).toEqual([b, a])
    deleteNote(db, 'Folder/b.md')
    expect(listLinks(db).map((l) => l.dst)).toEqual([null, a])
    // Setting them again replaces the old ones
    setWikilinks(db, a, [])
    expect(listLinks(db)).toEqual([])
  })

  it('deleting the source note deletes its links and full-text entry; renaming updates the title in the full-text index', () => {
    const db = openDb(':memory:')
    const a = upsertNote(db, sample)
    setNoteBody(db, a, sample.title, 'body')
    setNoteBody(db, a, sample.title, 'new body')
    expect(getNoteBody(db, a)).toBe('new body')
    updateNotePath(db, sample.path, 'Home.md', 'Home')
    expect(db.prepare('SELECT title FROM notes_fts WHERE rowid = ?').get(a)).toEqual({
      title: 'Home'
    })
    setWikilinks(db, a, [{ target: 'x', count: 1 }])
    deleteNote(db, 'Home.md')
    expect(listLinks(db)).toEqual([])
    expect(getNoteBody(db, a)).toBeNull()
  })

  it('rebuilds the database when the schema version does not match', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-db-'))
    const file = path.join(dir, 'index.db')
    try {
      const old = new Database(file)
      old.exec('CREATE TABLE notes (legacy TEXT)')
      old.pragma(`user_version = ${SCHEMA_VERSION + 100}`)
      old.close()

      const db = openDb(file)
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      expect(upsertNote(db, sample)).toBeGreaterThan(0)
      db.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
