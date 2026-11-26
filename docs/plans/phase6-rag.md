# Phase 6 implementation plan: Q&A (RAG)

Done when: the chat panel answers questions with clickable source notes.

- [x] Chat panel UI
- [x] RAG answers with source links
- [x] Time range filtering (for example "notes from last month")

## Confirmed decisions (2026-10-12)

- The `types.ts` contract changes are approved (see "IPC contract changes" below).
- The chat panel lives in the right panel's AI tab, switched with "Chat / Summary".
- Citations use numbers, `[n]`.

## Results and deviations from the plan (2026-10-12)

- **Full-text retrieval uses keywords ORed together**: `searchNotes` splits on whitespace and ANDs everything, so a Chinese question (「深度工作的重點是什麼？」, "What are the key points of Deep Work?") is one long term that almost never matches. Q&A instead uses `keywords()` to remove punctuation, question words and function words, then searches each keyword separately (OR) through `retrieve()`'s internal `keywords` parameter, ranking notes that match more keywords higher. The IPC is unaffected (`RetrieveOptions` is unchanged), and sidebar search is still AND.
- **Follow-ups**: the plan was to retrieve with "previous question + current question", but with keyword OR the previous question's terms drowned out the new one. Instead: when there are no keywords, or the question reads like a follow-up (「那…」 "and…", 「還有…」 "also…", 「…呢？」 "what about…?", "what about…"), the vector query adds the previous question; only when the question has no keywords of its own does it reuse the previous question's keywords. Ordinals like 「第二點」 ("the second point") aren't keywords.
- When adding chunks before and after, only chunks adjacent to the selected passages are added, so each note's text is always contiguous and needs no "…" separators.
- When there's only a time and nothing to retrieve (「上個月寫了什麼？」, "What did I write last month?"), or retrieval is empty but there is a time range, the notes in the range are listed (newest first). When no sources are found at all, it replies "No relevant notes were found" directly without calling the model.
- The answer language follows the question: Traditional Chinese when CJK characters ≥ English words.
- `AnswerChunk`s aren't checked for cancellation before being pushed; after cancelling, main still sends `done` (without an error), and the renderer ignores any chunks after stopping (the same as summaries).
- Tested (qwen3:8b, bge-m3, test-vault, `OLLAMA_IT=1`):
  - 「深度工作的重點是什麼？」 ("What are the key points of Deep Work?") in about 5 seconds, citing [1] 深度工作.
  - 「2026-10-04 到 2026-10-06 之間做了什麼？」 ("What did I do between 2026-10-04 and 2026-10-06?"): correct range, the sources are only the three journal notes, and all three are cited (about 28 seconds, including loading the model).
  - "What are the key ideas of Atomic Habits?": answered in English, citing 原子習慣.
  - 「薛丁格方程式怎麼推導？」 ("How is the Schrödinger equation derived?"): answered that the notes don't cover it, without making anything up.

## Principles check

- **Markdown is the only source of truth**: conversations exist only in memory (like summaries) and are written neither to the vault nor to the DB.
- **Ollama is optional**: Q&A only calls Ollama from `src/main/llm/`; when offline, the UI shows why and disables the send button, and everything else works. When vectors are unavailable, retrieval falls back to full text + graph (reusing `retrieve`'s `vector: false`), and a note under the answer says semantic search is temporarily unavailable.
- **Only the main process accesses the DB and Ollama**: retrieval, building the context and calling the model all happen in main; the renderer only sends the question and receives streamed chunks.
- This phase has no actions that write notes (answers are only shown and can be copied).

## 1. Flow (`src/main/llm/ask.ts`)

`LlmService.ask(req)` returns a request id, and chunks are pushed through `llm:answer` (the same pattern as summaries):

1. **Time range**: if `req.from` / `req.to` are set, use them; otherwise `parseTimeRange(question, now)` parses one from the question (see section 2). The parsed range is pushed to the renderer with the first chunk for display.
2. **Retrieval query**: the question minus the time phrase (「上個月」 "last month" shouldn't be a keyword), plus the previous user question (a follow-up like 「那第二點呢？」 "and the second point?" has nothing to retrieve by itself). Vectors use only the current question.
3. **Retrieval**: reuse `retrieve()` with `limit = 8` and the time range.
   - If the question has only a time and nothing to retrieve (「上個月寫了什麼？」), or retrieval is empty but there is a time range: list the notes in the range instead (newest first, up to 8), taking each note's first chunk.
4. **Context**: take the full text of each note's most relevant chunk (the chunk containing `RetrieveHit.line`), then add one chunk before and after until the total reaches about `ASK_CONTEXT_MAX = 8000` characters; number them `[1]`…`[n]` by rank, with the title and date.
5. **Prompt**: answer only from the sources and mark citations with `[n]`; if the sources aren't enough, say so instead of making things up. The language follows the question (`detectLanguage`: the share of CJK characters), and in English the language instruction is repeated after the content (as learned from summaries). No examples other than `[n]` or `[[...]]`.
6. **Multiple turns**: include the last 3 rounds of Q&A (each message cut to 1000 characters) as conversation context only; sources are retrieved again each turn.
7. **Streaming and filtering**: `createCitationFilter(n)` removes out-of-range `[k]` (buffering like `createLinkFilter`: a chunk starting with `[` waits for `]` before deciding). At the end it reports the source numbers actually cited.

### Citation format: `[n]` rather than `[[title]]`

- `[n]` maps to a specific passage (path + line number), so clicking scrolls straight to it; `[[title]]` can only open the note.
- Small models copy `[1]` more reliably than a full title, and it doesn't break when titles clash or are long.
- `[[wikilinks]]` in the answer text (when the model quotes a note) are still filtered by the existing `createLinkFilter`, keeping only links that appear in the sources.

## 2. Time range parsing (`src/shared/timeRange.ts`, pure)

`parseTimeRange(text, now): { from, to, label, match: [start, end] } | null`, shared by main and renderer (the renderer shows the detected range live while typing). Dates always use the local time zone, inclusive at both ends, returned as `YYYY-MM-DD`.

| Phrase                                                                     | Range                         |
| -------------------------------------------------------------------------- | ----------------------------- |
| 今天, 昨天, 前天 / today, yesterday                                        | That day                      |
| 這週, 本週, 上週, 上上週 / this week, last week                            | Monday – Sunday               |
| 這個月, 本月, 上個月 / this month, last month                              | The whole month               |
| 今年, 去年 / this year, last year                                          | The whole year                |
| 最近／過去 N 天、週、個月 (N may be a Chinese numeral) / past/last N days… | N days back (including today) |
| `2026-09`, 2026 年 9 月, 9 月 (without a year, the most recent September)  | The whole month               |
| `2026-09-01` 到／至／~ `2026-09-15`, a single date                         | That range / that day         |
| 2026 年, 2026 (a year on its own, with 年 around it or after in/during)    | The whole year                |

- Only the first matching phrase is used. Weeks start on Monday.
- 「最近」 ("recently") on its own (without a number) isn't a time range, to avoid false matches.
- The panel shows a chip such as "2026-09-01 – 2026-09-30 ×"; clicking × cancels it (the next send carries `range: null`, meaning no filter), or the dates can be edited by hand.

## 3. Chat panel UI

Location: the **AI** tab in the right panel, with a "Chat / Summary" toggle at the top (preference in localStorage `knowmon.ai.mode`). The status line (connection, embedding progress) is shared by both.

- Message list: user questions and answers (reusing the `Markdown` component, with a new `citation` inline node: `[n]` renders as a superscript button that shows the source title and passage on hover).
- Under each answer, the sources are listed: number, title, date, passage snippet (`TextSegment[]`); cited sources come first, and uncited ones are collapsed under "other references". Clicking opens the note and scrolls to that line (reusing the jump from Hybrid search results); `Ctrl/Cmd+click` opens a new tab.
- Input: `Enter` sends, `Shift+Enter` adds a line break; generation can be stopped. The time range chip is shown above it.
- "New chat" clears the conversation. Conversations exist only in memory and are cleared when switching vaults.
- Answers can be copied (copying replaces `[n]` with `[[title]]`, so pasting into a note keeps working links).
- Shortcut: `Ctrl/Cmd+Shift+A` opens Chat in the right AI tab and focuses the input (update the README's "Shortcuts" too).

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  question: string
  /** Earlier Q&A (oldest → newest), used only as conversation context */
  history?: ChatTurn[]
  /**
   * Time range (YYYY-MM-DD, inclusive at both ends).
   * undefined = parse it from the question; null = the user removed the range, no filter.
   */
  range?: DateRange | null
}

export interface DateRange {
  from: string
  to: string
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

// Added to KnowmonAPI.llm:
/** Starts streaming an answer and returns a request id; chunks are pushed through onAnswer. Cancel with cancel(id) as before */
ask(req: AskRequest): Promise<string>
onAnswer(cb: (c: AnswerChunk) => void): () => void
```

`IPC` adds `llmAsk: 'llm:ask'` and `llmAnswer: 'llm:answer'`. No schema change is needed.

## Tests

- `shared/timeRange.test.ts`: every phrase in the table (Chinese and English, last month across a year boundary, the Monday boundary, Chinese numerals), sentences that shouldn't match (「最近在想」, "lately I've been thinking"), the `match` position.
- `llm/ask.test.ts`: context assembly (rank, length limit, adding neighboring chunks), removing the time phrase from the query, listing notes in the range when there's only a time, truncating multi-turn history, language detection; streaming, cancellation and offline errors with a fake chat.
- `createCitationFilter`: out-of-range `[k]`, `[1` + `2]` split across chunks, the `[1, 2]` / `[1][2]` forms, ordinary `[x]` text unaffected, reporting cited.
- `renderer/chat/conversation.test.ts`: the pure conversation state functions (send, apply chunks, stop, error, New chat).
- `renderer/chat/markdown.test.ts`: `[n]` parsed as a citation, not inside code.
- Integration test with `OLLAMA_IT=1`: ask 3 questions on test-vault (general, time range, nothing relevant), checking there are citations, citation numbers are valid, and nothing is made up when nothing is relevant.

## Not doing (left for later)

- Saving conversations or saving answers as notes (write actions wait for phase 7's confirmation flow).
- Rewriting follow-ups with the LLM (query rewriting): start with the simple "previous question + current question" approach and reconsider if testing shows it isn't enough.
