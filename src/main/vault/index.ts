// 讀寫檔案、監聽變更。Vault 協調三者：Markdown 檔（真相）、events.jsonl（歷程真相）、SQLite（索引）。
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type {
  Backlink,
  Note,
  NoteEventKind,
  NoteSummary,
  SearchHit,
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
import { EventsLog, movedPath, replay } from '../db/events-log'
import { searchNotes } from '../db/search'
import { countLinks, parseNote } from '../indexer'
import { META_DIR, isNotePath, normalizeRel, resolveInVault, titleFromPath } from './paths'
import { buildTree, listNotes } from './tree'
import { watchVault, type Watcher } from './watcher'

/** 同一篇筆記、同一種事件在這段時間內只記一次 */
export const EVENT_THROTTLE_MS = 60_000

const EMPTY_HASH = sha256('')

export interface VaultOptions {
  /** 刪除時呼叫；main process 傳入 shell.trashItem，測試時用預設的永久刪除 */
  trash?: (absPath: string) => Promise<void>
  now?: () => number
  /** 是否啟動 chokidar（測試時關閉，直接呼叫 reconcile） */
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
  /** wikilink 解析器快取；筆記集合改變時由 relink() 重建 */
  private resolver: ((target: string) => number | null) | null = null

  private constructor(
    readonly root: string,
    opts: VaultOptions
  ) {
    const meta = path.join(root, META_DIR)
    mkdirSync(meta, { recursive: true })
    this.db = openDb(path.join(meta, 'index.db'))
    this.log = new EventsLog(path.join(meta, 'events.jsonl'))
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

  /** 所有筆記（依路徑排序） */
  list(): NoteSummary[] {
    return listNoteSummaries(this.db)
  }

  backlinks(rel: string): Backlink[] {
    return getBacklinks(this.db, normalizeRel(rel))
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

  create(rel: string): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      if (!isNotePath(rel)) throw new Error(`Notes must be .md files: ${rel}`)
      const abs = resolveInVault(this.root, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, '', { flag: 'wx' }).catch((e) => {
        if (e.code === 'EEXIST') throw new Error(`A note with this name already exists: ${rel}`)
        throw e
      })
      const { id } = await this.indexFile(rel, '')
      this.relink()
      this.record(id, rel, 'create', this.now())
      this.emit({ type: 'add', path: rel })
    })
  }

  /** 建立空資料夾（資料夾不進 DB，也不記事件） */
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

  /** 重新命名或搬移筆記/資料夾，歷程跟著走 */
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
      // 檔名可能帶有日期（日記），重新解析
      for (const n of affected) await this.indexFile(movedPath(n.path, from, to)!, undefined, true)
      this.relink()
      this.log.append({ ts: this.now(), op: 'rename', from, to })
      this.emit({ type: 'unlink', path: from })
      this.emit({ type: 'add', path: to })
    })
  }

  /** 刪除筆記或資料夾（main process 會移到系統垃圾桶） */
  remove(rel: string): Promise<void> {
    return this.exclusive(async () => {
      rel = normalizeRel(rel)
      await this.trash(resolveInVault(this.root, rel))
      const affected = listAllNotes(this.db).filter((n) => movedPath(n.path, rel, rel) !== null)
      this.db.transaction(() => affected.forEach((n) => deleteNote(this.db, n.path)))()
      this.relink()
      this.log.append({ ts: this.now(), op: 'delete', path: rel })
      this.emit({ type: 'unlink', path: rel })
    })
  }

  /** 讓 DB 與磁碟一致，回傳偵測到的變更。外部修改都經過這裡。 */
  reconcile(): Promise<VaultChange[]> {
    return this.exclusive(() => this.reconcileNow())
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    await this.queue.catch(() => {})
    this.db.close()
  }

  // ---- 內部 ----

  /** 所有會動到檔案或 DB 的操作依序執行，避免 reconcile 與 App 內操作交錯 */
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
    // DB 是新的（第一次開啟或被刪掉）：先索引檔案，再從日誌重播歷程
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

    // 不見的檔案：內容與新檔完全相同就當作改名（保留歷程），否則視為刪除
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
    return changes
  }

  /**
   * 依磁碟上的檔案更新索引（notes、links、notes_fts）。
   * 內容 hash 與 DB 相同時只更新 mtime，不重新解析；force 用於改名（檔名日期可能改變）。
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
    const id = this.db.transaction(() => {
      const id = upsertNote(this.db, input)
      setNoteBody(this.db, id, title, parsed.body)
      setWikilinks(this.db, id, countLinks(parsed.links), (t) => this.resolve(t))
      return id
    })()
    return { ...input, id }
  }

  private resolve(target: string): number | null {
    this.resolver ??= linkResolver(this.db)
    return this.resolver(target)
  }

  /** 筆記新增、改名、刪除後呼叫：重建解析器，並更新所有 wikilink 的目標 */
  private relink(): void {
    this.resolver = linkResolver(this.db)
    relinkWikilinks(this.db, this.resolver)
  }

  /** 記錄事件到 DB 與 events.jsonl，同類事件在 EVENT_THROTTLE_MS 內只記一次 */
  private record(noteId: number, rel: string, kind: NoteEventKind, ts: number): void {
    if (kind !== 'create') {
      const last = lastEventTs(this.db, noteId, kind)
      if (last !== null && ts >= last && ts - last < EVENT_THROTTLE_MS) return
    }
    insertEvent(this.db, noteId, ts, kind)
    this.log.append({ ts, kind, path: rel })
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
