# Phase 4 implementation plan: time layer

Done when: the timeline view works and the graph can be filtered by time range and edge type.

## Confirmed decisions (2026-10-08)

- The `types.ts` contract changes below are approved.
- The "same topic" for `sequence` is the same folder (no tags, no schema change).
- Time parameters are stored inside the vault in `.knowmon/settings.json`.

## Time edge definitions

All three edge types are derived by pure functions from `notes` and `note_events` (`src/main/indexer/timeLinks.ts`; session splitting is in `src/shared/time.ts`, shared by main and renderer), and the results are written to the `links` table (`type` is `same_session` / `same_day` / `sequence`, and `dst` is never NULL).

| Type           | Rule                                                                                                                                                                                                                                                                     | Directed        | Weight                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------- |
| `same_session` | Sort all `edit` events in the vault by time and start a new session when the gap between two consecutive events exceeds `sessionGapMinutes` (default 30), the same as a session timeout in web analytics. Notes edited in the same session are all linked to each other. | No              | Number of shared sessions |
| `same_day`     | `event_date`s at most `sameDayWindowDays` apart (default 0, i.e. the same day).                                                                                                                                                                                          | No              | `1 / (1 + days apart)`    |
| `sequence`     | Within a folder (including the vault root), notes with an `event_date` are sorted by date (by path within a day) and neighbors are linked. For example, in `日記/` each day links to the next.                                                                           | Earlier → later | 1                         |

- Only `edit` counts, not `open` (just reading) or `create` (the first time an existing vault is opened, every note gets a `create` at its birthtime; something like a git clone puts all notes at the same moment, which would make a complete graph).
- **Bulk-change protection**: a session that edits more than `sessionMaxNotes` notes (default 20) is treated as a batch operation (external sync, global replace, git pull) and produces no edges.
- Undirected edges are stored as one row, with the path that sorts first as `source`.

### When to recompute

Time edges depend on events, `event_date`, paths and settings, and a change to any of them can affect the whole vault, so there are no incremental updates:

- `Vault` marks them dirty when recording events, re-indexing, renaming, deleting or changing settings.
- If dirty, `graph()` recomputes everything before reading (in one transaction: delete the three time edge types, then write them). Estimated at tens of ms for 1000 notes and 50,000 events; a test will measure it.
- When the DB is deleted they are rebuilt along with it (recomputed after events are replayed from `events.jsonl`), so no schema change is needed and `SCHEMA_VERSION` stays the same.

## Settings

Time parameters are stored **inside the vault** in `<vault>/.knowmon/settings.json` (they travel with the vault, like `.obsidian/`; defaults are used when it's missing). Main validates them and clamps their range:

| Parameter           | Default | Range |
| ------------------- | ------- | ----- |
| `sessionGapMinutes` | 30      | 5–240 |
| `sessionMaxNotes`   | 20      | 2–200 |
| `sameDayWindowDays` | 0       | 0–7   |

UI: a gear button in the timeline and global graph toolbars opens a small dialog for editing these three values. Phase 8's settings page will integrate them later.

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' // phase 5 adds semantic

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
  /** Dates with create / edit events (local time zone YYYY-MM-DD, ascending), for the graph's "written time" filter */
  activeDays: string[]
}
// GraphEdge is unchanged (type is already LinkType). A pair of notes may have edges of several types.

/** For the timeline's "written time" mode: create / edit events */
export interface ActivityEvent {
  path: string
  title: string
  ts: number
  kind: 'create' | 'edit'
}

export interface TimeSettings {
  sessionGapMinutes: number
  sessionMaxNotes: number
  sameDayWindowDays: number
}

// Added to KnowmonAPI:
timeline: {
  /** create / edit events in [from, to), sorted by time */
  activity(from: number, to: number): Promise<ActivityEvent[]>
}
settings: {
  getTime(): Promise<TimeSettings>
  /** Writes and returns the values actually applied (after clamping); time edges are recomputed */
  setTime(s: Partial<TimeSettings>): Promise<TimeSettings>
}
```

The timeline's "event date" mode only needs the `eventDate` that `notes.list()` already returns, so no extra IPC.

## Timeline view (`src/renderer/timeline/`)

A new tab kind, `timeline` (at most one, like the graph), opened by the "Timeline" sidebar button or `Ctrl/Cmd+Shift+T`.

- Two modes (a toggle, with the preference in localStorage `knowmon.timeline.mode`):
  - **Event date**: notes with an `event_date`, grouped by date (newest first); "N undated notes" at the bottom.
  - **Written**: grouped by day, then split into sessions (`14:02–15:10 · 3 notes`), listing the notes edited in each session, with newly created ones marked "new". Session splitting uses the same function and settings as `same_session`.
- A monthly bar chart at the top (notes per month); clicking scrolls to that month.
- Clicking a note replaces the current tab, `Ctrl/Cmd+click` or middle-click opens a new tab (as elsewhere); the currently open note is shown in the accent color.
- Grouping, sessions and the bar chart are pure functions (`timeline/model.ts`) with tests.

## Graph filters

- **Edge types**: four toggleable swatches in the toolbar (Links / Session / Same day / Sequence), in both the global and local graphs, with separate preferences in localStorage (`knowmon.graph.types`, `knowmon.graph.localTypes`), all on by default. Edge types affect layout (time edges take part too); toggling reuses the position cache with a gentle reheat instead of redoing the whole layout.
- **Time range** (global graph only):
  - The timeline can be "event date" (`eventDate`) or "written time" (any day in `activeDays` falls in the range).
  - A two-handle slider spanning the earliest to latest date, showing the start and end dates; "Reset" restores the full range.
  - Undated notes: an "Undated" checkbox decides whether they are shown (shown by default; in written mode every note has dates).
  - The time filter only hides nodes (Cytoscape `display: none`, with their edges hidden too) and **doesn't re-run layout**, so nodes appear and disappear in fixed positions while dragging the slider. On large graphs it's applied throttled by `requestAnimationFrame`.
- Edge styles: one color per type (`main.css` gains `--edge-session`, `--edge-day` and `--edge-sequence`, with light and dark sets), with `same_session` dashed and `same_day` dotted.
- `edgeId` includes the type (a pair of notes may have several edges); `filterGraph(data, filter)` is pure, with tests.

## Order of work

1. `shared/time.ts` (session splitting, deriving the three edge types) + tests
2. Reading/writing settings, writing time edges to the DB, adding `activeDays` and time edges to `getGraph`, IPC + tests (including recompute performance)
3. Graph edge-type filters and styles
4. Graph time slider
5. Timeline view + tab
6. Settings dialog
7. Verify in the running app with `test-vault/`; update the README (shortcuts, manual tests), `architecture.md`, `roadmap.md`

## Results (2026-10-08)

- Completed as planned, with the `types.ts` changes exactly as above; no new dependencies and no schema change.
- Tests: 37 new (234 in total), including recomputing time edges in < 500 ms with 1000 notes and 50,000 edit events.
- Verified in the running app (driven over CDP) with a copy of `test-vault/` plus synthetic editing history: time edges match expectations; node positions stay put after time slider filtering; both timeline modes; saving the settings dialog updates `settings.json` and recomputes time edges immediately; dark theme.
- Adjustments along the way: the sidebar ran out of room after the "Timeline" button was added, so it now wraps; timeline times use the 24-hour clock (AM/PM wrapped onto a new line); in the dark theme, `sequence` uses Nord purple (the original blue looked too much like ordinary links).
- Known limitations: haystack edges don't support arrows, so the direction of `sequence` isn't drawn; multiple edge types between the same pair overlap on one line.
