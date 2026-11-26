// Integration tests for Vault and the index (links, notes_fts, event_date)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNoteByPath, listLinks } from '../db'
import * as indexer from '../indexer'
import { Vault } from '.'

vi.mock('../indexer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../indexer')>()
  return { ...real, parseNote: vi.fn(real.parseNote) }
})
const parseNote = vi.mocked(indexer.parseNote)

let root: string
let vault: Vault | null = null

const abs = (rel: string): string => path.join(root, rel)

function writeExternal(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
  fs.writeFileSync(abs(rel), content)
  const t = new Date(Date.now() + Math.random() * 1e6 + 1000)
  fs.utimesSync(abs(rel), t, t)
}

async function open(): Promise<Vault> {
  vault = await Vault.open(root)
  return vault
}

/** Wikilinks as paths: src → dst (null when unresolved) */
function edges(v: Vault): string[] {
  const paths = new Map(v.list().map((n) => [getNoteByPath(v.db, n.path)!.id, n.path]))
  return listLinks(v.db, 'wikilink')
    .map((l) => `${paths.get(l.src)} → ${l.dst === null ? `?${l.target}` : paths.get(l.dst)}`)
    .sort()
}

const backlinkPaths = (v: Vault, rel: string): string[] => v.backlinks(rel).map((b) => b.path)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-index-'))
  writeExternal('Welcome.md', '# Welcome\n- [[Atomic Habits]]\n- [[Not yet created]]')
  writeExternal(
    'Books/Atomic Habits.md',
    '---\ndate: 2025-12-20\n---\nBack to [[Welcome]], [[Welcome|Home]]'
  )
  writeExternal(
    'Journal/2026-10-06.md',
    'Read chapter two of [[Atomic Habits]] today, very rewarding'
  )
  parseNote.mockClear()
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('indexing when a vault opens', () => {
  it('parses links (including missing targets), event_date and weights', async () => {
    const v = await open()
    expect(edges(v)).toEqual([
      'Books/Atomic Habits.md → Welcome.md',
      'Journal/2026-10-06.md → Books/Atomic Habits.md',
      'Welcome.md → ?Not yet created',
      'Welcome.md → Books/Atomic Habits.md'
    ])
    const weight = listLinks(v.db).find((l) => l.target === 'Welcome')!.weight
    expect(weight).toBe(2)
    expect(getNoteByPath(v.db, 'Books/Atomic Habits.md')!.eventDate).toBe('2025-12-20')
    expect(getNoteByPath(v.db, 'Journal/2026-10-06.md')!.eventDate).toBe('2026-10-06')
    expect(getNoteByPath(v.db, 'Welcome.md')!.eventDate).toBeNull()
  })

  it('list returns summaries of every note', async () => {
    const v = await open()
    expect(v.list()).toEqual([
      expect.objectContaining({ path: 'Books/Atomic Habits.md', title: 'Atomic Habits' }),
      expect.objectContaining({
        path: 'Journal/2026-10-06.md',
        title: '2026-10-06',
        eventDate: '2026-10-06'
      }),
      expect.objectContaining({ path: 'Welcome.md', title: 'Welcome', eventDate: null })
    ])
  })
})

describe('backlinks', () => {
  it('lists the source notes with the line as context, marking the link as match', async () => {
    const v = await open()
    expect(v.backlinks('Welcome.md')).toEqual([
      {
        path: 'Books/Atomic Habits.md',
        title: 'Atomic Habits',
        line: 4,
        context: [
          { text: 'Back to ', match: false },
          { text: '[[Welcome]]', match: true },
          { text: ', ', match: false },
          { text: '[[Welcome|Home]]', match: true }
        ]
      }
    ])
    expect(backlinkPaths(v, 'Books/Atomic Habits.md')).toEqual([
      'Journal/2026-10-06.md',
      'Welcome.md'
    ])
    expect(v.backlinks('missing.md')).toEqual([])
  })

  it('links to itself are left out', async () => {
    const v = await open()
    await v.write('Welcome.md', '[[Welcome]] [[Atomic Habits]]')
    expect(backlinkPaths(v, 'Welcome.md')).toEqual(['Books/Atomic Habits.md'])
  })

  it('updates right after an app write', async () => {
    const v = await open()
    await v.write('Journal/2026-10-06.md', 'Now links to [[Welcome]]')
    expect(backlinkPaths(v, 'Welcome.md')).toEqual([
      'Books/Atomic Habits.md',
      'Journal/2026-10-06.md'
    ])
    expect(backlinkPaths(v, 'Books/Atomic Habits.md')).toEqual(['Welcome.md'])
  })

  it('old links connect once their missing target is created', async () => {
    const v = await open()
    await v.create('Projects/Not yet created.md')
    expect(backlinkPaths(v, 'Projects/Not yet created.md')).toEqual(['Welcome.md'])
  })

  it('notes added externally also connect links', async () => {
    const v = await open()
    writeExternal('Not yet created.md', 'Exists now')
    await v.reconcile()
    expect(backlinkPaths(v, 'Not yet created.md')).toEqual(['Welcome.md'])
  })

  it('renaming the target makes links unresolved, and renaming back reconnects them', async () => {
    const v = await open()
    await v.rename('Books/Atomic Habits.md', 'Books/Habits.md')
    expect(edges(v)).toContain('Welcome.md → ?Atomic Habits')
    expect(v.backlinks('Books/Habits.md')).toEqual([])
    // The renamed note's own links move with it
    expect(edges(v)).toContain('Books/Habits.md → Welcome.md')
    await v.rename('Books', 'Library')
    await v.rename('Library/Habits.md', 'Library/Atomic Habits.md')
    expect(backlinkPaths(v, 'Library/Atomic Habits.md')).toEqual([
      'Journal/2026-10-06.md',
      'Welcome.md'
    ])
  })

  it('deleting the target makes links unresolved; a note with the same name takes over', async () => {
    const v = await open()
    await v.create('Archive/Old/Atomic Habits.md')
    expect(edges(v)).toContain('Welcome.md → Books/Atomic Habits.md')
    await v.remove('Books/Atomic Habits.md')
    expect(edges(v)).toContain('Welcome.md → Archive/Old/Atomic Habits.md')
    await v.remove('Archive')
    expect(edges(v)).toContain('Welcome.md → ?Atomic Habits')
  })

  it('deleting the source note removes its links', async () => {
    const v = await open()
    await v.remove('Journal/2026-10-06.md')
    expect(backlinkPaths(v, 'Books/Atomic Habits.md')).toEqual(['Welcome.md'])
  })
})

describe('incremental indexing', () => {
  it('does not re-parse when the content hash is unchanged', async () => {
    const v = await open()
    expect(parseNote).toHaveBeenCalledTimes(3)
    parseNote.mockClear()
    const t = new Date(Date.now() + 5_000_000)
    fs.utimesSync(abs('Welcome.md'), t, t)
    await v.reconcile()
    expect(parseNote).not.toHaveBeenCalled()
    // Compare with the actual mtime on disk: utimes sets float seconds, which may read back up to 1ms less
    expect(getNoteByPath(v.db, 'Welcome.md')!.modifiedAt).toBe(
      Math.floor(fs.statSync(abs('Welcome.md')).mtimeMs)
    )

    writeExternal('Welcome.md', 'Changed [[Journal/2026-10-06]]')
    await v.reconcile()
    expect(parseNote).toHaveBeenCalledTimes(1)
    expect(backlinkPaths(v, 'Journal/2026-10-06.md')).toEqual(['Welcome.md'])
  })

  it('reopening parses only files changed while closed', async () => {
    await (await open()).close()
    parseNote.mockClear()
    writeExternal('Welcome.md', 'edited while closed')
    const v = await open()
    expect(parseNote.mock.calls.map((c) => c[0])).toEqual(['Welcome.md'])
    expect(backlinkPaths(v, 'Books/Atomic Habits.md')).toEqual(['Journal/2026-10-06.md'])
  })

  it('renaming recomputes event_date from the new file name', async () => {
    const v = await open()
    await v.rename('Journal/2026-10-06.md', 'Journal/2026-10-07.md')
    expect(getNoteByPath(v.db, 'Journal/2026-10-07.md')!.eventDate).toBe('2026-10-07')
    await v.rename('Journal', 'Old journal')
    expect(getNoteByPath(v.db, 'Old journal/2026-10-07.md')!.eventDate).toBe('2026-10-07')
    fs.renameSync(abs('Old journal/2026-10-07.md'), abs('Old journal/Essay.md'))
    await v.reconcile()
    expect(getNoteByPath(v.db, 'Old journal/Essay.md')!.eventDate).toBeNull()
  })

  it('search uses the new title after a rename', async () => {
    const v = await open()
    await v.rename('Welcome.md', 'Entrance.md')
    expect(v.search('Entrance').map((h) => h.path)).toEqual(['Entrance.md'])
    expect(v.search('Welcome').map((h) => h.title)).not.toContain('Welcome')
  })
})

describe('graph', () => {
  it('edges update with writes and new notes; missing targets are left out', async () => {
    const v = await open()
    const edges = async (): Promise<string[]> =>
      (await v.graph()).edges
        .filter((e) => e.type === 'wikilink')
        .map((e) => `${e.source} → ${e.target}`)
    expect((await v.graph()).nodes).toHaveLength(3)
    expect(await edges()).toEqual([
      'Books/Atomic Habits.md → Welcome.md',
      'Journal/2026-10-06.md → Books/Atomic Habits.md',
      'Welcome.md → Books/Atomic Habits.md'
    ])
    await v.create('Not yet created.md')
    expect(await edges()).toContain('Welcome.md → Not yet created.md')
    await v.write('Journal/2026-10-06.md', 'No links any more')
    expect(await edges()).not.toContain('Journal/2026-10-06.md → Books/Atomic Habits.md')
  })
})

describe('rebuilding after deleting the database', () => {
  it('links, search and event_date match the state before the rebuild', async () => {
    let v = await open()
    await v.write(
      'Welcome.md',
      '# Welcome\n- [[Atomic Habits]]\n- [[Not yet created]]\nsearch test'
    )
    await v.create('Not yet created.md')
    const snapshot = (x: Vault): unknown => ({
      edges: edges(x),
      list: x.list().map(({ path, eventDate }) => ({ path, eventDate })),
      backlinks: x.list().map((n) => x.backlinks(n.path)),
      search: ['Atomic Habits', 'search', 'chapter rewarding'].map((q) => x.search(q))
    })
    const before = snapshot(v)
    await v.close()
    vault = null
    for (const f of fs.readdirSync(abs('.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    v = await open()
    expect(snapshot(v)).toEqual(before)
  })
})
