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
  lastEventTs,
  listEvents,
  openDb,
  updateNotePath,
  upsertNote
} from '.'

const sample = {
  path: '日記/2026-10-06.md',
  title: '2026-10-06',
  createdAt: 100,
  modifiedAt: 200,
  eventDate: null,
  contentHash: 'h1'
}

describe('db', () => {
  it('upsert 以 path 為鍵，更新時保留 id 與 created_at', () => {
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

  it('事件可查詢，刪除筆記時連帶刪除事件', () => {
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

  it('schema 版本不符時重建資料庫', () => {
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
