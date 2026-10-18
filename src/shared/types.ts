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

/** 圖譜邊的類型 */
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' | 'semantic'

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

/** semantic 邊的參數，存在 <vault>/.knowmon/settings.json */
export interface SemanticSettings {
  /** 相似度（0–1）門檻 */
  semanticThreshold: number
  /** 每篇最多連到幾篇 */
  semanticMaxPerNote: number
}

/** Ollama 連線與模型，存在 App 的 userData/settings.json（跟著機器走） */
export interface LlmSettings {
  baseUrl: string
  chatModel: string
  embedModel: string
}

export interface LlmStatus {
  online: boolean
  /** 離線、模型未下載等原因，給使用者看 */
  error: string | null
  /** Ollama 已下載的模型 */
  models: string[]
  settings: LlmSettings
  /** embedding 進度：已完成的筆記數 / 有內容的筆記數 */
  embedded: number
  total: number
  /** 背景正在 embedding */
  busy: boolean
}

export interface RetrieveOptions {
  /** 預設 20 */
  limit?: number
  /** YYYY-MM-DD，含兩端；依 event_date，沒有的話用最後修改日 */
  from?: string
  to?: string
  /** 加入前幾名的圖譜鄰居，預設 true */
  expand?: boolean
}

export interface RetrieveHit {
  path: string
  title: string
  score: number
  /** 最相關的段落起始行（1-based） */
  line: number
  snippet: TextSegment[]
  /** 這篇由哪些來源命中 */
  via: ('fulltext' | 'vector' | 'graph')[]
}

export interface RetrieveResult {
  hits: RetrieveHit[]
  /** false 表示這次沒有用到向量（Ollama 離線或尚未建好） */
  vector: boolean
}

export interface SummaryRequest {
  path: string
  /** 有值時只總結這段選取文字（path 提供標題與上下文） */
  selection?: string
  /** 總結使用的語言，預設 'zh-TW' */
  language?: SummaryLanguage
}

export type SummaryLanguage = 'zh-TW' | 'en'

export interface SummaryChunk {
  id: string
  delta: string
  done: boolean
  error?: string
}

/** 日期範圍（YYYY-MM-DD，含兩端） */
export interface DateRange {
  from: string
  to: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  question: string
  /** 之前的問答（舊 → 新），只作為對話脈絡 */
  history?: ChatTurn[]
  /** 時間範圍。undefined = 從問題中解析；null = 使用者取消了範圍，不篩選 */
  range?: DateRange | null
}

export interface AskSource {
  /** 回答中的引用編號 [n]（1-based） */
  n: number
  path: string
  title: string
  /** 段落起始行（1-based） */
  line: number
  snippet: TextSegment[]
  /** event_date，沒有的話用最後修改日 */
  date: string
}

export interface AnswerChunk {
  id: string
  delta: string
  done: boolean
  error?: string
  /** 檢索完成時推送一次（第一個片段之前） */
  sources?: AskSource[]
  /** 實際套用的時間範圍，與 sources 一起推送；null = 未篩選 */
  range?: DateRange | null
  /** false = 這次沒有用到向量，與 sources 一起推送 */
  vector?: boolean
  /** done 時帶上：回答中實際引用的編號 */
  cited?: number[]
}

export type AgentToolName =
  'search_notes' | 'get_note' | 'get_neighbors' | 'list_notes_in_range' | 'create_note' | 'add_tags'

export interface AgentRequest {
  task: string
  /** 之前的任務與最終回答（舊 → 新），只作為脈絡 */
  history?: ChatTurn[]
}

/** 寫入工具的提案，等待使用者確認 */
export type AgentProposal =
  | { kind: 'create_note'; path: string; content: string; missingLinks: string[] }
  | {
      kind: 'add_tags'
      path: string
      title: string
      tags: string[]
      /** 修改前後的 frontmatter（沒有 frontmatter 時 before 為空字串） */
      before: string
      after: string
    }

export interface AgentStep {
  /** 第幾步（0-based），confirm 時用 */
  index: number
  tool: AgentToolName
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'confirm' | 'applied' | 'rejected'
  /** 給使用者看的一行說明 */
  label: string
  /** 結果中的筆記（可點擊） */
  notes: { path: string; title: string }[]
  error?: string
  /** status = 'confirm' 時帶上；applied / rejected 時保留最後的版本 */
  proposal?: AgentProposal
}

export interface AgentChunk {
  id: string
  /** 模型輸出的文字（工具呼叫之間的說明，或最終回答） */
  delta: string
  done: boolean
  error?: string
  /** 新增或更新的步驟（同 index 取代） */
  step?: AgentStep
}

export interface AgentDecision {
  approved: boolean
  /** 使用者修改後的提案（只能改 create_note 的 path / content、add_tags 的 tags） */
  edited?: AgentProposal
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
    getSemantic(): Promise<SemanticSettings>
    /** 寫入並回傳實際套用（限制範圍後）的值；semantic 邊會重算 */
    setSemantic(s: Partial<SemanticSettings>): Promise<SemanticSettings>
  }
  llm: {
    status(): Promise<LlmStatus>
    /** 重新檢查連線並恢復 embedding */
    retry(): Promise<LlmStatus>
    onStatus(cb: (s: LlmStatus) => void): () => void
    setSettings(s: Partial<LlmSettings>): Promise<LlmStatus>
    retrieve(query: string, opts?: RetrieveOptions): Promise<RetrieveResult>
    /** 開始串流總結，回傳 request id；片段經 onSummary 推送 */
    summarize(req: SummaryRequest): Promise<string>
    cancel(id: string): Promise<void>
    onSummary(cb: (c: SummaryChunk) => void): () => void
    /** 開始串流回答，回傳 request id；片段經 onAnswer 推送。取消沿用 cancel(id) */
    ask(req: AskRequest): Promise<string>
    onAnswer(cb: (c: AnswerChunk) => void): () => void
    /** 開始執行 agent 任務，回傳 request id；過程經 onAgent 推送。取消沿用 cancel(id) */
    agent(req: AgentRequest): Promise<string>
    onAgent(cb: (c: AgentChunk) => void): () => void
    /** 回覆寫入提案（AgentStep.status = 'confirm'） */
    confirm(id: string, step: number, decision: AgentDecision): Promise<void>
  }
}
