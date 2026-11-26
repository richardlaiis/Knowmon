---
title: Design notes
date: 2026-10-09
tags: [knowmon, design, long]
---

# Knowmon design notes

These notes explain why Knowmon is built the way it is. They are long on purpose: this is the note to try when testing summaries of long text, which are split into parts and then combined. Related notes: [[Dev log]], [[Time context links]], [[2026-10-14 Design review]].

## 1. Files are the source of truth

Every note is a plain Markdown file in a folder the user chooses. Knowmon never stores note content only in its database. The SQLite database inside `.knowmon/` is an index: it holds parsed links, full-text search tables, chunks for retrieval and vectors for semantic search. If it is deleted, Knowmon rebuilds it from the files the next time the vault opens. This rule shapes almost every other decision. It is why schema changes never come with migrations: when the schema version changes, the database is simply deleted and rebuilt. It is also why editing notes in another editor is safe. A file watcher notices the change, and a reconcile step compares the files on disk with the index and updates whatever differs.

There is one exception to "the files are everything": editing history. A file system only remembers when a file was last modified, not every time it was edited. The time layer needs the full history, so Knowmon writes an append-only log of events (create, edit, open, rename, delete) to `.knowmon/events.jsonl`. The log is the source of truth for history in the same way the Markdown files are the source of truth for content, and the database copy of the events is rebuilt from it.

## 2. One queue for every write

All file and database operations go through a single queue in the main process. The renderer never touches the file system. This sounds restrictive, but it removes a whole class of bugs: an external change being reconciled at the same moment as an in-app rename, an autosave racing a delete, or two tabs writing the same file. Operations run one at a time, in order. Reads that don't change anything, such as listing notes or searching, can skip the queue because better-sqlite3 is synchronous and each query sees a consistent state.

The queue also makes "echoes" easy to handle. When the app writes a file, the watcher fires a moment later. Because the app already updated the stored modification time and content hash when it wrote the file, reconcile sees that nothing differs and does nothing.

## 3. Links and how they resolve

A wikilink like `[[Ideas]]` has to resolve to exactly one note, and the main process (which builds the links table) and the renderer (which opens a link when clicked) must agree on which one. The rules live in one shared module: matching is case-insensitive and Unicode-normalized; a target containing a slash matches the end of a path; otherwise the file name is matched; when several notes share a name, the shortest path wins, then alphabetical order. This vault has two notes called Ideas on purpose, to show the rule in action.

Links to notes that don't exist yet are kept with an empty destination and their original text. When a note with that name is created later, every waiting link connects automatically, without rereading any file. Renaming a note does not rewrite links in other notes; that would mean silently editing the user's files, which Knowmon avoids.

## 4. The graph

The graph is drawn with Cytoscape on a canvas. Layout is the expensive part: the built-in layouts took ten to thirty-seven seconds for a thousand notes and froze the interface while they ran. Knowmon runs a d3-force simulation in a web worker instead and sends positions back to the main thread as a transferable typed array. Small graphs are drawn while the simulation settles; large ones are drawn once at the end, because redrawing a thousand-node canvas every frame costs more than the layout itself.

Positions are cached in memory per vault. Reopening the graph, or adding a note, reuses the cache and only warms the simulation gently, so the picture the user has learned doesn't jump around. Labels were the last problem. The collision force originally only considered each node's circle, while labels are four to ten times wider, so labels overlapped badly. The collision force now uses a rectangle covering the node and its label, and a final collision-only pass pushes apart anything that still overlaps after the simulation converges.

## 5. The time layer

Three kinds of edges come from time rather than from links. Session edges connect notes edited in the same sitting: all edit events in the vault are sorted, and a gap longer than the session gap (thirty minutes by default) starts a new session. Same-day edges connect notes whose event dates are equal or close. Sequence edges chain the dated notes in each folder from earliest to latest, which turns a journal folder into a timeline you can walk through.

None of this is computed incrementally. Adding one journal entry can change the sequence chain for the whole folder, and changing the session gap can change every session edge in the vault. Instead, any change marks the time edges as dirty, and they are recomputed in one batch just before the graph is read. For a thousand notes and fifty thousand edit events, that takes well under half a second, which is cheaper than the bugs an incremental version would bring. Two details matter in practice. Only edits count towards sessions, because opening a note is reading, not writing, and because the first time an existing vault is opened every note gets a creation event at the same moment. And a session that touches more than twenty notes is treated as a batch operation, such as a sync or a global replace, and produces no edges at all.

## 6. Local AI, and why it is optional

Everything AI-related goes through Ollama on the user's machine by default, and Ollama is optional: without it, every non-AI feature works and the AI panel explains what is missing. Embeddings are computed in the background in small batches. Each note is split into chunks of about eight hundred characters, following headings and paragraphs, and each chunk is embedded with its note title and section heading prepended so that short chunks still carry context. A note's own vector is the average of its chunk vectors.

Retrieval combines full-text search and vector search with reciprocal rank fusion, then adds a bonus for graph neighbors of the top results. A similarity floor keeps vector search from returning random notes when nothing in the vault is related to the question. Chinese questions have no spaces, so the full-text side segments them into words and searches each one separately.

Summaries of long notes are split into parts, each part is summarized, and the part summaries are combined into one. Only the combined summary is shown. This note is long enough to trigger that path at the default context length.

## 7. Answers with citations

Questions are answered only from the user's notes. Retrieved passages are numbered, the model is asked to cite them as `[1]`, `[2]` and so on, and a streaming filter normalizes the citation formats small models actually produce and drops numbers that don't exist. Another filter removes wikilinks that don't appear in the sources, because small models like to invent plausible note names. When nothing relevant is found, Knowmon answers with a fixed message and never calls the model at all, so it can't make something up.

Conversation history is included for follow-up questions, but old citation numbers are stripped first: they referred to the sources of an earlier answer, not the current one.

## 8. The agent

The agent can search, read notes, list notes in a time range and look at a note's neighbors in the graph. Those tools run directly. Writing is different: creating a note or adding tags only produces a proposal, which the user can edit and then apply or reject. Nothing is written until the user clicks Apply. When the user applies a tag change, the file is reread at that moment, so edits made while the proposal was waiting are never overwritten.

Tool results are short plain text rather than JSON, because small models read it more reliably. Date arithmetic is never left to the model: phrases such as "last week" are parsed by the same function the Q&A feature uses. On a CPU, reading the prompt is the slow part, so tool results share a character budget, and messages that were already sent are never rewritten, which keeps the model's prompt cache valid between steps.

## 9. Cloud providers

Some users can't run an eight-billion-parameter model locally, so chat can optionally use OpenAI, Gemini or any OpenAI-compatible API. Embeddings still use Ollama. Choosing a cloud provider requires ticking a consent box, because note content leaves the computer. API keys are encrypted with the operating system's keyring, stored outside the settings object that the renderer can see, and can be written but never read back. A custom address must use HTTPS unless it points to the same machine, so a key is never sent in plain text across a network.

## 10. Tabs, panels and the editor

Tabs behave like a browser's. Clicking a note replaces the current tab; Ctrl-clicking or middle-clicking opens a new one, and a note that is already open in a tab is switched to rather than opened twice. Each note tab owns its own editor, created the first time the tab is shown and then kept alive while hidden, so switching tabs preserves the cursor, the scroll position and the undo history. Restoring many tabs at startup doesn't read every file at once, and it doesn't record an "open" event for notes the user hasn't actually looked at.

The editor renders Markdown live, in the style of Obsidian: formatting marks are hidden until the cursor touches them, then the raw syntax reappears for editing. Tables and math blocks are replaced by rendered widgets in the same way. Replacing content that spans several lines can't be done from a view plugin in CodeMirror, so tables and math blocks use their own state fields. Images use standard Markdown syntax with paths relative to the note, served through a custom protocol that only exposes image files inside the current vault. Pasted screenshots are saved to an attachments folder and never overwrite an existing file.

## 11. Packaging

Knowmon ships as installers built on each operating system by continuous integration, because the vector extension only installs the build for the platform it is installed on. The extension is loaded by SQLite with dlopen, which bypasses Electron's archive redirection, so it is unpacked next to the archive and the load path is rewritten to point there. Settings always live in a folder named after the lowercase package name, so a packaged build and a development build share the same settings. There is no automatic update and no code signing yet; macOS builds carry an ad-hoc signature so they run on Apple Silicon at all.

## Glossary

- **Vault**: the folder of Markdown files Knowmon opens. Everything inside it that doesn't start with a dot is a note or an attachment.
- **Event date**: when the events described in a note happened, from the `date:` property or a date at the start of the file name.
- **Written time**: when the note was created or edited, from the event log.
- **Session**: a stretch of editing without a pause longer than the session gap.
- **Chunk**: a passage of about eight hundred characters used for retrieval and embeddings.
- **Proposal**: a change the agent wants to make, waiting for the user to apply or reject it.

## 12. Things I would do differently

- I would have written the event log first, before the editor. Every later feature depended on it.
- The graph's performance work would have been easier with a thousand-note sample vault from the start; the generator script came late.
- Some early tests asserted on exact text that later changed for good reasons. Testing behavior rather than wording would have saved time.

| Area       | What worked                         | What I'd change                        |
| ---------- | ----------------------------------- | -------------------------------------- |
| Storage    | Files as truth, rebuildable index   | Nothing                                |
| Graph      | Worker layout, position cache       | Measure performance earlier            |
| Time layer | Batch recompute, no incremental     | Expose the session gap more clearly    |
| AI         | Optional Ollama, citations, filters | Smaller default model for slow laptops |

```ts
// The shape every write goes through
await vault.enqueue(async () => {
  await fs.writeFile(abs, content)
  indexFile(db, rel, content)
  log.append({ ts: Date.now(), kind: 'edit', path: rel })
})
```
