import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SEMANTIC_SETTINGS } from '../../shared/llm'
import { deleteNote, listLinks, openDb, SCHEMA_VERSION, upsertNote, type DB } from '.'
import { getGraph } from './graph'
import { rebuildSemanticLinks } from './semantic'
import {
  embedProgress,
  ensureVectorTables,
  listChunks,
  nearestChunks,
  nearestNotes,
  pendingChunks,
  setChunks,
  storeEmbeddings,
  vecAvailable,
  vectorModel
} from './vectors'

function note(db: DB, p: string): number {
  const title = p.replace(/\.md$/, '')
  return upsertNote(db, {
    path: p,
    title,
    createdAt: 0,
    modifiedAt: 0,
    eventDate: null,
    contentHash: p
  })
}

const chunk = (text: string, line = 1): { line: number; text: string; heading: string } => ({
  line,
  text,
  heading: ''
})

/** 把 pending chunk 依 vectors 表（文字 → 向量）寫入 */
function embedAll(db: DB, vectors: Record<string, number[]>): number[] {
  return storeEmbeddings(
    db,
    pendingChunks(db, 1000).map((c) => ({ id: c.id, vector: vectors[c.text] }))
  )
}

describe('vectors', () => {
  it('sqlite-vec 已載入', () => {
    expect(vecAvailable(openDb(':memory:'))).toBe(true)
  })

  it('chunk 寫入後待 embedding；全部完成才算該篇完成，並建立整篇向量', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    const b = note(db, 'b.md')
    note(db, 'empty.md')
    setChunks(db, a, [chunk('a1'), chunk('a2', 5)])
    setChunks(db, b, [chunk('b1')])
    expect(embedProgress(db)).toEqual({ embedded: 0, total: 2 })
    expect(pendingChunks(db, 10).map((c) => [c.title, c.text])).toEqual([
      ['a', 'a1'],
      ['a', 'a2'],
      ['b', 'b1']
    ])

    ensureVectorTables(db, 'm', 3)
    const [a1] = pendingChunks(db, 1)
    expect(storeEmbeddings(db, [{ id: a1.id, vector: [1, 0, 0] }])).toEqual([])
    expect(embedProgress(db)).toEqual({ embedded: 0, total: 2 })
    expect(embedAll(db, { a2: [0, 1, 0], b1: [1, 0.1, 0] })).toEqual([a, b])
    expect(embedProgress(db)).toEqual({ embedded: 2, total: 2 })

    // a 的整篇向量是兩塊的平均 → (1,1,0)/√2
    const near = nearestNotes(db, [1, 1, 0], 2)
    expect(near[0].noteId).toBe(a)
    expect(near[0].distance).toBeCloseTo(0, 5)

    const hits = nearestChunks(db, [0, 1, 0], 2)
    expect(hits.map((h) => [h.text, h.line, h.noteId])).toEqual([
      ['a2', 5, a],
      ['b1', 1, b]
    ])
  })

  it('筆記重新切塊後舊向量作廢；途中回來的舊 chunk 向量不會寫入', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    setChunks(db, a, [chunk('舊')])
    ensureVectorTables(db, 'm', 2)
    const stale = pendingChunks(db, 10)
    // embedding 途中筆記被修改
    setChunks(db, a, [chunk('新')])
    expect(
      storeEmbeddings(
        db,
        stale.map((c) => ({ id: c.id, vector: [1, 0] }))
      )
    ).toEqual([])
    expect(listChunks(db, a).map((c) => [c.text, c.embedded])).toEqual([['新', false]])
    expect(nearestChunks(db, [1, 0], 5)).toEqual([])

    embedAll(db, { 新: [0, 1] })
    expect(nearestNotes(db, [0, 1], 5).map((n) => n.noteId)).toEqual([a])
    setChunks(db, a, [chunk('更新')])
    expect(nearestNotes(db, [0, 1], 5)).toEqual([])
    expect(nearestChunks(db, [0, 1], 5)).toEqual([])
  })

  it('刪除筆記時 chunk 與向量一起刪除', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    setChunks(db, a, [chunk('a')])
    ensureVectorTables(db, 'm', 2)
    embedAll(db, { a: [1, 0] })
    deleteNote(db, 'a.md')
    expect(listChunks(db, a)).toEqual([])
    expect(nearestChunks(db, [1, 0], 5)).toEqual([])
    expect(nearestNotes(db, [1, 0], 5)).toEqual([])
    expect(embedProgress(db)).toEqual({ embedded: 0, total: 0 })
  })

  it('換模型或維度時丟掉向量重算', () => {
    const db = openDb(':memory:')
    const a = note(db, 'a.md')
    setChunks(db, a, [chunk('a')])
    expect(vectorModel(db)).toBeNull()
    expect(ensureVectorTables(db, 'm1', 2)).toBe(true)
    embedAll(db, { a: [1, 0] })
    expect(ensureVectorTables(db, 'm1', 2)).toBe(false)
    expect(embedProgress(db).embedded).toBe(1)

    expect(ensureVectorTables(db, 'm2', 3)).toBe(true)
    expect(vectorModel(db)).toEqual({ model: 'm2', dim: 3 })
    expect(embedProgress(db)).toEqual({ embedded: 0, total: 1 })
    expect(nearestChunks(db, [1, 0, 0], 5)).toEqual([])
  })

  it('舊版 schema 的 DB 會被重建', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-db-'))
    const file = path.join(dir, 'index.db')
    const old = new Database(file)
    old.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)')
    old.pragma('user_version = 2')
    old.close()
    const db = openDb(file)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(listChunks(db, 1)).toEqual([])
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('rebuildSemanticLinks', () => {
  function setup(): { db: DB; ids: Record<string, number> } {
    const db = openDb(':memory:')
    const vectors: Record<string, number[]> = {
      a: [1, 0, 0],
      b: [0.95, 0.31, 0], // 與 a 相似度約 0.95
      c: [0.8, 0.6, 0], // 與 a 0.8、與 b 約 0.95
      d: [0, 0, 1] // 與其他都不相似
    }
    const ids: Record<string, number> = {}
    for (const k of Object.keys(vectors)) {
      ids[k] = note(db, `${k}.md`)
      setChunks(db, ids[k], [chunk(k)])
    }
    ensureVectorTables(db, 'm', 3)
    embedAll(db, vectors)
    return { db, ids }
  }
  const edges = (db: DB): string[] =>
    getGraph(db)
      .edges.filter((e) => e.type === 'semantic')
      .map((e) => `${e.source}–${e.target} ${e.weight.toFixed(2)}`)

  it('相似度高於門檻才相連，無方向、不重複，權重為相似度', async () => {
    const { db } = setup()
    await rebuildSemanticLinks(db, DEFAULT_SEMANTIC_SETTINGS)
    expect(edges(db)).toEqual(['a.md–b.md 0.95', 'a.md–c.md 0.80', 'b.md–c.md 0.95'])
    await rebuildSemanticLinks(db, { ...DEFAULT_SEMANTIC_SETTINGS, semanticThreshold: 0.9 })
    expect(edges(db)).toEqual(['a.md–b.md 0.95', 'b.md–c.md 0.95'])
  })

  it('每篇只取最相似的幾篇；重算時保留其他類型的邊', async () => {
    const { db, ids } = setup()
    db.prepare("INSERT INTO links (src, dst, type, weight) VALUES (?, ?, 'wikilink', 1)").run(
      ids.a,
      ids.d
    )
    await rebuildSemanticLinks(db, { semanticThreshold: 0.5, semanticMaxPerNote: 1 })
    // a → b、b → a 或 c（同分）、c → b
    expect(edges(db)).toContain('a.md–b.md 0.95')
    expect(edges(db)).toContain('b.md–c.md 0.95')
    expect(edges(db)).not.toContain('a.md–c.md 0.80')
    expect(listLinks(db, 'wikilink')).toHaveLength(1)
  })

  it('刪除的筆記不再有 semantic 邊', async () => {
    const { db } = setup()
    deleteNote(db, 'b.md')
    await rebuildSemanticLinks(db, DEFAULT_SEMANTIC_SETTINGS)
    expect(edges(db)).toEqual(['a.md–c.md 0.80'])
  })

  it('1000 篇筆記（1024 維）在 1.5 秒內重算完成，且每段不超過 100ms', async () => {
    const db = openDb(':memory:')
    const dim = 1024
    let seed = 1
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    const items: { id: number; vector: Float32Array }[] = []
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        const id = note(db, `n${i}.md`)
        setChunks(db, id, [chunk(`n${i}`)])
      }
    })()
    ensureVectorTables(db, 'm', dim)
    for (const c of pendingChunks(db, 2000)) {
      items.push({ id: c.id, vector: Float32Array.from({ length: dim }, rand) })
    }
    storeEmbeddings(db, items)
    const start = performance.now()
    let last = start
    let longest = 0
    await rebuildSemanticLinks(db, { semanticThreshold: 0.05, semanticMaxPerNote: 5 }, async () => {
      const t = performance.now()
      longest = Math.max(longest, t - last)
      last = t
    })
    const ms = performance.now() - start
    console.log(
      `rebuildSemanticLinks 1000 notes: ${ms.toFixed(0)}ms, longest step ${longest.toFixed(0)}ms`
    )
    expect(ms).toBeLessThan(1500)
    expect(longest).toBeLessThan(100)
    expect(listLinks(db, 'semantic').length).toBeGreaterThan(1000)
  })
})
