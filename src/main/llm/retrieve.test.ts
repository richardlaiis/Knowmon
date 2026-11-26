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

/** Builds the index (with chunks and fake vectors), like Vault.indexFile */
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
  it('scores highest when near the top of both rankings', () => {
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

  it('an empty query has no results', () => {
    expect(retrieve(vaultDb(notes), '  ', fakeVector('x'))).toEqual({ hits: [], vector: false })
  })

  it('uses only full text without a query vector, marking the source and the matching line', () => {
    const r = retrieve(vaultDb(notes), '跑步', null, { expand: false })
    expect(r.vector).toBe(false)
    expect(paths(r)).toEqual(['跑步紀錄.md', '習慣.md'])
    expect(r.hits[0]).toMatchObject({ via: ['fulltext'], line: 1 })
    expect(r.hits[1]).toMatchObject({ via: ['fulltext'], line: 3 })
    expect(r.hits[1].snippet.some((s) => s.match && s.text === '跑步')).toBe(true)
  })

  it('vectors find related notes without the keywords; notes hit by both sources rank first', () => {
    const db = vaultDb(notes)
    // The query terms appear in no note, so only vectors can find it (cooking has the most overlapping characters)
    const semantic = retrieve(db, '番茄蛋', fakeVector('番茄蛋'), { expand: false })
    expect(semantic.vector).toBe(true)
    expect(semantic.hits[0]).toMatchObject({ path: '料理.md', via: ['vector'] })

    const both = retrieve(db, '跑步', fakeVector('早上跑步'), { expand: false })
    expect(both.hits[0].via).toEqual(['fulltext', 'vector'])
    expect(both.hits.every((h, i) => i === 0 || h.score <= both.hits[i - 1].score)).toBe(true)
  })

  it('adds graph neighbors of the top results', () => {
    const db = vaultDb(notes)
    const r = retrieve(db, '番茄', null)
    expect(paths(r)).toEqual(['料理.md', '索引.md'])
    expect(r.hits[1].via).toEqual(['graph'])
    expect(r.hits[1].score).toBeCloseTo(r.hits[0].score / 2)
    expect(retrieve(db, '番茄', null, { expand: false }).hits).toHaveLength(1)
  })

  it('filters by event_date, using the last modified date for undated notes', () => {
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

  it('with keywords, full text uses OR, ranking notes that match more keywords higher', () => {
    const db = vaultDb(notes)
    // With AND, no note contains all three terms
    expect(retrieve(db, '跑步 心率 番茄', null, { expand: false }).hits).toEqual([])
    const r = retrieve(db, '問句', null, { expand: false }, ['跑步', '心率', '番茄'])
    // The running log matches two terms; the rest match one each, ordered by their rank for that term (cooking is #1 for 「番茄」)
    expect(paths(r)).toEqual(['跑步紀錄.md', '料理.md', '習慣.md'])
    expect(r.hits[0]).toMatchObject({ via: ['fulltext'], line: 1 })
    expect(r.hits[1].snippet.some((x) => x.match && x.text === '番茄')).toBe(true)
  })

  it('uses only vectors when keywords is empty but there is a query vector', () => {
    const db = vaultDb(notes)
    const r = retrieve(db, '番茄蛋', fakeVector('番茄蛋'), { expand: false }, [])
    expect(r.vector).toBe(true)
    expect(r.hits[0]).toMatchObject({ path: '料理.md', via: ['vector'] })
    expect(retrieve(db, '番茄蛋', null, {}, []).hits).toEqual([])
  })

  it('limit caps the number of results', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `n${i}.md`, body: '共同詞彙' }))
    const db = vaultDb(many)
    expect(retrieve(db, '共同詞彙', null).hits).toHaveLength(20)
    expect(retrieve(db, '共同詞彙', null, { limit: 5 }).hits).toHaveLength(5)
  })
})

describe('firstMatchLine', () => {
  it('the first line containing any term, or 1 when none does', () => {
    expect(firstMatchLine('a\nb Foo\nfoo', ['foo'])).toBe(2)
    expect(firstMatchLine('a\nb', ['x'])).toBe(1)
  })
})
