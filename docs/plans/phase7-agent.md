# Phase 7 implementation plan: Agent

Done when: it can run multi-step retrieval and organizing, and every write needs confirmation.

- [x] Read-only tools: `search_notes`, `get_note`, `get_neighbors`, `list_notes_in_range`
- [x] Multi-step execution with visible progress
- [x] Write tools (create a summary note, add tags) with a user confirmation flow

## Confirmed decisions (2026-10-18)

- The `types.ts` contract changes are approved (see "IPC contract changes" below).
- The Agent is a new mode of the AI tab (Chat / Agent / Summary), and Chat stays.
- Tags are written to `tags:` in the frontmatter.
- The confirmation card lets the user edit the proposal before Apply.

## Results and deviations from the plan (2026-10-18)

- `Vault` gained three methods (not part of the IPC contract): `create(path, content)` (creates with content, `wx`, never overwrites), `peek(path)` (reads a file without recording `open`, since the agent reading a note isn't the user opening it), and `update(path, f)` (read–modify–write inside the queue, then pushes `change`).
- `get_note` returns 2500 characters at a time (the plan said 3000), so it stays within `TOOL_RESULT_MAX` with the header.
- `createLinkFilter` gained a rule (which also applies to summaries and Q&A): links whose display text is a path or the same as the target, such as `[[title | folder/title.md]]`, become `[[title]]`.
- When a write fails (for example, someone created a note with the same name while confirmation was pending), the confirmation card keeps the proposal and shows the error.
- While waiting for confirmation, the status at the bottom of the sidebar shows "Agent: confirm a change", and clicking it opens the Agent directly.

### Testing (qwen3:8b, bge-m3, test-vault, `OLLAMA_IT=1`)

Ollama currently runs on **100% CPU** on this machine (`ollama ps`), generating about 4 tokens/s, so each task takes 1–4 minutes; it should be much faster with a GPU. Also, Ollama reloads the model when `num_ctx` changes (about 15 seconds), so the first call after switching between Chat (default context) and the Agent (16384) waits for an extra load; there's no reload between steps. 16384 is still needed: the tool definitions plus a few results exceed the default 4096, and beyond that Ollama cuts off the system prompt at the start.

The first round of testing found three problems, which were fixed and retested:

| Problem                                                                                     | Cause                                                                                     | Fix                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After the user clicked Reject, the model answered that it had created 「整理/比較.md」      | The tool result only said "the user rejected it"                                          | The result became `REJECTED: … it was NOT made …`, and the prompt explains what REJECTED means; on retest it answered that creating the note was rejected, so it wasn't done |
| Links in the answer were written `[[深度工作 \| 讀書筆記/深度工作.md]]`                     | The tools output "title \| path \| date", which the model copied as wikilink alias syntax | The output became "title (path: …, date: …)"; the prompt asks for only the title inside the brackets; the link filter removes path aliases                                   |
| The model added `period: "最近 7 天"` ("last 7 days") when the user hadn't mentioned a time | —                                                                                         | The parameter description and prompt now say "only use this when the user mentions a time"                                                                                   |

Results after the fixes (all three tasks pass):

1. 「2026-10-04 到 2026-10-06 之間寫了哪些筆記？它們各自連到哪些筆記？」 ("Which notes did I write between 2026-10-04 and 2026-10-06, and what does each link to?", 246 seconds): `list_notes_in_range` → one `get_neighbors` for each of the three notes; every link in the answer exists. The small model also describes time and semantic edges as "linked from … to this note", so it doesn't distinguish types precisely.
2. 「把「原子習慣」和「深度工作」整理成一篇比較筆記，存在「整理」資料夾」 ("Write a note comparing Atomic Habits and Deep Work and save it in the 整理 folder"): `search_notes` → two `get_note` → a `create_note` proposal. With Reject nothing was written and the answer said it wasn't done (168 seconds); with Apply, `整理/比較.md` was created with the proposed content (163 seconds).
3. 「幫 2026-10-04 這篇日記加上「回顧」標籤」 ("Add the 回顧 tag to the 2026-10-04 journal entry", 74 seconds): it first used a nonexistent path, 「2026-10-04 日記」 → the error went back to the model → it found the right path with `search_notes` → `add_tags` → after Apply the frontmatter was correct.

### Performance tuning (2026-10-19)

The user reported that simple tasks took nearly 10 minutes and maxed out the laptop. Measured with qwen3:8b on this machine (Core Ultra 5 125H, 14 GB, 100% CPU): reading the prompt runs at only about 17 tokens/s and generation at about 5 tokens/s; Chinese is about one token per character, so most of the time goes into reading tool results, not generating. Also found: without `num_ctx`, Ollama uses 4096 (confirmed with `ollama ps`), so switching between summaries/Q&A (4096) and the agent (16384) reloads the model; and replacing old results with a one-line note when over budget rewrites earlier messages, which invalidates Ollama's prompt cache and makes it read everything again.

| Item                  | Before                                                | After                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool call limit       | 8                                                     | 5 (the prompt also says calls are limited and to answer directly once the snippets suffice)                                                                                      |
| Each result           | 3000 characters                                       | 1500 characters                                                                                                                                                                  |
| Total results         | 16000 characters, rewriting old results when exceeded | A 6000-character budget; new results are cut to the remaining budget (at least 300 characters), and tools stop being offered once it's used up; old messages are never rewritten |
| `get_note` page       | 2500 characters                                       | 1200 characters                                                                                                                                                                  |
| `search_notes`        | Default 8, max 20 notes                               | Default 5, max 10 notes, 80-character snippets                                                                                                                                   |
| `list_notes_in_range` | Default 20, max 30 notes                              | Default 10, max 15 notes, 80-character snippets                                                                                                                                  |
| Earlier tasks         | 6 messages × 1000 characters                          | 4 messages × 600 characters                                                                                                                                                      |
| `num_ctx`             | Agent 16384, summaries/Q&A 4096                       | 8192 for all (`CHAT_NUM_CTX`), no reload when switching                                                                                                                          |

Retest (same machine, same tasks, `OLLAMA_IT=1`): all four tasks pass, and the total time went from 651 to 410 seconds (about −37%):

| Task                                | Before | After | Steps                                           |
| ----------------------------------- | ------ | ----- | ----------------------------------------------- |
| Notes and links from 10-04 to 10-06 | 246 s  | 155 s | `list_notes_in_range` → 3 × `get_neighbors`     |
| Comparison note (Reject)            | 168 s  | 110 s | `search_notes` → 2 × `get_note` → `create_note` |
| Comparison note (Apply)             | 163 s  | 99 s  | Same as above, content matching the proposal    |
| Add the 回顧 tag                    | 74 s   | 46 s  | Wrong path → `search_notes` → `add_tags`        |

Not done: letting the agent use a separate model (requires changing `src/shared/types.ts`), retrieving in advance. The single-pass summary limit of 12000 characters can exceed 8192 tokens in Chinese; the split threshold can be adjusted later. Switching to a GPU (Ollama's Vulkan support covers Intel Arc) or a smaller model (such as `qwen3:4b`) needs no code change and may help more.

## Environment checks (2026-10-18)

- `qwen3:8b` on Ollama 0.35.1 has `tools` in its capabilities. When `/api/chat` is called with `tools`, `think: false` and `stream: true`, tool calls arrive all at once in the stream's `message.tool_calls` (with `arguments` already an object).
- Testing "find last week's notes about deep work, then see what they link to": the model correctly called `search_notes({ query: "深度工作", from: "2026-10-11" })`, but only gave `from` without `to`, and got the date wrong by a day (last Monday was 10-12). **Date arithmetic isn't left to the model**: tools accept natural-language time phrases, parsed by `parseTimeRange` (see section 2).

## Principles check

- **The agent is read-only by default**: the four read-only tools run directly; write tools only produce a "proposal", previewed in the renderer, and main writes only after the user clicks "Apply". Rejecting, cancelling or timing out writes nothing.
- **Markdown is the only source of truth**: writes always go through `Vault.write` (recording an `edit` event and updating the index), the same as the user saving in the editor; conversations and execution progress exist only in memory.
- **The file system and DB only in main**: tools run in main; the renderer only sends the task, receives events and answers confirmations.
- **Ollama is optional**: when offline, sending is disabled in the Agent tab and everything else works.

## 1. Architecture

```
renderer                              main (src/main/llm/agent/)
  llm.agent({ task, history }) ──────▶ runAgent(): loop
                                         chat(messages, tools) ── Ollama
                                         ├ tool_calls → run read-only tools → add results to messages
                                         │            └ write tools → create a proposal, wait for confirmation
  onAgent(chunk) ◀──── step / confirm / delta / done
  llm.confirm(id, step, approved, edited?) ─▶ apply or reject, return the result to the model, continue the loop
```

- `src/main/llm/agent/loop.ts`: `runAgent(chat, tools, messages, emit, confirm, signal)`, pure logic with chat, tools and confirmation all injectable for testing.
- `src/main/llm/agent/tools.ts`: tool definitions (JSON schema, descriptions) and implementations; the input is a `Vault`, and each returns text for the model plus a summary for the UI.
- `src/main/llm/agent/tags.ts`: the pure function `addTags(content, tags)` (section 4).
- `ollama.ts`: `chat` gains a `tools` option and returns `{ content, toolCalls }`; `ChatMessage` gains the `tool` role and `tool_calls` (client-internal types, not in `types.ts`). When a model doesn't support tools (Ollama returns `does not support tools`), report a clear error: "The current chat model doesn't support tool calling; switch to a model such as qwen3 in Settings".
- `LlmService.agent(req)` / `confirm(...)`, reusing `requests` / `cancel` for request ids and cancellation.

### Loop rules

- Each step: send the messages + tool list → the model replies with text (streamed to the UI) or tool calls → run them → add the results back with `role: 'tool'` → next step.
- At most `AGENT_MAX_STEPS = 8` tool calls; at the limit, the last call is sent without `tools`, asking the model to answer from the results so far.
- Multiple tool calls in one reply run in order (write tools handle one confirmation at a time).
- A repeated call to the same tool with the same arguments directly returns "already checked, same result as above", so small models don't go in circles.
- Invalid arguments or a missing note return the error message as the tool result (so the model can correct itself) without aborting the task.
- Context: each tool result is cut to `TOOL_RESULT_MAX = 3000` characters; when all results together exceed `AGENT_CONTEXT_MAX = 16000` characters, older results are replaced with a one-line summary. Agent requests send `options.num_ctx = 16384` (qwen3:8b supports 40K; the default is too small and gets truncated after several steps). (Tuned 2026-10-19, see "Performance tuning" above.)
- System prompt: today's date and weekday, tool usage guidelines (search before reading full text, cite notes as `[[title]]`, settle the content before writing), and the language follows the task (reusing `detectLanguage`). No `[[...]]` examples (as learned from summaries).
- The final answer is filtered by `createLinkFilter`: only note titles and links that appeared in tool results are kept.

## 2. Tools

The model gets compact plain text (not JSON, which small models read less reliably), one line per note starting with "title | path | date". Path arguments accept either a path or a title (using the resolution rules in `src/shared/links.ts`, the same as wikilinks).

| Tool                  | Arguments                                                                                                    | Implementation                                                                                                                              | Returns                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `search_notes`        | `query`, `period?` (a time phrase such as 「上週」 "last week" or 「2026-09」), `limit?` (default 8, max 20) | `retrieve` (keyword OR + vectors + graph neighbors), with `period` parsed by `parseTimeRange`                                               | Per note: title, path, date, the most relevant passage (about 200 characters)                                               |
| `get_note`            | `path`                                                                                                       | `getNoteBody` + `tags` from the frontmatter                                                                                                 | Title, path, date, tags, body (truncated with a note beyond 3000 characters; read further with `offset`)                    |
| `get_neighbors`       | `path`, `types?` (default all)                                                                               | After `Vault.graph()` (so time/semantic edges are current), take that note's edges; outgoing wikilinks include targets that don't exist yet | Grouped by type: outgoing links, backlinks, same session, same day, previous/next note, semantically similar (with weights) |
| `list_notes_in_range` | `period`, or `from` + `to`                                                                                   | Reuses `notesInRange` from `ask.ts`, up to 30 notes                                                                                         | Newest first, with each note's title, path, date and first line                                                             |
| `create_note` ✎       | `path`, `content`                                                                                            | Proposal → confirmation → `Vault.write`                                                                                                     | "Created / the user rejected it"                                                                                            |
| `add_tags` ✎          | `path`, `tags[]`                                                                                             | Proposal → confirmation → `addTags` → `Vault.write`                                                                                         | "Added / already there / the user rejected it"                                                                              |

- When `period` can't be parsed, return an error explaining the supported phrasings, so the model switches to `from`/`to`.
- ✎ = write tool.

## 3. Confirmation flow

1. The model calls a write tool → main checks the arguments and creates a proposal:
   - `create_note`: normalize the path (append `.md`, reject folders starting with `.` and `..`); **never overwrite an existing note**, returning an error so the model picks another name. `[[x]]` links in the content pointing to missing notes are marked in the preview (not changed automatically).
   - `add_tags`: read the current file and compute the content with the tags added; if every tag already exists, answer "already there" directly without asking.
2. Main pushes a `confirm` event (with the proposal) and the loop pauses. The UI shows a confirmation card in that step:
   - `create_note`: the path (editable) and content (an editable text box with the raw Markdown).
   - `add_tags`: the note title, the tags to add (individual tags can be removed), and a before/after of the frontmatter.
   - Buttons: **Apply** / **Reject**.
3. The user's answer → `llm.confirm(id, step, approved, edited?)`:
   - Apply: main writes the (possibly edited) proposal. `add_tags` rereads the file at write time and applies `addTags` to that, not the content from when the proposal was made, so edits the user made in the meantime aren't overwritten. After writing it pushes `vault:changed`, and a tab with that note open handles it like any external change (reload if there's no unsaved content, otherwise show a bar).
   - Reject: the tool result says "the user rejected this action", and the model continues (usually finishing or proposing something else).
   - Stopping the task, switching vaults or closing the app: a pending proposal counts as rejected and nothing is written.
4. After completion, the confirmation card keeps the outcome (applied: the note can be clicked to open; rejected: grey).

## 4. Tag format (`addTags`, pure function)

Tags are written to `tags:` in the frontmatter (the style used in test-vault):

- No frontmatter: add `---\ntags: [a, b]\n---\n` at the top of the file.
- `tags: [a, b]` (flow): add the new tags before `]`, keeping the existing order and formatting.
- A block list of `- a` under `tags:`: add new lines with the same indentation after the last item.
- `tags: a` (a single string): rewrite as `tags: [a, b]`.
- Frontmatter without `tags`: add a line before the closing `---`.
- Only the `tags` lines change, and the rest of the frontmatter is untouched (no re-serializing with gray-matter, which would alter the user's formatting and comments).
- Tag normalization: strip a leading `#` and surrounding whitespace; existing tags are compared case-insensitively (NFC). Tags containing YAML special characters (`,` `[` `]` `:` `#` and so on) are quoted.
- Corrupt frontmatter (YAML fails to parse): refuse to modify it and return an error.

## 5. UI

The top of the right AI tab becomes three segments: **Chat / Agent / Summary** (`knowmon.ai.mode` gains `agent`). Chat (RAG) stays: it's a single model call, much faster than the agent, and enough for ordinary questions.

- A task input (`Enter` sends, `Shift+Enter` adds a line break, Enter during IME composition doesn't send); it can be stopped while running, and "New task" clears it.
- Each task shows a list of steps: a tool icon plus a one-line description (for example 「搜尋：深度工作（2026-10-12 – 2026-10-18）→ 5 篇」, "Search: 深度工作 (2026-10-12 – 2026-10-18) → 5 notes"); expanding shows the arguments and a summary of the result, and notes in the result can be clicked to open (`Ctrl/Cmd+click` for a new tab). Running steps show a spinner.
- Text from the model between tool calls ("let me search first…") is shown faded between steps; the final answer is rendered by the `Markdown` component, with clickable wikilinks.
- The confirmation card is described in section 3; while waiting for confirmation, the task input is disabled and a reminder dot appears next to the tab title (visible even with the right panel closed: the AI status at the bottom of the sidebar shows "waiting for confirmation").
- Multiple turns: the same task thread can take follow-up instructions ("turn what you just found into a note"), including the last 3 rounds of tasks and final answers (not the tool steps), as in Chat.
- State is the pure module `renderer/chat/agentRun.ts` (the same pattern as `conversation.ts`), kept only in memory and cleared when switching vaults.
- Shortcut: `Ctrl/Cmd+Shift+G` opens the Agent and focuses the input (update the README's "Shortcuts" too).

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export type AgentToolName =
  | 'search_notes'
  | 'get_note'
  | 'get_neighbors'
  | 'list_notes_in_range'
  | 'create_note'
  | 'add_tags'

export interface AgentRequest {
  task: string
  /** Earlier tasks and final answers (oldest → newest), used only as context */
  history?: ChatTurn[]
}

/** A write tool's proposal, waiting for the user's confirmation */
export type AgentProposal =
  | { kind: 'create_note'; path: string; content: string; missingLinks: string[] }
  | { kind: 'add_tags'; path: string; title: string; tags: string[]; before: string; after: string }

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
  /** Present when status = 'confirm' */
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
  /** The proposal as edited by the user (only path / content / tags can change) */
  edited?: AgentProposal
}

// Added to KnowmonAPI.llm:
/** Starts a task and returns a request id; progress is pushed through onAgent. Cancel with cancel(id) as before */
agent(req: AgentRequest): Promise<string>
onAgent(cb: (c: AgentChunk) => void): () => void
/** Answers a write proposal */
confirm(id: string, step: number, decision: AgentDecision): Promise<void>
```

`IPC` adds `llmAgent: 'llm:agent'`, `llmAgentChunk: 'llm:agentChunk'` and `llmConfirm: 'llm:confirm'`. No schema change and no new dependencies are needed.

## Tests

- `agent/tags.test.ts`: every frontmatter form in section 4, CRLF, duplicate tags (case, `#` prefix), quoting special characters, refusing corrupt YAML, changing only the tags lines.
- `agent/tools.test.ts` (with a copy of test-vault): each tool's output format, title/path resolution, `period` parsing and errors, truncation and `offset`, each type in `get_neighbors`, `create_note` path checks (`.md`, dot folders, `..`, already exists).
- `agent/loop.test.ts` (a fake chat returning tool calls in order): multiple steps, forcing an answer after the step limit, repeated calls, tool errors returned to the model, nothing written on Apply/Reject/cancel as appropriate, rereading the file on Apply (when it changed while waiting), user-edited proposals, summarizing old results when the context exceeds the limit, link filtering of the final answer.
- `ollama.test.ts`: the `tools` parameter, parsing `tool_calls` from the stream, the error when tools aren't supported.
- `service.test.ts`: the event order of `agent` / `confirm` / `cancel`, offline errors.
- `renderer/chat/agentRun.test.ts`: step updates (replacing the same index), confirmation state, stopping, multi-turn history.
- `OLLAMA_IT=1` integration tests (with a copy of test-vault):
  1. 「上週寫了哪些跟習慣有關的筆記？各自連到哪些筆記？」 ("Which notes about habits did I write last week, and what does each link to?") → calls at least `search_notes`/`list_notes_in_range` and `get_neighbors`, and every link in the answer exists.
  2. 「把原子習慣和深度工作整理成一篇比較筆記」 ("Write a note comparing Atomic Habits and Deep Work") → a `create_note` proposal; when the test answers Reject the file doesn't exist, and when it answers Apply the file exists with the proposed content.
  3. 「幫日記加上 #回顧 標籤」 ("Add the #回顧 tag to the journal entry") → an `add_tags` proposal, with correct frontmatter after Apply.

## Not doing (left for later)

- Tools that delete, rename or modify the body of existing notes (high risk, and hard to present in a confirmation card).
- An option to run automatically (skipping confirmation).
- Saving task history; saving a Chat answer as a note in one click (possible by telling the Agent "save this as a note").
- A tag index (tags currently live only in the frontmatter, and search relies on full text).
