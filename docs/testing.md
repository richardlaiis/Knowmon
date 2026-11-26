# Testing

For developers: automated tests, the manual test checklist and a few debugging commands. For installing and running, see the [README](../README.md).

## Automated tests

```bash
npx vitest run       # unit and integration tests
npm run typecheck    # type check (two projects: main/preload and renderer)
npm run lint         # ESLint + Prettier checks
```

Note: `npx tsc --noEmit` at the repository root checks no files (the root tsconfig only has project references). Use `npm run typecheck`.

Test files sit next to the files they test (`*.test.ts`). The main ones:

- `src/main/vault/vault.test.ts`: create, rename, delete, external changes (reconcile), event throttling, rebuilding from `events.jsonl` after the DB is deleted, chokidar watching
- `src/main/db/*.test.ts`: schema, queries, log replay
- `src/main/vault/paths.test.ts`, `tree.test.ts`: path safety checks, the file tree
- `src/renderer/editor/livePreview.test.ts`: live Markdown rendering (which marks are hidden, raw syntax shown near the cursor, frontmatter, task toggling)
- `src/renderer/editor/tables.test.ts`: table rendering (alignment, column count, `\|`, inline styles and wikilinks in cells, expanding when the cursor enters, rendering only top-level tables)
- `src/renderer/editor/mathSyntax.test.ts`, `math.test.ts`: math syntax (currency, escapes, code precedence, blocks in quotes/lists, unclosed blocks) and its decorations (inline widgets, block widgets, preview while editing, nested blocks)
- `src/renderer/src/lib/theme.test.ts`: theme switching and persistence
- `src/renderer/editor/autosave.test.ts`, `src/renderer/src/lib/tree.test.ts`: autosave, file tree path helpers (including drag and drop)
- `src/main/indexer/timeLinks.test.ts`, `src/main/db/time.test.ts`, `src/main/vault/time.test.ts`: deriving time edges (same_session, same_day, sequence), when they are recomputed, reading and writing the time settings, DB rebuilds
- `src/shared/time.test.ts`, `src/renderer/graph/timeFilter.test.ts`, `src/renderer/timeline/model.test.ts`: session splitting, graph time filtering, timeline grouping
- `src/shared/timeRange.test.ts`, `src/renderer/chat/conversation.test.ts`: parsing time ranges from questions (「上個月」 "last month", 「最近 7 天」 "last 7 days", "last week"), conversation state
- `src/main/indexer/chunk.test.ts`, `src/main/db/vectors.test.ts`: chunking, the vector tables (sqlite-vec), semantic edges and performance at 1000 notes
- `src/main/llm/*.test.ts`: Ollama client (fake fetch), background embedding, hybrid retrieval, summaries, Q&A (keywords, context assembly, citation filtering). `service.test.ts` uses a real Vault with a fake Ollama to test going offline, missing models, switching models, and cloud mode (no key, no retry on a bad key, chat still working while Ollama is offline). `openai.test.ts`: the OpenAI-compatible client (SSE, tool call arguments split across chunks, ids and thought signatures, error classification, output limit parameter names and resending). `secrets.test.ts`: encrypted API key storage. `budget.test.ts`: character budgets scaled by the context length (equal to the original constants at 8192)

Integration tests against a real Ollama are skipped by default. Run them when needed:

```bash
OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts
# With a chat model other than qwen3:8b:
OLLAMA_IT=1 OLLAMA_CHAT_MODEL=qwen3.5:2b npx vitest run src/main/llm/ollama.integration.test.ts
```

Integration tests for cloud providers (each enabled separately; you need your own API key):

```bash
OPENAI_IT=1 OPENAI_API_KEY=sk-… OPENAI_MODEL=<model> npx vitest run src/main/llm/openai.integration.test.ts
GEMINI_IT=1 GEMINI_API_KEY=… GEMINI_MODEL=<model> npx vitest run src/main/llm/openai.integration.test.ts
# No account needed: use Ollama's own OpenAI-compatible endpoint as the custom provider
CUSTOM_IT=1 CUSTOM_BASE_URL=http://127.0.0.1:11434/v1 CUSTOM_API_KEY=x CUSTOM_MODEL=qwen3:8b \
  npx vitest run src/main/llm/openai.integration.test.ts
```

The Agent test runs two or more tool-call steps: Gemini 3 returns 400 on the second step if the thought signature isn't sent back.

Time limits in the performance tests (time edges, the graph and semantic edges at 1000 notes) are wrapped in `perfBudget` (`src/main/db/test-utils.ts`): locally they check the design targets, and on CI (when the `CI` environment variable is set) they are relaxed 10×, because GitHub Actions' shared machines are slow and inconsistent. The per-test timeout (`testTimeout` in `vitest.config.ts`) is also raised from 5 to 60 seconds on CI. To simulate CI locally, run `CI=1 npx vitest run`.

New features must come with tests, and all three commands above must pass before finishing.

## Manual tests

First copy the test vault. **Put it under your home directory, not in `/tmp`**: `/tmp` has no system trash, so deleting notes there fails.

```bash
cp -r test-vault ~/knowmon-test-vault
npm run dev
```

The test vault is about seven weeks of one person's notes: `Welcome`, a `Journal/` folder (2026-10-05 to 2026-11-25), `Books/` (Atomic Habits, Deep Work and two more), `Projects/` (Knowmon and a half marathon), `Meetings/`, `Cooking/`, `Inbox/`, `Reference/Markdown showcase` (every syntax the editor renders) and a small Chinese folder, `中文/`, for the Chinese features. Chinese inputs in the tables below are meant to be typed as written.

| #   | Action                                                                                                                                             | Expected result                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Click "Open folder" and choose `~/knowmon-test-vault`                                                                                              | The file tree appears on the left, with folders first                                                                                                                                                                                                                                                                      |
| 2   | Click "Welcome", type a few characters, wait about 1 second                                                                                        | `cat ~/knowmon-test-vault/Welcome.md` shows the new content                                                                                                                                                                                                                                                                |
| 3   | Press `Ctrl+S`                                                                                                                                     | Saves immediately                                                                                                                                                                                                                                                                                                          |
| 4   | Click the new note / new folder icons at the top of the sidebar, or right-click in the file tree                                                   | A name field appears in the file tree; the item is created only after typing a name and pressing Enter (notes open in a new tab); Esc or an empty name cancels and leaves no file                                                                                                                                          |
| 5   | Right-click → "Rename"                                                                                                                             | The file on disk is renamed too; an open note isn't closed                                                                                                                                                                                                                                                                 |
| 6   | Drag a note or folder onto another folder, onto a note, or onto empty space in the file tree                                                       | It moves into the target folder (empty space moves it to the root); hovering over a collapsed folder for about 0.6 seconds expands it                                                                                                                                                                                      |
| 7   | Right-click → "Delete"                                                                                                                             | A confirmation dialog appears and the file goes to the system trash                                                                                                                                                                                                                                                        |
| 8   | With "Welcome" open, run `echo '# Changed outside' > ~/knowmon-test-vault/Welcome.md` in a terminal                                                | The editor switches to the new content automatically                                                                                                                                                                                                                                                                       |
| 9   | Do step 8 within 0.5 seconds of typing                                                                                                             | A bar appears offering "Load external version" or "Keep my version"                                                                                                                                                                                                                                                        |
| 10  | Create, `rm` and `mv` notes in a terminal                                                                                                          | The file tree updates automatically                                                                                                                                                                                                                                                                                        |
| 11  | Open `Reference/Markdown showcase` (headings, bold, links, lists, `- [ ]` tasks)                                                                   | Marks are hidden and the rendered result is shown; moving the cursor into bold text or a link shows the raw syntax; clicking a checkbox toggles it and saves; `Ctrl+E` toggles source mode                                                                                                                                 |
| 12  | Click the moon/sun icon at the top of the sidebar (or the top right of the welcome screen)                                                         | Switches between the off-white light theme and the dark theme, code colors included; the choice is kept after restarting the app                                                                                                                                                                                           |
| 13  | Press `Ctrl+Shift+F` and search for `deep work`, `習慣`, `專注` and `中英混合 Hybrid` in turn                                                      | English is case-insensitive; two-character Chinese words and mixed Chinese/English match the notes in `中文/`; title matches rank first, and snippets highlight the matched text                                                                                                                                           |
| 14  | Open "Deep Work" and look at the Backlinks panel on the right                                                                                      | Lists "2026-10-05", "Atomic Habits", "Markdown showcase", "Thinking in Systems" and "Welcome" with the line containing each link; the "Backlinks" button in the title bar collapses it                                                                                                                                     |
| 15  | Type `[[Atom` in the editor; then type `[[Ideas`                                                                                                   | A completion menu appears (showing each note's folder); Enter inserts `[[Atomic Habits]]` without an extra `]]`. For `Ideas` both notes are listed; choosing the Half marathon one inserts `[[Half marathon/Ideas]]`                                                                                                       |
| 16  | `Ctrl+click` `[[Atomic Habits]]` in Deep Work; then `Ctrl+click` `[[A note that doesn't exist yet]]` in `Inbox/Questions to explore`               | The first opens that note; the second creates a new note at the vault root, whose Backlinks list "Questions to explore"                                                                                                                                                                                                    |
| 17  | Press `Ctrl+O`, type `deep` and press Enter                                                                                                        | Opens "Deep Work"; with no input, recently opened notes come first                                                                                                                                                                                                                                                         |
| 18  | Press `Ctrl+G` (or "Graph" in the sidebar)                                                                                                         | The main area shows the global graph; the wheel zooms, dragging the background pans, nodes can be dragged; hovering highlights the note and its neighbors; clicking a node switches back to the editor and opens it                                                                                                        |
| 19  | Switch the right panel to "Local graph" and change Depth between 1 and 3                                                                           | Only the current note and its neighbors are shown, with the current note in the accent color; it updates when you switch notes                                                                                                                                                                                             |
| 20  | Toggle dark mode                                                                                                                                   | Graph colors change too                                                                                                                                                                                                                                                                                                    |
| 21  | Take a screenshot and press `Ctrl+V` in a note; or drag an image from the file manager into the editor                                             | The image is saved to `<vault>/attachments/` (screenshots are named `Pasted image <time>.png`, dragged files keep their names, with a number added on a clash), `![](relative path)` is inserted and the image is shown; moving the cursor onto that line shows the raw syntax                                             |
| 22  | Write `![](missing.png)` and `![](https://…/a.png)` by hand                                                                                        | The first shows a red "Image not found"; URLs and absolute paths aren't rendered (only paths relative to the note are supported). The logo in `Reference/Markdown showcase` renders                                                                                                                                        |
| 23  | Write a table with alignment, bold, `code`, a `[[wikilink]]` and `\|`, plus a very wide table                                                      | With the cursor outside, it renders as a table (correct alignment; the wide table scrolls horizontally, and dragging the scrollbar doesn't expand it); clicking a cell turns the whole table back into source with the cursor in that cell; `Ctrl+click` on a wikilink/link in a cell opens it; not rendered with `Ctrl+E` |
| 23a | Write `$E=mc^2$`, `It costs $5 and $10`, a `$$ … $$` block (also one with an error such as `\frac{1}`), one in a `>` quote and one in a table cell | Formulas render when the cursor is elsewhere; the prices stay text; inside a block the source shows with a preview below; the error shows the red TeX with the message on hover; `Ctrl+E` shows source; dark theme readable. Ask the AI for a formula: `\[ … \]` renders too                                               |

### Tabs and panels

| #   | Action                                                                                                                     | Expected result                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 24  | Click a note in the file tree, then another                                                                                | The second replaces the current tab                                                                                             |
| 25  | `Ctrl+click` (or middle-click) another note                                                                                | Opens in a new tab; clicking a note that's already open switches to it instead of opening it twice                              |
| 26  | Type in one tab, switch to another tab and back, press `Ctrl+Z`                                                            | Content and undo history are both kept                                                                                          |
| 27  | `Ctrl+G`, `Ctrl+Tab`, `Ctrl+W`, `Ctrl+T`                                                                                   | Opens the graph tab (only ever one), switches tabs, closes only the tab (not the window), opens the Quick switcher in a new tab |
| 28  | Drag a tab; right-click a tab                                                                                              | Reorders tabs; right-click offers "Close / Close others"                                                                        |
| 29  | Drag the dividers between the file tree and the editor, and between the editor and the right panel; double-click a divider | Resizes; double-clicking restores the default                                                                                   |
| 30  | `Ctrl+B`, `Ctrl+Alt+B`, or the buttons at both ends of the tab bar                                                         | Toggles the left sidebar and the right panel                                                                                    |
| 31  | Close the app and reopen the same vault                                                                                    | Tabs, panel widths and open/closed state are restored                                                                           |

### Time layer

For the two kinds of time, the rules for each time edge and what the graph filters mean, see [`time-layer.md`](time-layer.md).

Time edges need editing history. A freshly copied vault has just one `create` per note, so first edit a few notes in the app (notes edited within the same stretch of time get linked), or adjust the settings below.

| #   | Action                                                                                                       | Expected result                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | Edit "Atomic Habits" and then "Deep Work" (less than 30 minutes apart), press `Ctrl+G`                       | A Session edge (orange dashed line) appears between them; the notes in `Journal/` are chained by Sequence edges (solid lines); "2026-10-14" and "2026-10-14 Design review" have a Same day edge |
| 33  | Click Links / Session / Same day / Sequence in the graph toolbar                                             | Edges of that type show or hide and the layout adjusts slightly; the choice is kept after restarting the app                                                                                    |
| 34  | Drag the graph's time slider, uncheck "Undated", switch "Event date / Written"                               | Notes outside the range disappear while other nodes stay put; the toolbar shows "N of M notes"; "Reset" restores everything                                                                     |
| 35  | Press `Ctrl+Shift+T` (or "Timeline" in the sidebar)                                                          | Opens the timeline tab: "Event date" lists dated notes by date; "Written" lists sessions by day (time range and edited notes, with new ones marked new)                                         |
| 36  | Click a bar at the top of the timeline, click a note, `Ctrl+click` a note                                    | Scrolls to that month; opens in the current tab; opens in a new tab                                                                                                                             |
| 37  | Click "Settings" in the timeline or graph toolbar, set Session gap to 5 and Same-day window to 1, click Save | `cat ~/knowmon-test-vault/.knowmon/settings.json` shows the new values; the graph has fewer Session edges and gains Same day edges between journal notes; timeline sessions get shorter         |
| 38  | Switch the right panel to "Local graph" and toggle edge types                                                | The local graph only follows the selected types to find neighbors                                                                                                                               |

### AI (phase 5)

Needs Ollama with `bge-m3` and `qwen3:8b` (`ollama pull bge-m3`, `ollama pull qwen3:8b`). After opening a vault, the bottom of the sidebar shows "Indexing N/M", which becomes "AI ready" when background embedding finishes (under a minute for test-vault on a CPU).

| #   | Action                                                                                                    | Expected result                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 39  | Open "Deep Work" and press `Ctrl+Shift+S` (or "Summarize" above the note)                                 | The right panel switches to "AI" and streams a bullet-point summary, in Traditional Chinese by default (about 15–30 seconds); `[[Atomic Habits]]` is clickable; Stop, Copy and Regenerate work          |
| 40  | Select some text, then press `Ctrl+Shift+S`                                                               | The title shows "Selection in …" and only the selection is summarized                                                                                                                                   |
| 41  | Switch search to "Hybrid", type `how to build better habits` and press Enter; then try `培養好習慣的方法` | Atomic Habits comes first even without identical wording, labeled meaning (vector), text (full text) or linked (graph neighbor); the Chinese query finds both Atomic Habits and `中文/原子習慣讀書心得` |
| 42  | Click a Hybrid result                                                                                     | Opens the note and scrolls to the most relevant passage                                                                                                                                                 |
| 43  | Set a date range for Hybrid and press Enter                                                               | Lists only notes whose event date (or last modified date when there is none) is in range                                                                                                                |
| 44  | `Ctrl+G`, toggle "Semantic" in the toolbar                                                                | Magenta Semantic edges link notes with similar content; "Settings" adjusts the similarity threshold and the per-note limit                                                                              |
| 45  | Stop Ollama (`systemctl stop ollama` or close `ollama serve`)                                             | The sidebar shows "AI offline" and the AI tab shows why; search, the graph and editing work as usual; Hybrid falls back to keyword results with a notice                                                |
| 46  | Start Ollama again                                                                                        | Recovers automatically within 30 seconds (or click "Retry" in the AI tab)                                                                                                                               |
| 47  | Click "Settings" in the AI tab                                                                            | The Ollama address and models can be changed; changing the embedding model re-indexes every note                                                                                                        |
| 48  | Switch the AI tab to "EN" and click Regenerate                                                            | Summarizes in English bullets; links such as `[[Atomic Habits]]` stay clickable; switching back to 「中文」 restores Traditional Chinese; the choice is remembered after restarting the app             |
| 49  | When a summary has bold, lists or code                                                                    | Shown formatted (not raw Markdown symbols); incomplete syntax mid-stream is shown as text first                                                                                                         |
| 50  | Summarize a note without any `[[links]]`                                                                  | The summary has no clickable links and no `[[`; for notes with links, only links from the original appear                                                                                               |

### Q&A (phase 6)

Also needs Ollama. Switch between "Chat / Agent / Summary" at the top of the AI tab; `Ctrl+Shift+A` opens the chat directly.

| #   | Action                                                                                           | Expected result                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 51  | `Ctrl+Shift+A`, type `What are the key ideas of Deep Work?` and press Enter                      | Shows "Searching notes…", then streams an answer in English; sentences end with superscript citation numbers, and the cited sources (Deep Work first) are listed below                                             |
| 52  | Click a citation number in the answer or a source below                                          | Opens that note and scrolls to the cited passage; `Ctrl+click` opens it in a new tab                                                                                                                               |
| 53  | Type `What did I do from 2026-10-14 to 2026-10-21?`                                              | While typing, "2026-10-14 – 2026-10-21" appears above the input; the answer shows "Notes from …" and the sources are only notes dated in that range (journal entries, the design review, The Pragmatic Programmer) |
| 54  | Type `What did I write last week?`, click × next to the range, then send                         | The range becomes a struck-through "No date filter", and the question is sent without a date filter                                                                                                                |
| 55  | Click "Date range…", pick dates, then send                                                       | Answers using only notes in that range; after sending, the range goes back to automatic detection                                                                                                                  |
| 56  | Follow up with `What about attention residue?`                                                   | Answers on the same topic as the previous question (conversation context)                                                                                                                                          |
| 57  | Ask `2026-11-16 到 2026-11-22 跑了幾公里？` ("How far did I run from 2026-11-16 to 2026-11-22?") | Answers in Traditional Chinese, citing 「跑步紀錄」 (14 km)                                                                                                                                                        |
| 58  | Ask something the notes don't cover (for example `How is the Schrödinger equation derived?`)     | Answers that the notes don't cover it, without making things up; any sources found are tucked under "sources searched"                                                                                             |
| 59  | Click "Copy" on an answer and paste into a note                                                  | Citation numbers become `[[source title]]` links                                                                                                                                                                   |
| 60  | Click "Stop" mid-answer; click "New chat"                                                        | Stops and shows "Stopped."; clears the conversation. Switching vaults also clears it                                                                                                                               |
| 61  | With Ollama stopped                                                                              | The input shows "AI is offline (see the status above)" and the Ask button is disabled                                                                                                                              |

### Agent (phase 7)

Also needs Ollama. Switch the AI tab to "Agent", or press `Ctrl+Shift+G`. Each task takes about 1–4 minutes (CPU only; much faster with a GPU).

| #   | Action                                                                                                            | Expected result                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 62  | `Ctrl+Shift+G`, type `Which notes did I write from 2026-11-02 to 2026-11-09, and what does each of them link to?` | Steps appear in order (spinner → ✓): "Notes from 2026-11-02 – 2026-11-09 → 3 notes" and "Connections of …" for each; links in the final answer are clickable                                                                       |
| 63  | Expand a step                                                                                                     | Shows the tool arguments and the notes in the result; clicking a note opens it, `Ctrl+click` opens it in a new tab                                                                                                                 |
| 64  | Type `Write a note comparing the key ideas of Atomic Habits and Deep Work, and save it in the Summaries folder`   | After reading both notes, a confirmation card appears with an editable path and content; links to missing notes are marked. The Agent button, the AI tab and the bottom of the sidebar show a reminder ("Agent: confirm a change") |
| 65  | Click "Reject"                                                                                                    | The step is struck through (✕) and no file is created; the answer explains it wasn't done                                                                                                                                          |
| 66  | Send the same task again, edit the path or content, then click "Apply"                                            | The note is created with the edited path and content and appears in the file tree right away; the note name under the step opens it                                                                                                |
| 67  | With "2026-11-02" open, type `Add the tag "milestone" to my 2026-11-02 journal entry`                             | The confirmation card shows the tag as a chip (removable with ×) and a before/after of the frontmatter; after Apply, the open tab reloads automatically and the frontmatter has `tags: [journal, running, milestone]`              |
| 68  | Ask again for a note that already has the tag                                                                     | No confirmation card appears; the answer says it's already there                                                                                                                                                                   |
| 69  | Click "Stop" while waiting for confirmation                                                                       | Stops and shows "Stopped."; the proposal isn't written; "New task" clears it                                                                                                                                                       |
| 70  | In Settings, switch to a model without tool support, then send a task                                             | Shows "does not support tool calling" and asks you to change models                                                                                                                                                                |

### Cloud chat providers

Needs an OpenAI or Gemini API key. Without one, run through it with Custom and Ollama's OpenAI-compatible endpoint (`http://127.0.0.1:11434/v1`, any key).

| #   | Action                                                                               | Expected result                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 71  | In AI settings, change Chat provider to OpenAI                                       | API key and Model fields appear with a yellow consent box; Save is disabled until it's checked; the description changes to "note content is sent to OpenAI"                              |
| 72  | Paste a key without choosing a model, check the consent box, Save                    | The dialog stays open and the Model field suggests the available models; after choosing one and saving, it closes, the AI tab shows "OpenAI <model>" and the sidebar "AI ready · OpenAI" |
| 73  | Reopen the settings                                                                  | The key field shows "Saved" without the key; `llmKeys` in `~/.config/knowmon/settings.json` holds only encrypted base64, and the plain key can't be found in it                          |
| 74  | Restart the app                                                                      | Still in cloud mode and working (the key decrypts)                                                                                                                                       |
| 75  | Stop Ollama, then use summaries, Q&A and the Agent (including confirming a new note) | All of them work; the AI tab shows "Ollama is offline, so semantic search…" as a grey notice, not a red error; Hybrid search falls back to keywords                                      |
| 76  | Change the key to a wrong one                                                        | Shows "OpenAI rejected the API key" and the input shows AI is offline; it doesn't retry within a minute (no repeated errors)                                                             |
| 77  | Go offline (cloud mode)                                                              | Shows that api.openai.com can't be reached; recovers automatically within 30 seconds of reconnecting                                                                                     |
| 78  | Set Custom to `http://192.168.1.5:1234/v1`                                           | Rejected (only https or http to localhost); after saving the address is unchanged                                                                                                        |
| 79  | Switch back to Ollama (local)                                                        | Behaves as before; the description goes back to "notes never leave this computer"                                                                                                        |

### Context length and max output

| #   | Action                                                                                                        | Expected result                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 80  | Set Ollama's Context length to 4096, run a summary, then run `ollama ps`                                      | The CONTEXT column shows 4096; after setting it back to 8192, behavior is as before                                                                                   |
| 81  | Set Max output to 256 and summarize `Projects/Knowmon/Design notes` (a long note that is summarized in parts) | The reply stops partway and its last line is 「回覆達到輸出上限而中斷…」 ("Reply stopped at…" in English mode)                                                        |
| 82  | Ask a follow-up question in Q&A after that                                                                    | The new answer isn't affected (the old answer's notice isn't sent to the model)                                                                                       |
| 83  | Set Context length to 32768 and have Q&A and the Agent read a long note                                       | Source passages and each `get_note` page are noticeably longer (the Read step shows Showing characters 0–4800)                                                        |
| 84  | Enter 100 as the Context length, or a Max output larger than the context (Ollama)                             | Can't be saved; the field shows the allowed range                                                                                                                     |
| 85  | Switch to a cloud provider                                                                                    | Shows the cloud pair (default 8192 / blank); after changing it and switching back to Ollama, Ollama's pair is unchanged; both pairs are kept after restarting the app |

### Performance test on a large vault

```bash
node scripts/gen-vault.mjs ~/knowmon-1000 1000   # generate 1000 test notes (the third argument is a random seed)
```

Open `~/knowmon-1000` in the app and press `Ctrl+G`. Layout runs in the background with progress in the toolbar, and you can interact before it finishes. Measurements are in [`plans/phase3-graph.md`](plans/phase3-graph.md).

### Inspecting editing history

```bash
cat ~/knowmon-test-vault/.knowmon/events.jsonl
sqlite3 ~/knowmon-test-vault/.knowmon/index.db \
  "select n.path, e.kind, datetime(e.ts/1000,'unixepoch','localtime')
   from note_events e join notes n on n.id = e.note_id order by e.ts"
```

On first open, each note gets one `create`; after that come the `open` / `edit` events from your actions. For the same note and event kind, at most one event is recorded per 60 seconds.

### Testing a DB rebuild

Close the app, run `rm ~/knowmon-test-vault/.knowmon/index.db*`, reopen the same vault and check with the sqlite3 command above. The history should be exactly the same as before the deletion, and `events.jsonl` should gain no duplicate entries. Search results and backlinks should also match (links and the full-text index are rebuilt from the Markdown files). Vectors are re-embedded in the background (needs Ollama).

A vault upgraded from phase 1 rebuilds `index.db` once on first open, because the schema version changed.

## Pre-release checks

Before pushing a `v*` tag (process in [`releasing.md`](releasing.md)):

1. GitHub Actions `CI` is all green on the latest commit on main (vitest on three platforms, plus typecheck and lint).
2. Trigger `Release` manually once (`workflow_dispatch`): all four builds succeed, with six files in the artifacts: AppImage, deb, rpm, `-setup.exe`, `-arm64.dmg`, `-x64.dmg`. The "Show macOS code signature" step in both macOS jobs shows `Signature=adhoc`.
3. Download the Linux artifact and test it once each on Fedora and Ubuntu.

### Manual test of the Linux installers

Fedora uses the rpm (`sudo dnf install ./knowmon-<version>.x86_64.rpm`), Ubuntu the deb (`sudo apt install ./knowmon_<version>_amd64.deb`):

1. Knowmon opens from the application menu without needing `--no-sandbox`.
2. Open `~/knowmon-test-vault`; all of the following work:
   - The sidebar shows AI ready and embedding finishes.
   - Hybrid search for `how to build better habits` has meaning results.
   - The graph has Semantic edges; Q&A and the Agent answer.
   - Pasted images are shown.
   - Deleting a note sends it to the system trash.
3. After closing and reopening, the last vault, theme and tabs are kept.
4. AppImage: run it directly after `chmod +x`. On Fedora the sandbox should start normally; on Ubuntu 24+ `--no-sandbox` is added automatically because of AppArmor.
5. `sudo dnf remove knowmon` / `sudo apt remove knowmon` removes it cleanly (`/usr/bin/knowmon` and the menu entry are gone; `~/.config/knowmon` is kept).
