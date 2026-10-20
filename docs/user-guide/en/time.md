# Time Context

Most note apps connect notes only through the links you write. But many connections hide in _time_: the notes you wrote together one afternoon are often about the same problem, and the journal entry, meeting notes, and reading notes from the same day often relate to each other.

Knowmon automatically records when you write each note and uses time to connect notes. You don't need to do anything differently — just write.

## Two kinds of time

Each note has two kinds of time, used for different things:

|          | Event date                                                      | Written                                 |
| -------- | --------------------------------------------------------------- | --------------------------------------- |
| Meaning  | When the note's content **happened**                            | When you **created or edited** the note |
| Source   | The `date:` property, or a file name starting with `YYYY-MM-DD` | Recorded automatically by Knowmon       |
| How many | At most one; may be none                                        | Possibly many                           |
| Example  | The date of a meeting                                           | The days you worked on the minutes      |

**Example**: on Oct 8 you write up the minutes for an Oct 1 meeting (`date: 2026-10-01`), and on Oct 15 you revise a few sentences.

- Event date: Oct 1
- Written: Oct 8, Oct 15

Undated notes like book notes or concept notes have no event date, but they still have written times. Merely **opening** a note to read it doesn't count as writing.

To set an event date, see [Properties](properties.md#date-event-date).

## Time links

Knowmon creates three kinds of time-based connections, shown in the [graph](graph.md).

### Session: notes written together

> "Which notes did I write alongside this one?"

Knowmon orders your edits by time. Whenever you pause for more than **30 minutes**, a new work session begins. Notes edited in the same session are all linked to each other, regardless of folder.

- As long as you keep writing, the session continues — there's no maximum length.
- Only **edits** count. Reading, and the "created" entries recorded when you first open an existing vault, don't.
- A session that edits more than **20 notes** is probably a bulk operation (a sync tool, find & replace, `git pull`), so it produces no lines.
- You need to have actually edited notes in Knowmon (or while Knowmon was open). A freshly opened vault has no Session links yet.

**Example**: one afternoon you edit the "2026-10-05" journal entry, "Atomic Habits", and "Project log" in a row. All three get Session lines between them, even though they're in three different folders.

### Same day: things from the same day

> "What else happened that day?"

Notes with the same event date are linked. You can widen this to a few days apart, in which case the connection gets weaker the more days apart they are.

**Example**: `Journal/2026-10-01.md` and a "Project log" note with `date: 2026-10-01` are linked by Same day.

### Sequence: previous and next

> "What came before and after this one?"

Dated notes in **the same folder** (including the vault root) are sorted by date, and each one links to the previous and next, forming a chain. Journals are the classic case:

```
Journal/2026-10-04 ── Journal/2026-10-05 ── Journal/2026-10-06
```

Oct 4 and Oct 6 aren't linked directly. If you organize topics by folder (`Projects/Knowmon/`, say), dated notes on each topic are chained in time order too.

### Session vs. Sequence

|          | Session                                       | Sequence                   |
| -------- | --------------------------------------------- | -------------------------- |
| Based on | Written time (to the minute)                  | Event date (to the day)    |
| Scope    | Across folders                                | Within one folder          |
| Shape    | Every note in a session linked to every other | A chain of previous → next |
| Requires | Actually editing in the app                   | Dated notes                |

## Timeline

Press `Ctrl+Shift+T` or click **Timeline** in the left sidebar to open the timeline tab. It has two modes, switched in its toolbar.

### Event date mode

Notes with an event date, grouped by day, newest first. The bottom shows how many notes have no date.

Good for: reviewing your journal, finding the notes from a particular meeting.

### Written mode

Your **work sessions**, by day: start and end time, plus the notes you edited. Notes created during the session are marked **new**.

Good for: "What did I actually do yesterday afternoon?", and seeing your writing habits.

> Written mode splits sessions with the same rule as Session links, but also counts note creation, since creating a note is part of writing. A session that crosses midnight belongs to the day it started.

### Using it

- The bar chart at the top shows notes per month. **Click a bar** to scroll to that month.
- Click a note to open it in the current tab; `Ctrl`+click for a new tab.
- Like the graph, the timeline tab stays as it is while open; switching away and back doesn't reload it.

## Settings

Click **Settings** in the graph or timeline toolbar to open "Time & link settings". Settings are saved in the vault's `.knowmon/settings.json`, so they travel with the vault.

| Setting               | Default    | Range | Affects                                                                           |
| --------------------- | ---------- | ----- | --------------------------------------------------------------------------------- |
| Session gap           | 30 minutes | 5–240 | How long a pause starts a new session; affects Session links and the timeline     |
| Max notes per session | 20 notes   | 2–200 | Sessions touching more notes are treated as bulk changes and get no Session links |
| Same-day window       | 0 days     | 0–7   | How many days apart still counts as Same day; 0 = the same day only               |

The same dialog has the Semantic link settings — see [Graph](graph.md#semantic-links).

Click **Save** and the graph updates immediately.

**Tuning tips**

- You often write a bit, step away, and come back → raise Session gap (to 60, say).
- You reorganize many notes in one sitting but get no Session links → raise Max notes per session.
- You want to see what happened in the same week → set Same-day window to 3–7.

## Good to know

- Written times are recorded **from when you start using Knowmon**. The first time you open an existing vault, each note gets one "created" entry using the file's creation time.
- If you edit a note many times in another editor while Knowmon is closed, it's recorded as a single edit at the file's last-modified time.
- The same kind of entry for the same note is recorded at most once every 60 seconds, so autosave doesn't flood the history.
- All dates use your computer's local time zone.
- The edit history lives in `.knowmon/events.jsonl`. It **cannot be rebuilt**, so don't delete it. See [Files and data](files-and-data.md).
