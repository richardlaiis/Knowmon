// 資料型別與 IPC 介面合約。修改前需經過使用者同意。
// 所有 path 都是相對於 vault 根目錄的 posix 路徑（例如 "日記/2026-10-06.md"）。

export type NoteEventKind = 'create' | 'edit' | 'open'

export interface Note {
  id: number
  path: string
  title: string
  createdAt: number // ms epoch
  modifiedAt: number // ms epoch
  eventDate: string | null // YYYY-MM-DD
  contentHash: string
}

export interface NoteEvent {
  noteId: number
  ts: number
  kind: NoteEventKind
}

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'folder'
  children?: TreeNode[]
}

export interface VaultChange {
  type: 'add' | 'change' | 'unlink'
  path: string
}

export interface KnowmonAPI {
  vault: {
    pick(): Promise<string | null> // 對話框選資料夾
    getCurrent(): Promise<string | null> // 上次開啟的 vault
    tree(): Promise<TreeNode>
    onChange(cb: (c: VaultChange) => void): () => void
  }
  notes: {
    read(path: string): Promise<string> // 會記 open 事件
    write(path: string, content: string): Promise<void>
    create(path: string): Promise<void>
    createFolder(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
  }
}
