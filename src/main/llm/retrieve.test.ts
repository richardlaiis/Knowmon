import { describe, expect, it } from 'vitest'
import { openDb, relinkWikilinks, setNoteBody, setWikilinks, upsertNote, type DB } from '../db'
import { ensureVectorTables, pendingChunks, setChunks, storeEmbeddings } from '../db/vectors'
import { chunkMarkdown } from '../indexer/chunk'
import { countLinks, parseNote } from '../indexer'
import { firstMatchLine, reciprocalRankFusion, retrieve, RRF_K } from './retrieve'
import { FAKE_DIM, fakeVector } from './test-utils'

interface NoteSpec {
  path: string
  body: string
  eventDate?: string
  modifiedAt?: number
}

/** 建立索引（含 chunk 與假向量），像 Vault.indexFile 一樣 */
function vaultDb(specs: NoteSpec[], withVectors = true): DB {
  const db = openDb(':memory:')
  for (const s of specs) {
    const title = s.path.replace(/\.md$/, '').split('/').pop()!
    const parsed = parseNote(s.path, s.body)
    const id = upsertNote(db, {
      path: s.path,
      title,
      createdAt: 0,
      modifiedAt: s.modifiedAt ?? new Date(2026, 9, 1).getTime(),
      eventDate: s.eventDate ?? parsed.eventDate,
      contentHash: s.path
    })
    setNoteBody(db, id, title, parsed.body)
    setWikilinks(db, id, countLinks(parsed.links))
    setChunks(db, id, chunkMarkdown(parsed.body))
  }
  relinkWikilinks(db)
  if (withVectors) {
    ensureVectorTables(db, 'fake', FAKE_DIM)
    storeEmbeddings(
      db,
      pendingChunks(db, 1000).map((c) => ({ id: c.id, vector: fakeVector(c.text) }))
    )
  }
  return db
}

const paths = (r: ReturnType<typeof retrieve>): string[] => r.hits.map((h) => h.path)

describe('reciprocalRankFusion', () => {
  it('兩份排名都靠前的分數最高', () => {
    const s = reciprocalRankFusion([
      [1, 2, 3],
      [2, 4]
    ])
    expect(s.get(2)).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1))
    expect(s.get(1)).toBeCloseTo(1 / (RRF_K + 1))
    expect([...s.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)).toEqual([2, 1, 4, 3])
  })
})

describe('retrieve', () => {
  const notes: NoteSpec[] = [
    { path: '習慣.md', body: '# 習慣\n\n每天早上跑步，養成運動習慣。' },
    { path: '跑步紀錄.md', body: '今天早上跑步五公里。\n\n心率偏高。' },
    { path: '料理.md', body: '晚餐煮了番茄炒蛋。' },
    { path: '索引.md', body: '相關：[[料理]]' }
  ]

  it('空查詢沒有結果', () => {
    expect(retrieve(vaultDb(notes), '  ', fakeVector('x'))).toEqual({ hits: [], vector: false })
  })

  it('沒有查詢向量時只用全文，並標示來源與命中的行', () => {
    const r = retrieve(vaultDb(notes), '跑步', null, { expand: false })
    expect(r.vector).toBe(false)
    expect(paths(r)).toEqual(['跑步紀錄.md', '習慣.md'])
    expect(r.hits[0]).toMatchObject({ via: ['fulltext'], line: 1 })
    expect(r.hits[1]).toMatchObject({ via: ['fulltext'], line: 3 })
    expect(r.hits[1].snippet.some((s) => s.match && s.text === '跑步')).toBe(true)
  })

  it('向量找到沒有關鍵字的相關筆記，兩種來源都命中的排前面', () => {
    const db = vaultDb(notes)
    // 查詢詞不在任何筆記中，只有向量能找到（字元重疊最多的是料理）
    const semantic = retrieve(db, '番茄蛋', fakeVector('番茄蛋'), { expand: false })
    expect(semantic.vector).toBe(true)
    expect(semantic.hits[0]).toMatchObject({ path: '料理.md', via: ['vector'] })

    const both = retrieve(db, '跑步', fakeVector('早上跑步'), { expand: false })
    expect(both.hits[0].via).toEqual(['fulltext', 'vector'])
    expect(both.hits.every((h, i) => i === 0 || h.score <= both.hits[i - 1].score)).toBe(true)
  })

  it('前幾名的圖譜鄰居會被加進來', () => {
    const db = vaultDb(notes)
    const r = retrieve(db, '番茄', null)
    expect(paths(r)).toEqual(['料理.md', '索引.md'])
    expect(r.hits[1].via).toEqual(['graph'])
    expect(r.hits[1].score).toBeCloseTo(r.hits[0].score / 2)
    expect(retrieve(db, '番茄', null, { expand: false }).hits).toHaveLength(1)
  })

  it('依 event_date 篩選，沒有日期的用最後修改日', () => {
    const db = vaultDb([
      { path: '日記/2026-09-01.md', body: '讀書會' },
      { path: '日記/2026-10-05.md', body: '讀書會' },
      { path: '雜記.md', body: '讀書會', modifiedAt: new Date(2026, 9, 7, 12).getTime() }
    ])
    const r = (from?: string, to?: string): string[] =>
      paths(retrieve(db, '讀書會', fakeVector('讀書會'), { from, to })).sort()
    expect(r('2026-10-01')).toEqual(['日記/2026-10-05.md', '雜記.md'])
    expect(r(undefined, '2026-10-05')).toEqual(['日記/2026-09-01.md', '日記/2026-10-05.md'])
    expect(r('2026-10-06', '2026-10-31')).toEqual(['雜記.md'])
  })

  it('有 keywords 時全文改為 OR，命中越多個關鍵字的排越前面', () => {
    const db = vaultDb(notes)
    // AND 時沒有任何一篇同時包含三個詞
    expect(retrieve(db, '跑步 心率 番茄', null, { expand: false }).hits).toEqual([])
    const r = retrieve(db, '問句', null, { expand: false }, ['跑步', '心率', '番茄'])
    // 跑步紀錄命中兩個詞；其餘各命中一個，依該詞的名次（料理是「番茄」的第 1 名）
    expect(paths(r)).toEqual(['跑步紀錄.md', '料理.md', '習慣.md'])
    expect(r.hits[0]).toMatchObject({ via: ['fulltext'], line: 1 })
    expect(r.hits[1].snippet.some((x) => x.match && x.text === '番茄')).toBe(true)
  })

  it('keywords 為空但有查詢向量時只用向量', () => {
    const db = vaultDb(notes)
    const r = retrieve(db, '番茄蛋', fakeVector('番茄蛋'), { expand: false }, [])
    expect(r.vector).toBe(true)
    expect(r.hits[0]).toMatchObject({ path: '料理.md', via: ['vector'] })
    expect(retrieve(db, '番茄蛋', null, {}, []).hits).toEqual([])
  })

  it('limit 限制筆數', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `n${i}.md`, body: '共同詞彙' }))
    const db = vaultDb(many)
    expect(retrieve(db, '共同詞彙', null).hits).toHaveLength(20)
    expect(retrieve(db, '共同詞彙', null, { limit: 5 }).hits).toHaveLength(5)
  })
})

describe('firstMatchLine', () => {
  it('第一個含有任一詞的行，沒有時為 1', () => {
    expect(firstMatchLine('a\nb Foo\nfoo', ['foo'])).toBe(2)
    expect(firstMatchLine('a\nb', ['x'])).toBe(1)
  })
})
