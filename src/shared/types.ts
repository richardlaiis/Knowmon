// Data types and the IPC interface contract. Changes need the user's approval.
// Every path is a posix path relative to the vault root (for example "日記/2026-10-06.md").

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

/** Compact data for note lists (autocompletion, Quick switcher, clicking links) */
export interface NoteSummary {
  path: string
  title: string
  eventDate: string | null
  modifiedAt: number
}

/** A piece of text; match = true marks a search hit or the link itself (highlighted by the renderer) */
export interface TextSegment {
  text: string
  match: boolean
}

export interface Backlink {
  path: string // source note
  title: string
  line: number // 1-based
  context: TextSegment[] // the line's text, with match = true on the link
}

export interface SearchHit {
  path: string
  title: string
  snippet: TextSegment[]
}

/** Graph edge types */
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' | 'semantic'

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
  /** Dates with create / edit events (local time zone YYYY-MM-DD, ascending), for the graph's "written time" filter */
  activeDays: string[]
}

export interface GraphEdge {
  source: string // note path
  target: string
  type: LinkType
  weight: number
}

/** Graph data: only notes that exist; wikilink targets not yet created are left out. A pair of notes may have edges of several types. */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Events for the timeline's "written time" mode */
export interface ActivityEvent {
  path: string
  title: string
  ts: number
  kind: 'create' | 'edit'
}

/** Time edge parameters, stored in <vault>/.knowmon/settings.json */
export interface TimeSettings {
  /** A gap between edits longer than this many minutes starts a new session */
  sessionGapMinutes: number
  /** A session editing more notes than this is treated as a batch operation and produces no same_session edges */
  sessionMaxNotes: number
  /** event_dates at most this many days apart count as same_day (0 = the same day) */
  sameDayWindowDays: number
}

/** Semantic edge parameters, stored in <vault>/.knowmon/settings.json */
export interface SemanticSettings {
  /** Similarity (0–1) threshold */
  semanticThreshold: number
  /** Maximum number of notes each note links to */
  semanticMaxPerNote: number
}

/** Cloud chat providers (chat only; embeddings always use Ollama) */
export type CloudProvider = 'openai' | 'gemini' | 'custom'
export type ChatProvider = 'ollama' | CloudProvider

/** Ollama connection and models, plus the cloud chat provider; stored in the app's userData/settings.json (per machine) */
export interface LlmSettings {
  /** Ollama address (embeddings; also chat when provider = ollama) */
  baseUrl: string
  /** Ollama chat model */
  chatModel: string
  embedModel: string
  /** The provider used for chat, default 'ollama' */
  provider: ChatProvider
  /** The model id chosen for each cloud provider */
  cloudModels: Partial<Record<CloudProvider, string>>
  /** The API address when provider = custom (https, or loopback http) */
  customBaseUrl: string
  /** Used when provider = ollama */
  ollamaLimits: ChatLimits
  /** Shared by the cloud providers (OpenAI, Gemini, custom) */
  cloudLimits: ChatLimits
}

/** Context length and output limit for chat */
export interface ChatLimits {
  /** Context length (tokens). Sent to Ollama as num_ctx; also scales the character budgets for note content */
  contextTokens: number
  /** Maximum tokens per reply; null = model default */
  maxOutputTokens: number | null
}

export interface LlmStatus {
  /** The current chat provider is available (summaries, Q&A, Agent) */
  online: boolean
  /** Ollama is online (embeddings, semantic search, semantic edges) */
  ollamaOnline: boolean
  /** Problems that block chat (offline, bad API key, model not downloaded and so on), shown to the user */
  error: string | null
  /** Problems that only affect embeddings (such as Ollama offline in cloud mode), shown as a notice */
  embedError: string | null
  /** Models downloaded in Ollama */
  models: string[]
  /** Model ids available from the current cloud provider (empty when they can't be listed; manual entry still works) */
  cloudModels: string[]
  /** Which cloud providers have a saved API key (the key itself is never sent to the renderer) */
  apiKeys: Record<CloudProvider, boolean>
  /** false: the OS has no keyring, so API keys are only obfuscated on disk */
  keyEncrypted: boolean
  settings: LlmSettings
  /** Embedding progress: notes done / notes with content */
  embedded: number
  total: number
  /** Embedding is running in the background */
  busy: boolean
}

export interface RetrieveOptions {
  /** Default 20 */
  limit?: number
  /** YYYY-MM-DD, inclusive at both ends; by event_date, or the last modified date when there is none */
  from?: string
  to?: string
  /** Add graph neighbors of the top results, default true */
  expand?: boolean
}

export interface RetrieveHit {
  path: string
  title: string
  score: number
  /** Starting line of the most relevant passage (1-based) */
  line: number
  snippet: TextSegment[]
  /** Which sources matched this note */
  via: ('fulltext' | 'vector' | 'graph')[]
}

export interface RetrieveResult {
  hits: RetrieveHit[]
  /** false means no vectors were used this time (Ollama offline or not built yet) */
  vector: boolean
}

export interface SummaryRequest {
  path: string
  /** When set, only this selected text is summarized (path provides the title and context) */
  selection?: string
  /** Summary language, default 'zh-TW' */
  language?: SummaryLanguage
}

export type SummaryLanguage = 'zh-TW' | 'en'

export interface SummaryChunk {
  id: string
  delta: string
  done: boolean
  error?: string
}

/** Date range (YYYY-MM-DD, inclusive at both ends) */
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
  /** Earlier Q&A (oldest → newest), used only as conversation context */
  history?: ChatTurn[]
  /** Time range. undefined = parse it from the question; null = the user removed the range, no filter */
  range?: DateRange | null
}

export interface AskSource {
  /** Citation number [n] in the answer (1-based) */
  n: number
  path: string
  title: string
  /** Starting line of the passage (1-based) */
  line: number
  snippet: TextSegment[]
  /** event_date, or the last modified date when there is none */
  date: string
}

export interface AnswerChunk {
  id: string
  delta: string
  done: boolean
  error?: string
  /** Pushed once when retrieval finishes (before the first chunk) */
  sources?: AskSource[]
  /** The time range actually applied, pushed with sources; null = not filtered */
  range?: DateRange | null
  /** false = no vectors were used this time, pushed with sources */
  vector?: boolean
  /** Sent with done: the numbers actually cited in the answer */
  cited?: number[]
}

export type AgentToolName =
  'search_notes' | 'get_note' | 'get_neighbors' | 'list_notes_in_range' | 'create_note' | 'add_tags'

export interface AgentRequest {
  task: string
  /** Earlier tasks and final answers (oldest → newest), used only as context */
  history?: ChatTurn[]
}

/** A write tool's proposal, waiting for the user's confirmation */
export type AgentProposal =
  | { kind: 'create_note'; path: string; content: string; missingLinks: string[] }
  | {
      kind: 'add_tags'
      path: string
      title: string
      tags: string[]
      /** The frontmatter before and after the change (before is an empty string when there is no frontmatter) */
      before: string
      after: string
    }

export interface AgentStep {
  /** Step number (0-based), used by confirm */
  index: number
  tool: AgentToolName
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'confirm' | 'applied' | 'rejected'
  /** A one-line description for the user */
  label: string
  /** Notes in the result (clickable) */
  notes: { path: string; title: string }[]
  error?: string
  /** Present when status = 'confirm'; applied / rejected keep the last version */
  proposal?: AgentProposal
}

export interface AgentChunk {
  id: string
  /** Text from the model (explanations between tool calls, or the final answer) */
  delta: string
  done: boolean
  error?: string
  /** A new or updated step (replacing the one with the same index) */
  step?: AgentStep
}

export interface AgentDecision {
  approved: boolean
  /** The proposal as edited by the user (only create_note's path / content and add_tags' tags can change) */
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
    pick(): Promise<string | null> // folder picker dialog
    getCurrent(): Promise<string | null> // the last opened vault
    tree(): Promise<TreeNode>
    onChange(cb: (c: VaultChange) => void): () => void
  }
  notes: {
    read(path: string): Promise<string> // records an open event
    write(path: string, content: string): Promise<void>
    create(path: string): Promise<void>
    createFolder(path: string): Promise<void>
    /**
     * Saves an image pasted or dropped into a note (in attachments/ at the vault root), adding a number on a name clash and never overwriting.
     * Returns the vault-relative path it was saved to. (Added with the user's approval, 2026-10-20.)
     */
    saveAttachment(notePath: string, fileName: string, data: Uint8Array): Promise<string>
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
    /** create / edit events in [from, to), sorted by time */
    activity(from: number, to: number): Promise<ActivityEvent[]>
  }
  settings: {
    getTime(): Promise<TimeSettings>
    /** Writes and returns the values actually applied (after clamping); time edges are recomputed */
    setTime(s: Partial<TimeSettings>): Promise<TimeSettings>
    getSemantic(): Promise<SemanticSettings>
    /** Writes and returns the values actually applied (after clamping); semantic edges are recomputed */
    setSemantic(s: Partial<SemanticSettings>): Promise<SemanticSettings>
  }
  llm: {
    status(): Promise<LlmStatus>
    /** Re-checks the connection and resumes embedding */
    retry(): Promise<LlmStatus>
    onStatus(cb: (s: LlmStatus) => void): () => void
    setSettings(s: Partial<LlmSettings>): Promise<LlmStatus>
    /** Saves a cloud provider's API key (null or an empty string = delete); keys are write-only */
    setApiKey(provider: CloudProvider, key: string | null): Promise<LlmStatus>
    retrieve(query: string, opts?: RetrieveOptions): Promise<RetrieveResult>
    /** Starts a streaming summary and returns a request id; chunks are pushed through onSummary */
    summarize(req: SummaryRequest): Promise<string>
    cancel(id: string): Promise<void>
    onSummary(cb: (c: SummaryChunk) => void): () => void
    /** Starts streaming an answer and returns a request id; chunks are pushed through onAnswer. Cancel with cancel(id) */
    ask(req: AskRequest): Promise<string>
    onAnswer(cb: (c: AnswerChunk) => void): () => void
    /** Starts an agent task and returns a request id; progress is pushed through onAgent. Cancel with cancel(id) */
    agent(req: AgentRequest): Promise<string>
    onAgent(cb: (c: AgentChunk) => void): () => void
    /** Answers a write proposal (AgentStep.status = 'confirm') */
    confirm(id: string, step: number, decision: AgentDecision): Promise<void>
  }
}
