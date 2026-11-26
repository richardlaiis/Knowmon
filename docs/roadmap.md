# Knowmon project handover

Oct 6, 2026 · @Richard Lai

## Project overview

Knowmon is an Obsidian-style local note-taking app. Phase 0 (the skeleton) is complete, and Claude Code takes over implementation from phase 1. It differs from Obsidian in three ways:

1. **Bidirectional links**: notes link to each other with `[[note name]]`, and there is a backlinks panel.
2. **Time-context links**: besides manual links, the system creates links automatically from editing time and event dates, giving each vault a fuller knowledge graph.
3. **Local LLM agent**: local models through Ollama provide retrieval, summaries, filtering and more. By default no data leaves the user's computer; users can also opt in to a cloud API (OpenAI, Gemini, OpenAI-compatible) for chat.

## Architecture and technology choices

The whole project is TypeScript only, split into two layers, the UI (renderer) and the core services (main process), which communicate over IPC.

| Purpose               | Technology               | Notes                                                                            |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Desktop framework     | Electron + electron-vite | React + TypeScript template                                                      |
| Editor                | CodeMirror 6             | `@codemirror/lang-markdown`                                                      |
| Database              | SQLite (better-sqlite3)  | Native module; on a version mismatch run `npx electron-builder install-app-deps` |
| Vector search         | sqlite-vec               | SQLite extension                                                                 |
| Full-text search      | SQLite FTS5              | Must use the `trigram` tokenizer to search Chinese                               |
| File watching         | chokidar                 | Detects changes made in external editors                                         |
| Frontmatter parsing   | gray-matter              |                                                                                  |
| Graph visualization   | Cytoscape.js             | Consider sigma.js if performance falls short                                     |
| Local LLM             | Ollama HTTP API          | Chat model `qwen3:8b`, embedding model `bge-m3`                                  |
| Cloud chat (optional) | OpenAI-compatible API    | OpenAI, Gemini, custom; built-in fetch only, keys encrypted with safeStorage     |
| Tests                 | vitest                   |                                                                                  |

Folder responsibilities:

- `src/shared/types.ts`: data types and the IPC interface contract. Changes need the user's approval.
- `src/main/vault/`: reading and writing files, watching for changes.
- `src/main/indexer/`: parsing links, frontmatter and dates.
- `src/main/db/`: schema and queries.
- `src/main/llm/`: Ollama client, cloud (OpenAI-compatible) client, retrieval, agent tools.
- `src/renderer/`: four UI modules: `editor/`, `graph/`, `timeline/`, `chat/`.
- `test-vault/`: the sample vault, about 35 English notes over seven weeks (journal, books, projects, meetings, recipes, a Markdown showcase) plus a small Chinese folder, `中文/`; see `docs/plans/sample-vault-english.md`.
- `docs/`: `architecture.md`, `roadmap.md`, `testing.md` (test checklist), `plans/` (an implementation plan for each feature), `user-guide/` (the user guide).

## Current progress

Phases 1–7 are complete and phase 8 (polish and packaging) is in progress; see "Development roadmap" below. The handover checklist for phase 0 (skeleton and infrastructure) is kept below for the record:

- [x] Create the project with electron-vite; `npm run dev` opens a window
- [x] Install dependencies: better-sqlite3, sqlite-vec, chokidar, gray-matter, CodeMirror, Cytoscape.js, vitest
- [x] Create the folder structure, with an `index.ts` and a comment on its responsibility in each module
- [x] Write the first version of `src/shared/types.ts`
- [x] Write the first version of the SQLite schema
- [x] Write `CLAUDE.md`
- [x] Set up vitest
- [x] Prepare the `test-vault/` test notes
- [x] Initialize git
- [x] Install Ollama and download the models: `ollama pull qwen3:8b`, `ollama pull bge-m3` (only needed before phase 5; doesn't affect phases 1–4)

`types.ts` and the schema are first versions written by hand by the user. When Claude Code takes over, it should first read them and check that they cover the "Data model" section of this document. If anything is missing, raise it first instead of changing them directly.

## Core design principles

These principles must not be broken in any phase. When something conflicts with them, stop and ask the user.

1. **The Markdown files are the only source of truth.** SQLite is just an index; after the database is deleted it must be fully rebuildable from the vault. The user's note content must never exist only in the database.
2. **Only the main process accesses the file system and the database.** The renderer always goes through the IPC interface defined in `types.ts`.
3. **Record `note_events` from phase 1.** The file system only keeps the last modification time, and past editing history can't be recovered later, so recording must start early even though the time features come in phase 4.
4. **Indexing is incremental.** A content hash decides whether a file changed, and only changed files are re-indexed.
5. **Ollama is optional.** Without a running Ollama, every non-LLM feature must work normally; LLM features just show a clear message.
6. **The agent is read-only by default.** Any action that modifies or creates a note needs the user's confirmation.

## Data model

The heart of the graph is "edges have types and weights", which is the project's biggest difference from Obsidian. The target schema is below; where the actual `types.ts` and schema differ, the version the user approved wins.

```sql
notes(id, path, title, created_at, modified_at, event_date, content_hash)
note_events(note_id, ts, kind)        -- kind: create / edit / open
links(src, dst, type, weight, meta)   -- edges have a type and a weight
chunks(id, note_id, text)             -- text chunks for LLM retrieval
notes_fts USING fts5(title, body, tokenize='trigram')
-- the vector table is created by sqlite-vec and maps to chunks.id
```

Notes have two kinds of time: `created_at` / `modified_at` is when it was written, and `event_date` is when the events in the content happened, taken from `date:` in the frontmatter or a journal-style file name. Both are kept so the graph can switch between the two perspectives.

| Link type      | How it's created                                                    | Phase |
| -------------- | ------------------------------------------------------------------- | ----- |
| `wikilink`     | The user writes `[[ ]]` in the body                                 | 2     |
| `same_session` | Edited in the same work session (30 minutes by default, adjustable) | 4     |
| `same_day`     | Same or close `event_date`                                          | 4     |
| `sequence`     | Previous and next notes in time on the same topic                   | 4     |
| `semantic`     | Embedding similarity above a threshold                              | 5     |

## Development roadmap

Phases are ordered by dependency, and each phase ends with a version the user can actually use. Each task is one Claude Code session of work; check it off and commit when done.

### Phase 1: Vault reading/writing and the editor

Done when: you can open a folder, edit and save Markdown, and external changes sync into the app.

- [x] Choose a vault folder and remember the last opened vault (not opened automatically on startup; the folder dialog starts at the last location)
- [x] File tree (create, rename, delete notes)
- [x] CodeMirror 6 editor, opening and saving notes
- [x] chokidar watches for external changes and updates the view
- [x] Record `note_events` (create / edit / open)

### Phase 2: Indexing, links, search

Done when: backlinks and Chinese search work, and the database can be fully rebuilt after deletion. This is the foundation of the whole project and deserves the most time.

- [x] Parser: frontmatter, `[[links]]`, dates (pure functions, must have tests)
- [x] Write to the database, with incremental indexing by content hash
- [x] FTS5 trigram full-text search for Chinese
- [x] Backlinks API and panel
- [x] Note name autocompletion when typing `[[`
- [x] Quick switcher

### Phase 3: Graph view

Done when: the global graph and the per-note local graph are interactive and stay smooth with 1000 notes.

- [x] Global graph (only `wikilink` edges at first)
- [x] Interaction: zoom, click to open a note, highlight neighbors on hover
- [x] Per-note local graph with adjustable depth
- [x] Performance test with a large test vault (results in `docs/plans/phase3-graph.md`: zooming, panning and layout are smooth at 1000 notes, hover at about 21 fps; consider sigma.js beyond about 1000 notes)

### Phase 4: Time layer

Done when: the timeline view works and the graph can be filtered by time range and edge type.

- [x] Derive `same_session` edges from `note_events`
- [x] Derive `same_day` and `sequence` edges from `event_date` (the `sequence` topic = the same folder)
- [x] Timeline view
- [x] Graph time slider and edge-type filters
- [x] Make the time parameters (session length and so on) configurable (stored in `<vault>/.knowmon/settings.json`; plan in `docs/plans/phase4-time.md`)

### Phase 5: Basic LLM capabilities

Ollama must be installed first. Done when: vector retrieval works and a single note can be summarized. Plan and implementation decisions in `docs/plans/phase5-llm.md`.

- [x] Ollama client and connection check (graceful degradation when it isn't running)
- [x] Note chunking and embedding
- [x] Vector search and hybrid retrieval (full text + vectors + graph neighbors + time filter)
- [x] One-off features: summarize a note, summarize the selection
- [x] Add `semantic` edges to the graph

### Phase 6: Q&A (RAG)

Done when: the chat panel answers questions with clickable source notes.

- [x] Chat panel UI
- [x] RAG answers with source links
- [x] Time range filtering (for example "notes from last month")

### Phase 7: Agent

Done when: it can run multi-step retrieval and organizing, and every write needs confirmation. Plan and implementation decisions in `docs/plans/phase7-agent.md`.

- [x] Read-only tools: `search_notes`, `get_note`, `get_neighbors`, `list_notes_in_range`
- [x] Multi-step execution with visible progress
- [x] Write tools (create a summary note, add tags) with a user confirmation flow

### Phase 8: Polish and packaging

Done when: all three platforms have installable, fully functional (including AI) installers, and settings live in one place. Packaging plan and implementation decisions in `docs/plans/phase8-packaging.md`.

- [x] Linux trial packaging: deb and AppImage install, vector features (sqlite-vec) work in the packaged build, and settings carry over from the development build (2026-10-20)
- [x] Live table rendering: tables render as tables when the cursor is outside them and show the source when it enters (2026-11-11, see `docs/plans/table-rendering.md`)
- [x] LaTeX math rendering (KaTeX): `$…$` and `$$…$$` in the editor and table cells, also `\(…\)` / `\[…\]` in AI replies (2026-11-25, see `docs/plans/latex-rendering.md`)
- [x] Logo and UI icons: a proper app icon (replacing the Electron default), welcome and empty pages, sidebar/tab/file tree icons (2026-11-13, see `docs/plans/ui-logo-icons.md`)
- [x] Cloud chat models: OpenAI, Gemini, OpenAI-compatible APIs (chat only; embeddings still use Ollama; see `docs/plans/cloud-providers.md`)
- [x] Configurable context length and max output: one pair for Ollama and one for cloud providers; the context also scales the character budgets sent to the model (2026-11-26, see `docs/plans/configurable-llm-limits.md`)
- [x] English documentation: docs, plans, code comments and test titles translated to English; the zh-TW user guide removed (2026-11-26, see `docs/plans/english-translation.md`)
- [x] Richer English sample vault (~35 notes plus a Chinese folder) and English test data where the language doesn't matter (2026-11-26, see `docs/plans/sample-vault-english.md`)
- [ ] Settings page: combine the time and Semantic parameters, AI settings, theme and interface preferences
- [ ] Performance: first measure 1000 and 3000 notes with `scripts/gen-vault.mjs`, then set targets (known weak spots: graph hover, first-time indexing)
- [ ] Installers: Windows and macOS packaging (must build on each OS or in CI), license (LICENSE), version number, and update the installation page of the user guide
  - [x] CI (tests on three platforms) and tag-triggered packaging into a draft Release, rpm added for Linux, MIT LICENSE, version 0.1.0, installation guide reworked around downloading installers (2026-11-17, see `docs/plans/release-ci.md` and `docs/releasing.md`)
  - [ ] Verify the Windows and macOS installers on real machines (currently marked experimental)

## Next steps

The remaining phase 8 tasks, one session each. Write a plan in plan mode first (saved to `docs/plans/`) and implement after the user approves it:

1. **Settings page**: the user needs to decide whether it's a tab or a dialog, its shortcut, and whether to add new settings this time. If new settings require changing `src/shared/types.ts`, ask first as the rules say.
2. **Performance**: measure first, and confirm the target scale with the user before tuning; switching to sigma.js is a big change and needs the user's approval.
3. **Packaging wrap-up**: verify the Windows/macOS installers on real machines (AI, images, trash, file names); decide whether to buy code signing and Apple notarization; `toolsets.appimage` (static runtime) is still a beta option in electron-builder, so re-check it when upgrading electron-builder.

## How we work together

The user makes architecture decisions and handles the environment; Claude Code implements features within the established architecture.

1. **One task per session.** When a task is done and its tests pass, commit, then start a new session.
2. **Plan before implementing.** For every task, write a plan in plan mode and save it to `docs/plans/`; start only after the user approves.
3. **Verify your own work.** New features must come with vitest tests. Run the tests and type check yourself before finishing; don't just report "done".
4. **Ask before changing a contract.** Changing `types.ts` or the database schema, or adding a dependency, needs a stated reason and approval first.
5. **When unsure, ask.** If something conflicts with the "Core design principles" in this document, stop and ask; don't make the trade-off yourself.
6. **Keep progress up to date.** After each task, check off the matching item in `docs/roadmap.md`; record new design decisions in `docs/architecture.md`.
