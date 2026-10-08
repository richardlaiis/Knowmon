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

/** 筆記清單用的精簡資料（自動補全、Quick switcher、點擊連結） */
export interface NoteSummary {
  path: string
  title: string
  eventDate: string | null
  modifiedAt: number
}

/** 一段文字，match = true 表示搜尋命中或連結本身（renderer 以高亮顯示） */
export interface TextSegment {
  text: string
  match: boolean
}

export interface Backlink {
  path: string // 來源筆記
  title: string
  line: number // 1-based
  context: TextSegment[] // 該行文字，連結部分 match = true
}

export interface SearchHit {
  path: string
  title: string
  snippet: TextSegment[]
}

/** 圖譜邊的類型；階段 5 會加入 semantic */
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence'

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
  /** 有 create / edit 事件的日期（本地時區 YYYY-MM-DD，遞增），圖譜「寫作時間」篩選用 */
  activeDays: string[]
}

export interface GraphEdge {
  source: string // 筆記路徑
  target: string
  type: LinkType
  weight: number
}

/** 圖譜資料：只含已存在的筆記，尚未建立的 wikilink 目標不列入。同一對筆記可能有多種類型的邊。 */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 時間軸「寫作時間」模式用的事件 */
export interface ActivityEvent {
  path: string
  title: string
  ts: number
  kind: 'create' | 'edit'
}

/** 時間邊的參數，存在 <vault>/.knowmon/settings.json */
export interface TimeSettings {
  /** 兩次編輯間隔超過這個分鐘數就算新的 session */
  sessionGapMinutes: number
  /** 一個 session 編輯超過這麼多篇時視為批次操作，不產生 same_session 邊 */
  sessionMaxNotes: number
  /** event_date 相差幾天以內算 same_day（0 = 同一天） */
  sameDayWindowDays: number
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
    list(): Promise<NoteSummary[]>
  }
  links: {
    backlinks(path: string): Promise<Backlink[]>
  }
  search: {
    query(q: string, limit?: number): Promise<SearchHit[]>
  }
  graph: {
    get(): Promise<GraphData>
  }
  timeline: {
    /** [from, to) 之間的 create / edit 事件，依時間排序 */
    activity(from: number, to: number): Promise<ActivityEvent[]>
  }
  settings: {
    getTime(): Promise<TimeSettings>
    /** 寫入並回傳實際套用（限制範圍後）的值；時間邊會重算 */
    setTime(s: Partial<TimeSettings>): Promise<TimeSettings>
  }
}
