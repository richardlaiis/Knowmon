# Time layer design

Besides the `[[links]]` users write themselves, Knowmon links notes automatically by time and offers a timeline for browsing notes by date. This document explains the concepts and the reasoning behind them. For implementation details, see "Time layer" in `architecture.md`; for the plan and decisions, see `plans/phase4-time.md`.

## Two kinds of time

Every note has two kinds of time. Both are kept, and they serve different purposes:

| Name       | Meaning                                     | Source                                                                                                           | Granularity                                               |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Event date | When the events the note describes happened | `date:` in the frontmatter, otherwise a `YYYY-MM-DD` prefix in the file name; with neither, the note has no date | One date                                                  |
| Written    | When the user created and edited the note   | `create` / `edit` in `note_events`, recorded automatically by the app                                            | Each event to the millisecond; graph filters work in days |

Example: on 10/8 you write up the minutes of a meeting held on 10/1 (`date: 2026-10-01`), and on 10/15 you change a few sentences.

- Event date: 10/1.
- Written: 10/8 and 10/15.

Notes without a date (book notes, index pages) have no event date. But every note has at least one `create`, so it almost always has a written time.

`open` events (just reading) don't count as written time.

## Time edges

Each edge type is always based on one kind of time, regardless of the timeline menu in the graph toolbar.

| Type                     | Based on     | Rule                                                               | Directed        | Weight                    |
| ------------------------ | ------------ | ------------------------------------------------------------------ | --------------- | ------------------------- |
| `wikilink` (Links)       | Not time     | `[[links]]` in the body                                            | Yes             | Number of occurrences     |
| `same_session` (Session) | Written time | Notes edited in the same work session are all linked to each other | No              | Number of shared sessions |
| `same_day` (Same day)    | Event date   | Event dates at most `sameDayWindowDays` days apart                 | No              | `1 / (1 + days apart)`    |
| `sequence` (Sequence)    | Event date   | Within a folder, sorted by event date, each note links to the next | Earlier → later | 1                         |

### Session

All `edit` events in the vault are sorted by time. When the gap between two consecutive events is longer than `sessionGapMinutes` (default 30 minutes), a new session starts; a gap exactly equal to it still counts as the same session. This is the same definition as the "idle timeout" in web analytics: as long as you keep writing, the session continues, with no cap on its total length.

Notes edited in the same session are all linked to each other, whatever folder they are in. This answers "which notes was this written together with?"

- **Only `edit` counts**: when an existing vault is opened for the first time, every note gets a backfilled `create` at the file's birthtime. Files that came from a git clone or a sync tool may all share the same birthtime, so counting `create` would turn the whole vault into a complete graph. `open` is just reading and doesn't mean the notes were thought about together.
- **Batch protection**: when a session edits more than `sessionMaxNotes` notes (default 20), it is most likely a batch operation such as an external sync, a global replace or a git pull, so that session produces no edges.

### Same day

Notes with the same event date (or within `sameDayWindowDays` days of each other) are linked. This answers "what else happened that day?" By default only the same day counts; when the window is wider, the weight drops with the number of days.

### Sequence

Within a folder (including the vault root), notes with an event date are sorted by date (by path within the same day), and each note links only to the previous and next one, forming a chain. This answers "what comes before and after this note?" The typical case is `日記/` (a journal folder), where each day links to the next.

"Same topic" is defined as the same folder (user decision, 2026-10-08): folders are a classification users already make, so no extra markup or schema change is needed. Grouping topics by frontmatter tags is a possible extension.

### Session vs. Sequence

|          | Session                                                | Sequence                   |
| -------- | ------------------------------------------------------ | -------------------------- |
| Based on | Written time (to the minute)                           | Event date (to the day)    |
| Scope    | Across folders                                         | Within one folder          |
| Shape    | All notes in a session linked to each other (a clique) | Neighbors linked (a chain) |
| Requires | Actually edited in the app                             | The note has a date        |

Example: `日記/` has three notes for 10/4, 10/5 and 10/6. The Sequence is always `10/4 ── 10/5 ── 10/6`; 10/4 and 10/6 are not linked directly. If one afternoon you edit "the 10/5 journal", "Atomic Habits" and "Knowmon dev log" one after another, those three are all linked by Session, regardless of their dates or folders.

## Graph filters

The graph has two independent filters:

### Edge types (Links / Session / Same day / Sequence)

These decide which lines are drawn. Hidden types don't take part in layout, so toggling them adjusts the layout slightly (existing positions are kept; the whole graph isn't laid out again). The local graph filters edge types first and then finds neighbors, so hidden types don't count as "linked".

### Time range (slider)

This decides which **nodes** are temporarily hidden. It doesn't change how any lines are produced and doesn't re-run the layout: nodes appear or disappear where they are, and their lines are hidden with them.

- **Timeline menu (Event date / Written)**: only decides which kind of time the slider uses to judge whether a node is in range.
  - Event date: the event date is in range.
  - Written: any day of written time is in range (the note was created or edited within the range).
- **Undated**: whether notes that have **no date** on the current timeline are shown. When checked they are always shown, regardless of the slider; when unchecked they are hidden. In Event date mode, this means notes with no `date:` and no date in the file name; in Written mode there are almost none.
- **Reset**: restores the full range and shows undated notes.

With the slider at full range and Undated checked (the default), the two timelines look exactly the same. This is expected.

Example: with the slider set to 10/1–10/3, the meeting minutes above (event 10/1, written 10/8 and 10/15) are shown in Event date mode and hidden in Written mode.

## Timeline view

A tab (`Ctrl/Cmd+Shift+T`) with two modes:

- **Event date**: notes with an event date, grouped by date, newest first; the number of undated notes is shown at the bottom.
- **Written**: each work session listed by day (its time range and the notes edited in it, with newly created ones marked new). Sessions are split by the same function and the same `sessionGapMinutes` as Session edges, but here `create` counts too, since creating a note is part of writing. A session that crosses midnight belongs to the day it started.

The bar chart at the top shows the count per month; click it to scroll to that month.

## Settings

Stored in the `time` field of `<vault>/.knowmon/settings.json`, so they travel with the vault (user decision, 2026-10-08). If the file is missing or corrupt, the defaults are used; out-of-range values are clamped to the nearest bound.

| Setting             | Default | Range | Affects                                 |
| ------------------- | ------- | ----- | --------------------------------------- |
| `sessionGapMinutes` | 30      | 5–240 | Session edges, sessions in the timeline |
| `sessionMaxNotes`   | 20      | 2–200 | Session edges                           |
| `sameDayWindowDays` | 0       | 0–7   | Same day edges                          |

Time edges are recomputed as soon as a setting changes.

## Data flow

```
events.jsonl ──replay──▶ note_events ─┐
                                      ├─▶ deriveTimeLinks ──▶ links (three time edge types) ──▶ graph.get()
*.md ──parse──▶ notes.event_date ─────┘          ▲
                                       settings.json
```

- Time edges are stored in the `links` table like wikilinks, and can be fully rebuilt from the Markdown files and `events.jsonl`.
- There are no incremental updates: any change to events, dates, paths or settings can affect the whole vault (for example, inserting a journal entry changes the Sequence chain). Changes mark the edges as dirty, and they are recomputed in one batch before the graph is read; 1000 notes and 50,000 events take under 500 ms.
- Dates always use the local time zone.

## Known limitations

- Sequence direction isn't drawn: Cytoscape's haystack edges (used for performance on large graphs) don't support arrows.
- When a pair of notes has several edge types, the lines overlap and only the top one is visible.
- Written time is only recorded from when you start using Knowmon. Several edits made in another editor while the app is closed are recorded as a single `edit` the next time it opens (at the file's last modification time).
