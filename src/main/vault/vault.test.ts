import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultChange } from '../../shared/types'
import { getNoteByPath, listEvents } from '../db'
import { EventsLog } from '../db/events-log'
import { EVENT_THROTTLE_MS, Vault } from '.'

let root: string
let clock: number
let vault: Vault | null = null

const now = (): number => clock
const abs = (rel: string): string => path.join(root, rel)
const logFile = (): string => path.join(root, '.knowmon', 'events.jsonl')

function writeExternal(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
  fs.writeFileSync(abs(rel), content)
  // Make sure the mtime always differs from last time, regardless of the file system's timestamp precision
  const t = new Date(Date.now() + Math.random() * 1e6 + 1000)
  fs.utimesSync(abs(rel), t, t)
}

async function open(opts: Parameters<typeof Vault.open>[1] = {}): Promise<Vault> {
  vault = await Vault.open(root, { now, ...opts })
  return vault
}

function kinds(v: Vault, rel: string): string[] {
  const note = getNoteByPath(v.db, rel)
  if (!note) throw new Error(`Not indexed: ${rel}`)
  return listEvents(v.db, note.id).map((e) => e.kind)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-vault-'))
  clock = Date.now() + 10 * 24 * 3600_000
  writeExternal('Welcome.md', '# Welcome\n')
  writeExternal('Journal/2026-10-06.md', 'Started writing [[Welcome]]')
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('opening a vault', () => {
  it('indexes existing notes and records one create for each', async () => {
    const v = await open()
    expect(getNoteByPath(v.db, 'Welcome.md')).toMatchObject({ title: 'Welcome' })
    expect(kinds(v, 'Welcome.md')).toEqual(['create'])
    expect(kinds(v, 'Journal/2026-10-06.md')).toEqual(['create'])
    expect(fs.existsSync(path.join(root, '.knowmon', 'index.db'))).toBe(true)
    expect(new EventsLog(logFile()).readAll()).toHaveLength(2)
  })

  it('throws when it is not a folder', async () => {
    await expect(Vault.open(abs('Welcome.md'))).rejects.toThrow()
  })

  it('files modified while closed get an edit on the next open', async () => {
    await (await open()).close()
    writeExternal('Welcome.md', '# Welcome\nedited while closed')
    const v = await open()
    expect(kinds(v, 'Welcome.md')).toEqual(['create', 'edit'])
  })
})

describe('operations inside the app', () => {
  it('create makes an empty note and notifies the change; throws on a duplicate name', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    await v.create('Projects/New note.md')
    expect(fs.readFileSync(abs('Projects/New note.md'), 'utf8')).toBe('')
    expect(kinds(v, 'Projects/New note.md')).toEqual(['create'])
    expect(changes).toEqual([{ type: 'add', path: 'Projects/New note.md' }])
    await expect(v.create('Projects/New note.md')).rejects.toThrow('already exists')
    await expect(v.create('not-a-note.txt')).rejects.toThrow()
  })

  it('createFolder makes an empty folder and notifies the change', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    await v.createFolder('Projects/Subfolder')
    expect(fs.statSync(abs('Projects/Subfolder')).isDirectory()).toBe(true)
    expect(fs.readdirSync(abs('Projects/Subfolder'))).toEqual([])
    expect(changes).toEqual([{ type: 'add', path: 'Projects/Subfolder' }])
    expect((await v.tree()).children!.map((c) => c.path)).toContain('Projects')
    // An empty folder doesn't affect the index, and reconcile reports no change
    expect(await v.reconcile()).toEqual([])

    await expect(v.createFolder('Projects/Subfolder')).rejects.toThrow('Already exists')
    await expect(v.createFolder('Welcome.md')).rejects.toThrow()
    await expect(v.createFolder('../outside')).rejects.toThrow()
    await expect(v.createFolder('.hidden')).rejects.toThrow()
    expect(fs.existsSync(path.join(root, '..', 'outside'))).toBe(false)
  })

  it('saveAttachment saves to attachments/, numbering duplicates and never overwriting', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    const bytes = new Uint8Array([137, 80, 78, 71])
    expect(await v.saveAttachment('Journal/2026-10-06.md', 'Pasted image 1.png', bytes)).toBe(
      'attachments/Pasted image 1.png'
    )
    expect(await v.saveAttachment('Welcome.md', 'Pasted image 1.png', new Uint8Array([1]))).toBe(
      'attachments/Pasted image 1 1.png'
    )
    expect([...fs.readFileSync(abs('attachments/Pasted image 1.png'))]).toEqual([...bytes])
    expect([...fs.readFileSync(abs('attachments/Pasted image 1 1.png'))]).toEqual([1])
    // The file tree is notified when the folder is first created; images aren't indexed
    expect(changes).toEqual([{ type: 'add', path: 'attachments' }])
    expect(await v.reconcile()).toEqual([])
    expect(v.list().map((n) => n.path)).not.toContain('attachments/Pasted image 1.png')

    // Paths in the file name are removed
    expect(await v.saveAttachment('Welcome.md', '../../evil.png', bytes)).toBe(
      'attachments/evil.png'
    )
    expect(fs.existsSync(path.join(root, '..', 'evil.png'))).toBe(false)
    await expect(v.saveAttachment('Welcome.md', 'x.md', bytes)).rejects.toThrow(
      'Not a supported image'
    )
    await expect(v.saveAttachment('.knowmon/x.md', 'a.png', bytes)).rejects.toThrow()
    await expect(v.saveAttachment('attachments', 'a.png', bytes)).rejects.toThrow('Not a note')
  })

  it('write writes the file and records an edit, at most once per 60 seconds per event kind', async () => {
    const v = await open()
    await v.write('Welcome.md', 'one')
    clock += 1000
    await v.write('Welcome.md', 'two')
    expect(fs.readFileSync(abs('Welcome.md'), 'utf8')).toBe('two')
    expect(kinds(v, 'Welcome.md')).toEqual(['create', 'edit'])
    clock += EVENT_THROTTLE_MS
    await v.write('Welcome.md', 'three')
    expect(kinds(v, 'Welcome.md')).toEqual(['create', 'edit', 'edit'])
    expect(getNoteByPath(v.db, 'Welcome.md')!.modifiedAt).toBe(
      Math.floor(fs.statSync(abs('Welcome.md')).mtimeMs)
    )
  })

  it('write does not write the file when the content is unchanged', async () => {
    const v = await open()
    const before = fs.statSync(abs('Welcome.md')).mtimeMs
    await v.write('Welcome.md', '# Welcome\n')
    expect(fs.statSync(abs('Welcome.md')).mtimeMs).toBe(before)
    expect(kinds(v, 'Welcome.md')).toEqual(['create'])
  })

  it('write to a missing path creates the note', async () => {
    const v = await open()
    await v.write('new/file.md', 'content')
    expect(kinds(v, 'new/file.md')).toEqual(['create', 'edit'])
  })

  it('create with content writes it, records create and edit, and parses links', async () => {
    const v = await open()
    await v.create('Summary.md', 'See [[Welcome]]')
    expect(fs.readFileSync(abs('Summary.md'), 'utf8')).toBe('See [[Welcome]]')
    expect(kinds(v, 'Summary.md')).toEqual(['create', 'edit'])
    expect(v.backlinks('Welcome.md').map((b) => b.path)).toContain('Summary.md')
    await expect(v.create('Summary.md', 'overwrite')).rejects.toThrow('already exists')
    expect(fs.readFileSync(abs('Summary.md'), 'utf8')).toBe('See [[Welcome]]')
  })

  it('peek reads the content without recording open', async () => {
    const v = await open()
    expect(await v.peek('Welcome.md')).toBe('# Welcome\n')
    expect(kinds(v, 'Welcome.md')).toEqual(['create'])
    await expect(v.peek('.knowmon/settings.json')).rejects.toThrow()
  })

  it('update reads the current content and writes it back, notifying the change; no write when unchanged', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    writeExternal('Welcome.md', 'Changed outside\n')
    expect(await v.update('Welcome.md', (c) => c + 'one more line\n')).toBe(
      'Changed outside\none more line\n'
    )
    expect(fs.readFileSync(abs('Welcome.md'), 'utf8')).toBe('Changed outside\none more line\n')
    expect(kinds(v, 'Welcome.md')).toEqual(['create', 'edit'])
    expect(changes).toEqual([{ type: 'change', path: 'Welcome.md' }])
    // After writing, reconcile reports nothing further
    expect(await v.reconcile()).toEqual([])

    await v.update('Welcome.md', (c) => c)
    expect(changes).toHaveLength(1)
    await expect(v.update('missing.md', (c) => c)).rejects.toThrow()
  })

  it('read returns the content and records open (throttled)', async () => {
    const v = await open()
    expect(await v.read('Journal/2026-10-06.md')).toBe('Started writing [[Welcome]]')
    await v.read('Journal/2026-10-06.md')
    expect(kinds(v, 'Journal/2026-10-06.md')).toEqual(['create', 'open'])
  })

  it('refuses to escape the vault or write to .knowmon', async () => {
    const v = await open()
    await expect(v.write('../outside.md', 'x')).rejects.toThrow()
    await expect(v.read('.knowmon/events.jsonl')).rejects.toThrow()
    expect(fs.existsSync(path.join(root, '..', 'outside.md'))).toBe(false)
  })

  it('rename keeps the same id and history', async () => {
    const v = await open()
    const id = getNoteByPath(v.db, 'Welcome.md')!.id
    await v.rename('Welcome.md', 'Archive/Home.md')
    expect(fs.existsSync(abs('Archive/Home.md'))).toBe(true)
    expect(fs.existsSync(abs('Welcome.md'))).toBe(false)
    expect(getNoteByPath(v.db, 'Archive/Home.md')).toMatchObject({ id, title: 'Home' })
    expect(getNoteByPath(v.db, 'Welcome.md')).toBeNull()
    await expect(v.rename('Archive/Home.md', 'Journal/2026-10-06.md')).rejects.toThrow(
      'Destination already exists'
    )
    await expect(v.rename('Archive/Home.md', 'Home.txt')).rejects.toThrow()
  })

  it('renaming a folder moves every note under it', async () => {
    const v = await open()
    await v.rename('Journal', 'Diary')
    expect(getNoteByPath(v.db, 'Diary/2026-10-06.md')).not.toBeNull()
    expect(kinds(v, 'Diary/2026-10-06.md')).toEqual(['create'])
    await expect(v.rename('Diary', 'Diary/sub')).rejects.toThrow()
  })

  it('remove deletes through the trash and clears the index', async () => {
    const trashed: string[] = []
    const v = await open({
      trash: async (p) => {
        trashed.push(p)
        fs.rmSync(p, { recursive: true })
      }
    })
    await v.remove('Journal')
    expect(trashed).toEqual([abs('Journal')])
    expect(getNoteByPath(v.db, 'Journal/2026-10-06.md')).toBeNull()
    expect(new EventsLog(logFile()).readAll().at(-1)).toMatchObject({
      op: 'delete',
      path: 'Journal'
    })
  })
})

describe('reconcile (external changes)', () => {
  it('detects external additions, modifications and deletions', async () => {
    const v = await open()
    clock += EVENT_THROTTLE_MS
    writeExternal('Welcome.md', 'Changed outside')
    writeExternal('Added outside.md', 'new')
    fs.rmSync(abs('Journal/2026-10-06.md'))

    const changes = await v.reconcile()
    expect(changes).toEqual(
      expect.arrayContaining([
        { type: 'change', path: 'Welcome.md' },
        { type: 'add', path: 'Added outside.md' },
        { type: 'unlink', path: 'Journal/2026-10-06.md' }
      ])
    )
    expect(changes).toHaveLength(3)
    expect(kinds(v, 'Welcome.md')).toEqual(['create', 'edit'])
    expect(kinds(v, 'Added outside.md')).toEqual(['create'])
    expect(getNoteByPath(v.db, 'Journal/2026-10-06.md')).toBeNull()
  })

  it('an external rename (same content) counts as a rename and keeps history', async () => {
    const v = await open()
    await v.read('Welcome.md')
    const id = getNoteByPath(v.db, 'Welcome.md')!.id
    fs.renameSync(abs('Welcome.md'), abs('Renamed.md'))
    const changes = await v.reconcile()
    expect(changes).toEqual([
      { type: 'unlink', path: 'Welcome.md' },
      { type: 'add', path: 'Renamed.md' }
    ])
    expect(getNoteByPath(v.db, 'Renamed.md')!.id).toBe(id)
    expect(kinds(v, 'Renamed.md')).toEqual(['create', 'open'])
  })

  it("reconcile reports no change after the app's own writes", async () => {
    const v = await open()
    await v.write('Welcome.md', 'Edited in the app')
    await v.create('New.md')
    expect(await v.reconcile()).toEqual([])
  })

  it('touching without changing content is not an edit', async () => {
    const v = await open()
    const t = new Date(Date.now() + 5_000_000)
    fs.utimesSync(abs('Welcome.md'), t, t)
    expect(await v.reconcile()).toEqual([])
    expect(kinds(v, 'Welcome.md')).toEqual(['create'])
  })
})

describe('rebuilding from events.jsonl', () => {
  it('history is identical after deleting the database', async () => {
    let v = await open()
    clock += EVENT_THROTTLE_MS
    await v.write('Welcome.md', 'Edit one')
    await v.read('Journal/2026-10-06.md')
    await v.create('a.md')
    clock += EVENT_THROTTLE_MS
    await v.rename('a.md', 'Folder/b.md')
    await v.write('Folder/b.md', 'content')
    await v.create('To be deleted.md')
    await v.remove('To be deleted.md')

    const snapshot = (x: Vault): Record<string, { ts: number; kind: string }[]> =>
      Object.fromEntries(
        ['Welcome.md', 'Journal/2026-10-06.md', 'Folder/b.md'].map((p) => [
          p,
          listEvents(x.db, getNoteByPath(x.db, p)!.id).map(({ ts, kind }) => ({ ts, kind }))
        ])
      )
    const before = snapshot(v)
    await v.close()
    vault = null

    for (const f of fs.readdirSync(path.join(root, '.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    const logLines = new EventsLog(logFile()).readAll().length

    v = await open()
    expect(snapshot(v)).toEqual(before)
    expect(getNoteByPath(v.db, 'To be deleted.md')).toBeNull()
    // Rebuilding must not write duplicate entries to the log
    expect(new EventsLog(logFile()).readAll()).toHaveLength(logLines)
  })
})

describe('watcher', () => {
  it('external changes trigger onChange', async () => {
    const v = await open({ watch: true, debounceMs: 50 })
    const got = new Promise<VaultChange>((resolve) => {
      v.onChange((c) => {
        if (c.type === 'change') resolve(c)
      })
    })
    // Wait for chokidar to be ready
    await new Promise((r) => setTimeout(r, 300))
    writeExternal('Welcome.md', 'Written by an external editor')
    await expect(got).resolves.toEqual({ type: 'change', path: 'Welcome.md' })
  }, 10_000)
})
