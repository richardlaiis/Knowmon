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

  it('wikilink 未解析時 dst 為 NULL，relink 後補上；刪除目標時變回 NULL', () => {
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
    const b = upsertNote(db, { ...sample, path: '資料夾/b.md', title: 'b' })
    relinkWikilinks(db)
    expect(listLinks(db, 'wikilink').map((l) => l.dst)).toEqual([b, a])
    deleteNote(db, '資料夾/b.md')
    expect(listLinks(db).map((l) => l.dst)).toEqual([null, a])
    // 重新設定會取代舊的
    setWikilinks(db, a, [])
    expect(listLinks(db)).toEqual([])
  })

  it('刪除來源筆記時連帶刪除連結與全文索引；改名時更新全文索引的標題', () => {
    const db = openDb(':memory:')
    const a = upsertNote(db, sample)
    setNoteBody(db, a, sample.title, '內文')
    setNoteBody(db, a, sample.title, '新內文')
    expect(getNoteBody(db, a)).toBe('新內文')
    updateNotePath(db, sample.path, '首頁.md', '首頁')
    expect(db.prepare('SELECT title FROM notes_fts WHERE rowid = ?').get(a)).toEqual({
      title: '首頁'
    })
    setWikilinks(db, a, [{ target: 'x', count: 1 }])
    deleteNote(db, '首頁.md')
    expect(listLinks(db)).toEqual([])
    expect(getNoteBody(db, a)).toBeNull()
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
