# Phase 5 implementation plan: basic LLM capabilities

Done when: vector retrieval works and a single note can be summarized.

Environment (confirmed 2026-10-11): Ollama 0.35.1 with `qwen3:8b`, `qwen3.5:9b` and `bge-m3` (1024 dimensions, context 8192) downloaded. `sqlite-vec` 0.1.9 can be loaded by better-sqlite3 13 (`vec0` and `distance_metric=cosine` work).

## Confirmed decisions (2026-10-11)

- The default chat model is `qwen3:8b` (switchable in settings).
- Summaries appear in a new AI tab in the right panel.
- The `types.ts` contract and schema changes (SCHEMA_VERSION 2 → 3) are approved.

## Results and deviations from the plan (2026-10-11)

- `chunks` gained a `heading` column (the text sent for embedding includes the section heading) and uses `AUTOINCREMENT` so ids are never reused.
- The Embedder writes vectors **without going through the Vault queue**: better-sqlite3 is synchronous, so writes can't interleave; checking "the chunk still exists and hasn't been embedded" is enough to detect stale results.
- Semantic edges don't use per-note vec0 KNN (1.5 seconds at 1000 notes, which would block main); similarity is computed pairwise in JS instead, yielding the event loop between segments (about 0.6 seconds at 1000 notes, each segment < 50 ms). `Vault.graph()` became async as a result.
- The default semantic threshold became **0.65**. Measured with bge-m3 (`OLLAMA_IT=1`): 「早上跑步五公里」 ("ran 5 km this morning") vs. 「清晨慢跑五公里」 ("jogged 5 km at dawn") 0.765, vs. 「晚餐煮番茄炒蛋」 ("cooked tomato and egg for dinner") 0.420, and vs. an English paraphrase 0.800. test-vault has 14 edges at 0.6; those between 0.61 and 0.65 are mostly marginal (for example "時間脈絡連結 – 深度工作" 0.607), while those above 0.65 are clearly related ("2026-10-04 – 深度工作" 0.723).
- Summaries: qwen3:8b summarizes 「原子習慣」 in about 15–30 seconds (including loading the model) without outputting its reasoning.
- Status bar: the app has no status bar, so it lives at the bottom of the left sidebar instead (clicking opens the right AI tab); model settings are under "Settings" in the AI tab.
- The hybrid retrieval UI gained a date range (from / to).
- Graph edge-type preferences now record both on and off (`a,-b`), so semantic, which is missing from older preferences, defaults to on.
- On rename, notes with identical content keep their existing vectors (`setChunks` compares and doesn't rewrite).

## Principles check

- **Markdown is the only source of truth**: chunks and vectors are an index and can be rebuilt from the notes (at the cost of re-embedding). After the DB is deleted they are recomputed in the background.
- **Ollama is optional**: all LLM calls happen only in `src/main/llm/`; when it can't be reached, `llm.status()` reports offline, the UI shows a notice, and nothing else is affected. Embedding progress pauses where it is and resumes when Ollama is back.
- **Only the main process accesses the DB and Ollama**: the renderer goes through IPC only.
- This phase has no LLM actions that write notes (summaries are only shown and can be copied).

## 1. Ollama client (`src/main/llm/ollama.ts`)

- Uses Node's built-in `fetch`, with no new dependency. `baseUrl` defaults to `http://127.0.0.1:11434`.
- `version()`, `tags()` (downloaded models), `embed(model, texts)` (`/api/embed`, batched), `chat(model, messages, { signal, onDelta })` (`/api/chat` streaming NDJSON, `think: false` so qwen3 doesn't output its reasoning).
- Timeouts: 2 seconds for connection checks; 60 seconds per embedding batch; no overall timeout for chat, which can be cancelled (`AbortController`).
- Status is checked when a vault opens, when embedding fails and when the user clicks "Retry"; while offline it retries in the background every 30 seconds and notifies the renderer when it recovers.

## 2. Chunking and embedding

### Chunking (pure function `src/main/indexer/chunk.ts`)

- The input is `parseNote`'s `body` (frontmatter replaced with blank lines, so line numbers match the file).
- First split by Markdown heading, then within a section accumulate paragraphs (separated by blank lines) up to about `CHUNK_CHARS = 800` characters; a single overlong paragraph is split again at sentence ends/line breaks. Fenced code isn't split in the middle (unless it's too long by itself).
- Each chunk records `line` (its starting line, 1-based), and the text sent for embedding is prefixed with "Title › Section heading" so short chunks still have context; the DB stores the original text.
- Empty notes have no chunks.

### Schema (`SCHEMA_VERSION` 2 → 3; old DBs are simply rebuilt)

```sql
CREATE TABLE chunks (
  id      INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,      -- chunk index within the note
  line    INTEGER NOT NULL,      -- starting line (1-based)
  text    TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX chunks_note ON chunks(note_id, seq);
CREATE INDEX chunks_pending ON chunks(embedded) WHERE embedded = 0;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- embed_model, embed_dim

-- The vector tables are created when the first embedding arrives (the dimension depends on the model):
-- CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[<dim>] distance_metric=cosine)  -- rowid = chunks.id
-- CREATE VIRTUAL TABLE vec_notes  USING vec0(embedding float[<dim>] distance_metric=cosine)  -- rowid = notes.id, the (normalized) average of the chunk vectors
```

- `vec0` doesn't support foreign keys, so triggers delete the matching vectors when a chunk or note is deleted (created along with the vector tables).
- Changing the embedding model (a different `meta.embed_model`) drops both vector tables and marks every chunk as not embedded, to be recomputed in the background.

### Flow

- When `indexFile` re-parses a note (which only happens when the content hash changes), it also rewrites that note's chunks (all with `embedded = 0`). It only touches the DB and never calls Ollama, so the queue isn't slowed down.
- `Embedder` (`src/main/llm/embedder.ts`) processes chunks with `embedded = 0` in the background: it calls Ollama with 16 chunks per batch, and when they return, checks **inside the Vault queue** that the chunks still exist (the note may have been modified or deleted) before writing the vectors; once all of a note's chunks are done, it updates `vec_notes`.
- The Vault wakes the Embedder after every change; it pauses when Ollama is offline or the model isn't downloaded, with the error message in the status.
- Progress (embedded notes / total) is pushed to the renderer as an event, and the status shows "Embedding 120/1000".

## 3. Retrieval (`src/main/llm/retrieve.ts`)

`retrieve(query, opts)` combines four sources:

1. **Full text**: reuses `searchNotes` (FTS5 trigram + LIKE for short terms), taking the top 50 notes.
2. **Vectors**: the query embedding takes the 50 nearest chunks from `vec_chunks`, keeping the nearest chunk per note.
3. **Merge**: Reciprocal Rank Fusion (`1 / (60 + rank)`, summed across both). A pure function, with tests for the ordering.
4. **Graph neighbors** (`expand`, on by default): the wikilink/semantic neighbors of the top 5 each get `0.5 ×` that note's score, so related notes that don't match the keywords can still appear.
5. **Time filter**: `from` / `to` (YYYY-MM-DD, inclusive), by `event_date` (or the local date of the written time `modified_at` when there is none). Applied before merging.

When Ollama is offline or vectors aren't built yet, it falls back to full text + graph automatically, marks the result `vector: false`, and the UI says semantic search is temporarily unavailable.

Each result carries its most relevant chunk (`line` and a text snippet), which phase 6's RAG reuses directly.

UI: the sidebar's Search tab gets a "Keyword / Hybrid" toggle (preference in localStorage `knowmon.search.mode`); hybrid mode queries only after Enter (it needs to call Ollama); results show the matching passage, and clicking opens the note and scrolls to that line.

## 4. Summaries

- **Summarize a note**: the command `Ctrl/Cmd+Shift+S`, plus a button at the top right of the note tab.
- **Summarize the selection**: with a selection, the same shortcut summarizes the selected range instead.
- Results appear in a new third tab of the right panel, **AI** (Backlinks / Local graph / AI), streamed, with stop, copy and regenerate. Results exist only in memory.
- Main builds the prompt: Traditional Chinese, bullet-point key ideas, keeping `[[wikilinks]]`; overly long notes (> 12000 characters) are summarized chunk by chunk first and then combined (map-reduce).
- Streaming: `llm.summarize()` returns a request id, chunks are pushed through the `llm:summary` event, and `llm.cancel(id)` cancels.

## 5. `semantic` edges

- Derived from `vec_notes`: each note takes its top `semanticMaxPerNote` (default 5) KNN neighbors, and an edge is created only when the similarity (`1 - cosine distance`) is ≥ `semanticThreshold` (default 0.6, to be tuned after measuring bge-m3), weighted by similarity and undirected (the path that sorts first is `src`).
- Like time edges, not incremental: any change in embeddings marks them dirty, and `graph()` recomputes before reading (computed with `vec0` KNN at 1000 notes, with a test measuring it).
- Parameters are stored in the `semantic` field of the vault's `.knowmon/settings.json` (next to `time`), with ranges: threshold 0.3–0.95, maxPerNote 1–20.
- Graph: the edge-type filters gain `semantic` (a new CSS variable `--edge-semantic`), and it takes part in layout. A set of semantic parameters goes next to the time settings dialog.

## 6. Settings

| Setting                                     | Stored in                                                    | Why                                         |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Ollama address, chat model, embedding model | The `llm` field of the app's `userData/settings.json`        | Follows the machine, shared across vaults   |
| Semantic threshold, per-note limit          | The `semantic` field of the vault's `.knowmon/settings.json` | Follows the vault, like the time parameters |

Defaults: chat `qwen3:8b`, embedding `bge-m3`. Clicking the LLM indicator in the status opens a small dialog: connection status, choosing from downloaded models, retry.

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' | 'semantic'

export interface LlmSettings {
  baseUrl: string
  chatModel: string
  embedModel: string
}

export interface SemanticSettings {
  /** Similarity (0–1) threshold */
  semanticThreshold: number
  /** Maximum number of notes each note links to */
  semanticMaxPerNote: number
}

export interface LlmStatus {
  online: boolean
  /** Reasons such as offline or a missing model, shown to the user */
  error: string | null
  /** Models downloaded in Ollama */
  models: string[]
  settings: LlmSettings
  /** Embedding progress: notes done / notes with content */
  embedded: number
  total: number
  /** Embedding is running in the background */
  busy: boolean
}

export interface RetrieveOptions {
  limit?: number // default 20
  from?: string // YYYY-MM-DD, inclusive
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
}

export interface SummaryChunk {
  id: string
  delta: string
  done: boolean
  error?: string
}

// Added to KnowmonAPI:
llm: {
  status(): Promise<LlmStatus>
  /** Re-checks the connection and resumes embedding */
  retry(): Promise<LlmStatus>
  onStatus(cb: (s: LlmStatus) => void): () => void
  setSettings(s: Partial<LlmSettings>): Promise<LlmStatus>
  retrieve(query: string, opts?: RetrieveOptions): Promise<RetrieveResult>
  /** Starts a streaming summary and returns a request id; chunks are pushed through onSummary */
  summarize(req: SummaryRequest): Promise<string>
  cancel(id: string): Promise<void>
  onSummary(cb: (c: SummaryChunk) => void): () => void
}
settings: {
  // The existing getTime / setTime are unchanged; added:
  getSemantic(): Promise<SemanticSettings>
  setSemantic(s: Partial<SemanticSettings>): Promise<SemanticSettings>
}
```

## Tests

- `chunk.test.ts`: splitting by heading, long paragraphs, code blocks, line numbers, Chinese and English.
- `ollama.test.ts`: NDJSON stream parsing, timeouts and offline errors with a fake `fetch`.
- `embedder.test.ts`: a fake embed function (fixed vectors derived from the text); no stale vectors written when a note is modified/deleted mid-embedding; recomputing after a model change; pausing while offline and resuming after.
- `retrieve.test.ts`: RRF ordering, neighbor expansion, time filtering, falling back to full text without vectors.
- `semantic.test.ts`: threshold, per-note limit, undirected deduplication; recompute time at 1000 notes.
- `db.test.ts`: chunks and vectors are deleted with their note; a schema version bump rebuilds.
- Integration tests against a real Ollama run only with `OLLAMA_IT=1` (not on CI).

## Later additions (2026-10-12)

- Summaries can switch between Traditional Chinese and English (`SummaryRequest.language`, a contract change approved by the user).
- Summaries are rendered as Markdown, replacing the plain text display that only turned wikilinks into links (`splitWikilinks` was removed).
- Summaries occasionally contained links not in the original (for example copying the `[[wikilink]]` from the prompt): the prompt now includes the original's list of links and no examples, and the output filters out links not on the list. Tested on 3 test-vault notes (one without links) × Chinese and English; the links all matched the original.
- Tested with qwen3:8b: an English prompt with Chinese examples made it answer in Simplified Chinese, so the examples were removed and the language instruction is repeated after the content; the small model still occasionally adds content that isn't in the note.

## Not doing (left for later)

- The chat panel and RAG answers (phase 6), agent tools (phase 7).
- Caching embeddings in `.knowmon/` to avoid recomputing after a DB rebuild (reconsider if rebuilds take too long).
