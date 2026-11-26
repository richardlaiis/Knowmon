# Live table rendering

## Context

GFM tables are already parsed (`markdownSupport()` uses `markdownLanguage`, and the syntax tree has `Table / TableHeader / TableRow / TableCell / TableDelimiter`), but `livePreview.ts` doesn't handle these nodes, so in live rendering mode tables are still lines of raw `| a | b |`. The user guide's FAQ also says "Tables aren't rendered".

Goal: when the cursor isn't in a table, the whole table is replaced by a rendered table; when the cursor enters (clicking a cell, moving in with the arrow keys), the whole table turns back into raw Markdown for editing (user decision, 2026-11-11: no in-cell editing). The behavior matches code blocks and images. No changes to `types.ts`, IPC or the DB, and no new dependencies.

Scope: the editor only. Tables in AI summaries/answers are out of scope this time (the FAQ keeps saying so).

## Technical points

- **Decorations must come from a StateField**: replace decorations that span line breaks (block widgets) can't be provided by a ViewPlugin, so tables go in a new StateField instead of the existing `livePreviewPlugin`. `livePreview()` now returns `[livePreviewPlugin, tableField]`, so source mode (with the Compartment off) naturally doesn't render them.
- The StateField recomputes on `docChanged`, a `selection` change, or `syntaxTree(startState) !== syntaxTree(state)` (background parsing sends a transaction when it finishes); it only walks the Document's direct children looking for `Table`, so it's cheap.
- Only **top-level** tables (direct children of the Document) are rendered. Tables inside `>` quotes or lists stay as they are (replacing whole lines would eat the `> ` markers). Nothing inside the frontmatter is handled.
- Replaced range: from the start of the table's first line to the end of its last line, with `Decoration.replace({ widget, block: true })`. If the cursor or any selection touches `[from, to]`, it isn't replaced. Moving into a table with the up/down arrows puts the cursor at the table's start/end, so the source expands automatically.
- When `livePreviewPlugin` meets an unexpanded `Table`, it `return false`s and stops computing decorations for the replaced content (the wikilink regex must exclude this range too).

## Implementation

### New file `src/renderer/editor/tables.ts`

1. Pure function `parseTable(state, node): TableModel`
   - `align: ('left' | 'center' | 'right' | null)[]`, taken from the delimiter row (`:--`, `:-:`, `--:`).
   - `header` and `rows`: each cell is `{ from, to, inline: InlineSpan[] }`, with `from/to` stored as **offsets from the start of the table** (so edits outside the table don't invalidate the widget; `view.posAtDOM(widget)` is added on click).
   - The header sets the column count: short rows are padded with empty cells and long rows are truncated (the GFM rule).
   - Inline content becomes spans following the syntax tree: `StrongEmphasis`, `Emphasis`, `Strikethrough` (marks hidden), `InlineCode`, `Link` (text + `data-url`), wikilinks (reusing the `[[target|text]]` regex, with `data-target`), `Escape` (`\|` → `|`); everything else is plain text. Images in cells show only their alt text.
2. `tableDecorations(state): DecorationSet` and `tableField` (a StateField with `provide: EditorView.decorations.from`).
3. `TableWidget`
   - `toDOM` builds `<table class="cm-lp-table">` with `createElement` + `textContent` (no HTML inserted), wrapped in `div.cm-lp-table-wrap` so overly wide tables scroll horizontally.
   - `eq` compares the table's source (including offsets), so the DOM isn't rebuilt when the content is unchanged.
   - `ignoreEvent() → false`; `estimatedHeight` is estimated from the row count.
   - Clicks: a normal click puts the cursor at the start of the cell's source text (`data-offset`) → the table expands; `Ctrl/Cmd+click` on a link hands it to the system browser (reusing `isOpenableUrl`), and on a wikilink opens the note (this requires connecting `wikilinks()`'s `onOpen` to the table widget: either read `data-target` in `tables.ts` through a facet, or have the mousedown in `wikilinks.ts` check `target.closest('[data-target]')` first; implement the latter to avoid an extra callback path).

### Changes

- `src/renderer/editor/livePreview.ts`: `livePreview()` adds `tableField`; `buildDecorations` skips unexpanded top-level tables (including the wikilink loop). Shared helpers such as the wikilink regex and `touches` are extracted as exports and reused by `tables.ts` instead of being rewritten.
- `src/renderer/editor/wikilinks.ts`: mousedown first checks whether the click target is a `[data-target]` inside a table widget.
- `src/renderer/src/assets/main.css`: `.cm-lp-table-wrap` and `.cm-lp-table` (borders, header background, `th/td` alignment, padding), all colors from existing CSS variables (`--border`, `--muted` and so on; match the real names in main.css when implementing), so no separate light/dark styles are needed.
- No extra styling when the source is expanded (it shows as ordinary Markdown).

## Documentation

- First save this plan to `docs/plans/table-rendering.md`.
- `docs/architecture.md` "Renderer": add an entry on the table design (why a StateField, top-level only, expanding when the cursor enters).
- `docs/roadmap.md` phase 8: add an item and check it off.
- `docs/testing.md`: add `tables.test.ts` to the test list and a table item to the manual checklist.
- User guide (Chinese and English): add a "Table" row to the supported syntax table in `notes-and-editing.md`; change "Tables aren't rendered" in `faq.md` so only AI summaries/answers aren't rendered. No shortcut changes.

## Tests (`src/renderer/editor/tables.test.ts`, following the `stateOf` style of `livePreview.test.ts`)

- `parseTable`: alignment, header and body, `\|` escapes, padding missing cells / truncating extra ones, inline style spans (bold, code, links, wikilinks including `|label`).
- Decorations: cursor outside the table → one block widget covering whole lines; cursor in any cell, or a selection reaching into the table → no widget; with two tables, only the one with the cursor expands.
- Not rendered: tables in quotes/lists, the frontmatter, a "table" with a header but no delimiter row.
- `buildDecorations` no longer produces decorations for replaced tables.

## Verification

1. `npx vitest run`, `npm run typecheck` and `npm run lint` all pass.
2. `cp -r test-vault ~/knowmon-test-vault`, open it with `npm run dev`, create a note with tables, and check: rendering, alignment, horizontal scrolling for wide tables, clicking a cell jumps to its source, moving in and out with the arrow keys, toggling with `Ctrl+E`, `Ctrl+click` on links and wikilinks in tables, light and dark themes, and line numbers and scrolling with other blocks above and below the table.
