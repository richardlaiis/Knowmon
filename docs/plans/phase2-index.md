# Phase 2 implementation plan: indexing, links, search

Done when: backlinks and Chinese search work, and the database can be fully rebuilt after deletion.

## Confirmed decisions (2026-10-07)

- The `types.ts` contract changes and schema v2 below are approved.
- The title is always the file name (as in Obsidian); `title:` in the frontmatter is just an ordinary property.
- Includes opening wikilinks with `Ctrl/Cmd+click`; the Quick switcher doesn't create a note when nothing matches.

## Parser (`src/main/indexer/`, pure functions)

`parseNote(path, content)` returns (the title still comes from the file name via `titleFromPath`):

- `eventDate`: frontmatter `date:` first (YAML dates, `2026-10-01`, `2026/10/1` and strings with a time all yield the date part), then a `YYYY-MM-DD` prefix in the file name (for example `2026-10-06.md`, `2026-10-06 會議.md`). Invalid dates (`2026-02-30`) count as none.
- `body`: the content without frontmatter (for full-text search).
- `links`: every `[[target]]`, `[[target|label]]`, `[[target#heading]]` and `![[embed]]`, with `#...` and `.md` removed from the target. Links in code blocks, inline code and frontmatter are excluded. Line numbers are recorded so backlinks can show context.
- Corrupt frontmatter (a YAML error) is treated as no frontmatter, without stopping indexing.

Link resolution, `resolveLink(target, paths)`, lives in `src/shared/links.ts` (pure, shared by main and renderer, so clicking a link in the renderer uses the same rules):

1. Case-insensitive.
2. A target containing `/` matches the end of a path (`[[Knowmon/時間脈絡連結]]`).
3. Otherwise it matches the file name.
4. When several notes share a name, the shortest path wins, then alphabetical order (close to Obsidian).

## Schema (`SCHEMA_VERSION` 1 → 2; old DBs are rebuilt automatically)

```sql
CREATE TABLE links (
  src    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst    INTEGER REFERENCES notes(id) ON DELETE SET NULL, -- NULL = a note that doesn't exist yet
  target TEXT,                 -- the wikilink's original target (used to connect unresolved links when the note appears)
  type   TEXT NOT NULL,        -- 'wikilink'; the edge types of phases 4 and 5 share this table
  weight REAL NOT NULL DEFAULT 1, -- wikilink: number of links to the same target within a note
  meta   TEXT                  -- JSON, reserved for later edge types
);
CREATE INDEX links_src ON links(src, type);
CREATE INDEX links_dst ON links(dst, type);

CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='trigram'); -- rowid = notes.id
```

- Phase 1's `notes` and `note_events` are unchanged. `chunks` and the vector tables wait for phase 5.
- Rebuilding after the DB is deleted: files → parse → notes/links/notes_fts; history is replayed from events.jsonl as before.

## Incremental indexing

- `indexFile` computes the hash while reading the file; if it matches the DB, nothing is re-parsed (the mtime changed but the content didn't).
- Only a changed hash triggers re-parsing, updating `notes`, `links` (all rows with that note as src rewritten) and `notes_fts` in one transaction.
- When the set of notes changes (create, rename, delete), `links.dst` is re-resolved: only rows with `dst IS NULL` or pointing to affected notes are updated, without rereading any file.
- Renaming doesn't rewrite `[[old name]]` in other notes (Obsidian's "update links on rename" is left for later, since it requires writing to the user's files).

## Full-text search

- Trigram can only match terms of 3+ characters, but common Chinese words have 2 (「習慣」). Queries are split on whitespace: terms of 3+ characters use `MATCH` (ranked by bm25), shorter ones use `LIKE` (LIKE on a trigram table scans the whole table, acceptable at personal vault scale). All terms are ANDed.
- Title matches come first. Snippets are extracted in main with JS around the match positions and returned as `{ text, match }` segments, so the renderer never inserts HTML.

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export interface NoteSummary {
  path: string
  title: string
  eventDate: string | null
  modifiedAt: number
}

export interface TextSegment {
  text: string
  match: boolean // whether this part is a search match
}

export interface Backlink {
  path: string // source note
  title: string
  line: number // 1-based
  context: TextSegment[] // the line's text, with the link part match = true
}

export interface SearchHit {
  path: string
  title: string
  snippet: TextSegment[]
}

// Added to KnowmonAPI:
notes.list(): Promise<NoteSummary[]>        // autocompletion, Quick switcher, clicking links
links.backlinks(path: string): Promise<Backlink[]>
search.query(q: string, limit?: number): Promise<SearchHit[]>
```

## Renderer

- **Backlinks panel on the right**: shows the current note's backlinks (grouped by source note, one row per line of context); click to open. Updates when a note opens or the vault changes. Collapsible, with the state in localStorage.
- **Clicking a wikilink**: `Ctrl/Cmd+click` opens it (the same gesture as external links); if the target doesn't exist, a new note is created (at the vault root).
- **`[[` autocompletion**: `@codemirror/autocomplete` (already installed indirectly through `codemirror`; now listed directly in dependencies). Fuzzy matches titles and file names; choosing one inserts the shortest target that resolves uniquely (adding the folder when names clash) and adds `]]`.
- **Quick switcher**: `Ctrl/Cmd+O` opens a dialog that fuzzy matches titles and paths, with recently opened notes first; `Enter` opens.
- **Search**: a "Files / Search" switch at the top of the sidebar, with `Ctrl/Cmd+Shift+F` going straight to search; queries run 200 ms after typing, and results show the title and a highlighted snippet.
- Fuzzy matching (`fuzzyScore`) is a pure renderer function with tests.

## Tests

- `indexer`: frontmatter (including corrupt), every date format and journal file names, every wikilink form and exclusion inside code.
- `shared/links`: resolution rules (same names, paths, case).
- `db`: writing links/fts, cascading deletes, re-resolving dst.
- `Vault`: backlinks update after writes, new notes connect unresolved links, rename and delete, external changes, links and search consistent after rebuilding a deleted DB, no re-parse when the hash is unchanged.
- Search: 2-character Chinese, 3+ characters, mixed Chinese/English, multi-term AND, snippet segments.
- Renderer: `fuzzyScore`, the text inserted by completion.
- Manual checks with `test-vault/` (`[[尚未建立的筆記]]`, frontmatter dates, journal file names and so on).

## Order of work (check off the roadmap after each item passes its tests; the user handles commits)

1. Parser + `shared/links`
2. Schema v2, incremental indexing
3. FTS search API + search panel
4. Backlinks API + panel + clicking wikilinks
5. `[[` autocompletion
6. Quick switcher
