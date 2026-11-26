// Reads and writes files and watches for changes. Vault coordinates three things: the Markdown files (the truth), events.jsonl (the truth for history) and SQLite (the index).
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type {
  ActivityEvent,
  Backlink,
  GraphData,
  Note,
  NoteEventKind,
  NoteSummary,
  SearchHit,
  SemanticSettings,
  TimeSettings,
  TreeNode,
  VaultChange
} from '../../shared/types'
import {
  countEvents,
  deleteNote,
  getNoteByPath,
  insertEvent,
  lastEventTs,
  linkResolver,
  listAllNotes,
  listNoteSummaries,
  openDb,
  relinkWikilinks,
  setNoteBody,
  setWikilinks,
  updateNotePath,
  upsertNote,
  type DB
} from '../db'
import { getBacklinks } from '../db/backlinks'
import { getGraph } from '../db/graph'
import { rebuildSemanticLinks } from '../db/semantic'
import { listActivity, rebuildTimeLinks } from '../db/time'
import { setChunks } from '../db/vectors'
import { EventsLog, movedPath, replay } from '../db/events-log'
import { searchNotes } from '../db/search'
import { countLinks, parseNote } from '../indexer'
import { chunkMarkdown } from '../indexer/chunk'
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES, attachmentFileName } from '../../shared/assets'
import { clampSemanticSettings } from '../../shared/llm'
import { clampTimeSettings } from '../../shared/time'
import { META_DIR, isNotePath, normalizeRel, resolveInVault, titleFromPath } from './paths'
import { buildTree, listNotes } from './tree'
import {
  loadSemanticSettings,
  loadTimeSettings,
  saveSemanticSettings,
  saveTimeSettings
} from './vault-settings'
import { watchVault, type Watcher } from './watcher'

/** For the same note and event kind, only one event is recorded within this period */
export const EVENT_THROTTLE_MS = 60_000

const EMPTY_HASH = sha256('')

export interface VaultOptions {
  /** Called on delete; the main process passes shell.trashItem, and tests use the default permanent delete */
  trash?: (absPath: string) => Promise<void>
  now?: () => number
  /** Whether to start chokidar (off in tests, which call reconcile directly) */
  watch?: boolean
  debounceMs?: number
}

export class Vault {
  readonly db: DB
  private readonly log: EventsLog
  private readonly trash: (absPath: string) => Promise<void>
  private readonly now: () => number
  private readonly listeners = new Set<(c: VaultChange) => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private watcher: Watcher | null = null
  /** Cached wikilink resolver; rebuilt by relink() when the set of notes changes */
  private resolver: ((target: string) => number | null) | null = null
  private readonly settingsFile: string
  private timeSettings: TimeSettings
  /** Time edges need recomputing (events, dates, paths or settings changed); recomputed just before the graph is read */
  private timeDirty = true
  private semanticSettings: SemanticSettings
  /** Semantic edges need recomputing (note vectors, notes or settings changed); recomputed just before the graph is read */
  private semanticDirty = true
  /** The semantic edge recomputation in progress (computed in segments, yielding the event loop) */
  private semanticJob: Promise<void> | null = null
  /** Notifies when chunks changed (embedding needed); used by the Embedder */
  private readonly chunkListeners = new Set<() => void>()

  private constructor(
    readonly root: string,
    opts: VaultOptions
  ) {
    const meta = path.join(root, META_DIR)
    mkdirSync(meta, { recursive: true })
    this.db = openDb(path.join(meta, 'index.db'))
    this.log = new EventsLog(path.join(meta, 'events.jsonl'))
    this.settingsFile = path.join(meta, 'settings.json')
    this.timeSettings = loadTimeSettings(this.settingsFile)
    this.semanticSettings = loadSemanticSettings(this.settingsFile)
    this.trash = opts.trash ?? ((p) => fs.rm(p, { recursive: true, force: true }))
    this.now = opts.now ?? Date.now
  }

  static async open(root: string, opts: VaultOptions = {}): Promise<Vault> {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`)
    const vault = new Vault(path.resolve(root), opts)
    await vault.exclusive(() => vault.initialSync())
    if (opts.watch) {
      vault.watcher = watchVault(vault.root, opts.debounceMs ?? 200, (dirChanges) =>
        vault.exclusive(async () => {
          const changes = [...dirChanges, ...(await vault.reconcileNow())]
          changes.forEach((c) => vault.emit(c))
        })
      )
    }
    return vault
  }

  onChange(cb: (c: VaultChange) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  tree(): Promise<TreeNode> {
    return buildTree(this.root)
  }

  /** All notes (sorted by path) */
  list(): NoteSummary[] {
    return listNoteSummaries(this.db)
  }

  backlinks(rel: string): Backlink[] {
    return getBacklinks(this.db, normalizeRel(rel))
  }

  async graph(): Promise<GraphData> {
    if (this.timeDirty) {
      rebuildTimeLinks(this.db, this.timeSettings)
      this.timeDirty = false
    }
    while (this.semanticDirty || this.semanticJob) {
      if (!this.semanticJob) {
        // If anything changes mid-computation, semanticDirty is set to true again and the next round recomputes
        this.semanticDirty = false
        this.semanticJob = rebuildSemanticLinks(this.db, this.semanticSettings).finally(() => {
          this.semanticJob = null
        })
      }
      await this.semanticJob
    }
    return getGraph(this.db)
  }

  /** Called when note vectors change (written by the Embedder) */
  markSemanticDirty(): void {
    this.semanticDirty = true
  }

  /** Notifies when chunks changed and need embedding */
  onChunksChanged(cb: () => void): () => void {
    this.chunkListeners.add(cb)
    return () => this.chunkListeners.delete(cb)
  }

  /** create / edit events in [from, to) */
  activity(from: number, to: number): ActivityEvent[] {
    return listActivity(this.db, from, to)
  }

  getTimeSettings(): TimeSettings {
    return { ...this.timeSettings }
  }

  /** Changes the time parameters (clamped to valid ranges), writes them to settings.json and returns the values actually applied */
  setTimeSettings(change: Partial<TimeSettings>): Promise<TimeSettings> {
    return this.exclusive(async () => {
      const next = clampTimeSettings(change, this.timeSettings)
      saveTimeSettings(this.settingsFile, next)
      this.timeSettings = next
      this.timeDirty = true
      return { ...next }
    })
  }

  getSemanticSettings(): SemanticSettings {
    return { ...this.semanticSettings }
  }

  /** Changes the semantic parameters (clamped to valid ranges), writes them to settings.json and returns the values actually applied */
  setSemanticSettings(change: Partial<SemanticSettings>): Promise<SemanticSettings> {
    return this.exclusive(async () => {
      const next = clampSemanticSettings(change, this.semanticSettings)
      saveSemanticSettings(this.settingsFile, next)
      this.semanticSettings = next
      this.semanticDirty = true
      return { ...next }
    })
  }

  search(query: string, limit?: number): SearchHit[] {
    return searchNotes(this.db, query, limit)
  }

  read(rel: string): Promise<string> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      const content = await fs.readFile(resolveInVault(this.root, rel), 'utf8')
      let id = getNoteByPath(this.db, rel)?.id
      if (id === undefined) {
        id = (await this.indexFile(rel, content)).id
        this.relink()
      }
      this.record(id, rel, 'open', this.now())
      return content
    })
  }

  write(rel: string, content: string): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      if (!isNotePath(rel)) throw new Error(`Only .md files can be written: ${rel}`)
      const before = getNoteByPath(this.db, rel)
      if (before && before.contentHash === sha256(content)) return
      const abs = resolveInVault(this.root, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
      const { id } = await this.indexFile(rel, content)
      const ts = this.now()
      if (!before) {
        this.relink()
        this.record(id, rel, 'create', ts)
      }
      this.record(id, rel, 'edit', ts)
    })
  }

  /** Creates a new note; throws if it already exists (never overwrites). With non-empty content it also records an edit */
  create(rel: string, content = ''): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      if (!isNotePath(rel)) throw new Error(`Notes must be .md files: ${rel}`)
      const abs = resolveInVault(this.root, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, { flag: 'wx' }).catch((e) => {
        if (e.code === 'EEXIST') throw new Error(`A note with this name already exists: ${rel}`)
        throw e
      })
      const { id } = await this.indexFile(rel, content)
      this.relink()
      const ts = this.now()
      this.record(id, rel, 'create', ts)
      if (content) this.record(id, rel, 'edit', ts)
      this.emit({ type: 'add', path: rel })
    })
  }

  /** Reads a note's content without recording an open event (for agent tools: the user didn't open it) */
  async peek(rel: string): Promise<string> {
    return fs.readFile(resolveInVault(this.root, normalizeRel(rel)), 'utf8')
  }

  /**
   * Reads the current content, applies f and writes it back (run in the queue, so nothing else runs between the read and the write).
   * If the content changed, records an edit and notifies the renderer (tabs with this note open reload); returns the new content.
   */
  update(rel: string, f: (content: string) => string): Promise<string> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      if (!isNotePath(rel)) throw new Error(`Only .md files can be written: ${rel}`)
      const abs = resolveInVault(this.root, rel)
      const before = await fs.readFile(abs, 'utf8')
      const after = f(before)
      if (after === before) return before
      await fs.writeFile(abs, after, 'utf8')
      const { id } = await this.indexFile(rel, after)
      this.record(id, rel, 'edit', this.now())
      this.emit({ type: 'change', path: rel })
      return after
    })
  }

  /** Creates an empty folder (folders aren't stored in the DB and have no events) */
  createFolder(rel: string): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      if (isNotePath(rel)) throw new Error(`Folder names must not end with .md: ${rel}`)
      const abs = resolveInVault(this.root, rel)
      if (await exists(abs)) throw new Error(`Already exists: ${rel}`)
      await fs.mkdir(abs, { recursive: true })
      this.emit({ type: 'add', path: rel })
    })
  }

  /**
   * Saves a pasted image in attachments/ at the vault root, adding a number on a name clash and never overwriting.
   * Images aren't stored in the DB and have no events. Returns the vault-relative path.
   */
  saveAttachment(notePath: string, fileName: string, data: Uint8Array): Promise<string> {
    return this.exclusive(async () => {
      if (!isNotePath(normalizeRel(notePath))) throw new Error(`Not a note: ${notePath}`)
      if (!(data instanceof Uint8Array)) throw new Error('Image data must be bytes')
      if (data.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Image is too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`)
      }
      const name = attachmentFileName(fileName)
      const dot = name.lastIndexOf('.')
      const dir = resolveInVault(this.root, ATTACHMENTS_DIR)
      const created = !(await exists(dir))
      await fs.mkdir(dir, { recursive: true })
      if (created) this.emit({ type: 'add', path: ATTACHMENTS_DIR })
      for (let i = 0; ; i++) {
        const candidate = i === 0 ? name : `${name.slice(0, dot)} ${i}${name.slice(dot)}`
        try {
          await fs.writeFile(path.join(dir, candidate), data, { flag: 'wx' })
          return `${ATTACHMENTS_DIR}/${candidate}`
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
      }
    })
  }

  /** Renames or moves a note/folder; its history follows */
  rename(from: string, to: string): Promise<void> {
    return this.exclusive(async () => {
      from = normalizeRel(from)
      to = normalizeRel(to)
      if (from === to) return
      if (movedPath(to, from, from) !== null) throw new Error('Cannot move a folder into itself')
      const absFrom = resolveInVault(this.root, from)
      const absTo = resolveInVault(this.root, to)
      const stat = await fs.stat(absFrom)
      if (stat.isFile() && !isNotePath(to)) throw new Error(`Notes must be .md files: ${to}`)
      if (await exists(absTo)) throw new Error(`Destination already exists: ${to}`)
      await fs.mkdir(path.dirname(absTo), { recursive: true })
      await fs.rename(absFrom, absTo)

      const affected = listAllNotes(this.db).filter((n) => movedPath(n.path, from, to) !== null)
      this.db.transaction(() => {
        for (const n of affected) {
          const next = movedPath(n.path, from, to)!
          updateNotePath(this.db, n.path, next, titleFromPath(next))
        }
      })()
      // The file name may contain a date (journals), so re-parse
      for (const n of affected) await this.indexFile(movedPath(n.path, from, to)!, undefined, true)
      this.relink()
      this.timeDirty = true
      this.semanticDirty = true
      this.log.append({ ts: this.now(), op: 'rename', from, to })
      this.emit({ type: 'unlink', path: from })
      this.emit({ type: 'add', path: to })
    })
  }

  /** Deletes a note or folder (the main process moves it to the system trash) */
  remove(rel: string): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      await this.trash(resolveInVault(this.root, rel))
      const affected = listAllNotes(this.db).filter((n) => movedPath(n.path, rel, rel) !== null)
      this.db.transaction(() => affected.forEach((n) => deleteNote(this.db, n.path)))()
      this.relink()
      this.timeDirty = true
      this.semanticDirty = true
      this.log.append({ ts: this.now(), op: 'delete', path: rel })
      this.emit({ type: 'unlink', path: rel })
    })
  }

  /** Brings the DB in line with the disk and returns the detected changes. Every external change goes through here. */
  reconcile(): Promise<VaultChange[]> {
    return this.exclusive(() => this.reconcileNow())
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    await this.queue.catch(() => {})
    await this.semanticJob?.catch(() => {})
    this.chunkListeners.clear()
    this.db.close()
  }

  // ---- Internals ----

  /** Every operation touching files or the DB runs in order, so reconcile never interleaves with in-app operations */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private emit(c: VaultChange): void {
    for (const cb of this.listeners) cb(c)
  }

  private async initialSync(): Promise<void> {
    if (countEvents(this.db) > 0) {
      await this.reconcileNow()
      return
    }
    // The DB is new (first open, or it was deleted): index the files first, then replay history from the log
    for (const rel of await listNotes(this.root)) await this.indexFile(rel)
    this.relink()
    const history = replay(this.log.readAll())
    this.db.transaction(() => {
      for (const n of listAllNotes(this.db)) {
        const events = history.get(n.path)
        if (events) events.forEach((e) => insertEvent(this.db, n.id, e.ts, e.kind))
        else this.record(n.id, n.path, 'create', n.createdAt)
      }
    })()
  }

  private async reconcileNow(): Promise<VaultChange[]> {
    const changes: VaultChange[] = []
    const known = new Map(listAllNotes(this.db).map((n) => [n.path, n]))
    const added: { rel: string; content: string; hash: string }[] = []

    for (const rel of await listNotes(this.root)) {
      const prev = known.get(rel)
      known.delete(rel)
      const abs = resolveInVault(this.root, rel)
      if (!prev) {
        const content = await fs.readFile(abs, 'utf8')
        added.push({ rel, content, hash: sha256(content) })
        continue
      }
      const stat = await fs.stat(abs)
      if (Math.floor(stat.mtimeMs) === prev.modifiedAt) continue
      const note = await this.indexFile(rel)
      if (note.contentHash !== prev.contentHash) {
        this.record(note.id, rel, 'edit', note.modifiedAt)
        changes.push({ type: 'change', path: rel })
      }
    }

    // A missing file: treat it as a rename if its content matches a new file exactly (keeping its history), otherwise as a deletion
    for (const gone of known.values()) {
      const i =
        gone.contentHash === EMPTY_HASH ? -1 : added.findIndex((a) => a.hash === gone.contentHash)
      if (i >= 0) {
        const [{ rel, content }] = added.splice(i, 1)
        updateNotePath(this.db, gone.path, rel, titleFromPath(rel))
        await this.indexFile(rel, content, true)
        this.log.append({ ts: this.now(), op: 'rename', from: gone.path, to: rel })
        changes.push({ type: 'unlink', path: gone.path }, { type: 'add', path: rel })
      } else {
        deleteNote(this.db, gone.path)
        this.log.append({ ts: this.now(), op: 'delete', path: gone.path })
        changes.push({ type: 'unlink', path: gone.path })
      }
    }

    for (const { rel, content } of added) {
      const note = await this.indexFile(rel, content)
      this.record(note.id, rel, 'create', note.createdAt)
      changes.push({ type: 'add', path: rel })
    }
    if (changes.some((c) => c.type !== 'change')) this.relink()
    if (changes.length) {
      this.timeDirty = true
      this.semanticDirty = true
    }
    return changes
  }

  /**
   * Updates the index (notes, links, notes_fts, chunks) from the file on disk.
   * When the content hash matches the DB, only the mtime is updated without re-parsing; force is used for renames (the date in the file name may change).
   */
  private async indexFile(rel: string, content?: string, force = false): Promise<Note> {
    const abs = resolveInVault(this.root, rel)
    const stat = await fs.stat(abs)
    content ??= await fs.readFile(abs, 'utf8')
    const contentHash = sha256(content)
    const modifiedAt = Math.floor(stat.mtimeMs)
    const createdAt = Math.floor(stat.birthtimeMs) || modifiedAt
    const title = titleFromPath(rel)
    const prev = getNoteByPath(this.db, rel)
    if (prev && prev.contentHash === contentHash && !force) {
      const { id, ...rest } = prev
      upsertNote(this.db, { ...rest, title, modifiedAt })
      return { ...rest, id, title, modifiedAt }
    }

    const parsed = parseNote(rel, content)
    const input = {
      path: rel,
      title,
      createdAt,
      modifiedAt,
      eventDate: parsed.eventDate,
      contentHash
    }
    // The date or path may have changed (same_day, sequence); a content change invalidates the note vector
    this.timeDirty = true
    this.semanticDirty = true
    const { id, rechunked } = this.db.transaction(() => {
      const id = upsertNote(this.db, input)
      setNoteBody(this.db, id, title, parsed.body)
      setWikilinks(this.db, id, countLinks(parsed.links), (t) => this.resolve(t))
      return { id, rechunked: setChunks(this.db, id, chunkMarkdown(parsed.body)) }
    })()
    if (rechunked) for (const cb of this.chunkListeners) cb()
    return { ...input, id }
  }

  private resolve(target: string): number | null {
    this.resolver ??= linkResolver(this.db)
    return this.resolver(target)
  }

  /** Called after notes are created, renamed or deleted: rebuilds the resolver and updates every wikilink target */
  private relink(): void {
    this.resolver = linkResolver(this.db)
    relinkWikilinks(this.db, this.resolver)
  }

  /** Records an event to the DB and events.jsonl, at most once per EVENT_THROTTLE_MS for the same kind */
  private record(noteId: number, rel: string, kind: NoteEventKind, ts: number): void {
    if (kind !== 'create') {
      const last = lastEventTs(this.db, noteId, kind)
      if (last !== null && ts >= last && ts - last < EVENT_THROTTLE_MS) return
    }
    insertEvent(this.db, noteId, ts, kind)
    this.log.append({ ts, kind, path: rel })
    if (kind === 'edit') this.timeDirty = true
  }
}

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false
  )
}
