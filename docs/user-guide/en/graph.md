# Graph

The graph draws every note as a dot and every connection as a line. At a glance you can see which ideas cluster together, which notes are hubs, and which are still on their own.

Knowmon has two graphs:

- **Global graph**: the whole vault, in a tab in the main area (`Ctrl+G`).
- **Local graph**: just the neighborhood of the current note, in the right panel's **Local graph** tab.

## Global graph

Press `Ctrl+G` or click **Graph** in the left sidebar. The graph is a tab, and there's only ever one. Switch away and back and it's exactly as you left it — no recomputing.

### Controls

| Action              | Result                                 |
| ------------------- | -------------------------------------- |
| Scroll              | Zoom                                   |
| Drag the background | Pan                                    |
| Drag a node         | Move that node                         |
| Hover a node        | Highlight the note and its connections |
| Click a node        | Open the note in the current tab       |
| `Ctrl`+click a node | Open in a new tab                      |

Bigger nodes have more connections. Notes that don't exist yet (only mentioned in `[[links]]`) aren't shown.

### Toolbar

| Item                  | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `12 notes · 18 edges` | What's shown; with a filter active it reads "8 of 12 notes"                 |
| Edge type buttons     | Turn each kind of line on or off — see below                                |
| **Labels**            | Show or hide note names (names also hide automatically when zoomed far out) |
| **Fit**               | Zoom to fit everything                                                      |
| **Re-layout**         | Throw away the current positions and lay out again                          |
| **Settings**          | Time and Semantic link settings — see [Time context](time.md#settings)      |

Below the toolbar is the **time range slider** — see "Filtering by time" below.

### Layout

Layout runs in the background; with many notes the toolbar shows "Laying out… 40%", and you can use the graph meanwhile. Node positions are remembered until you quit; a new note is placed next to its neighbors instead of reshuffling everything. Labels are laid out so they never overlap, at any zoom level.

If the layout gets messy, click **Re-layout**.

## Kinds of lines

Each edge type button shows that type's line style. Click to toggle; your choice is remembered.

| Button       | Type              | A line appears when…                                                 |
| ------------ | ----------------- | -------------------------------------------------------------------- |
| **Links**    | Wikilink          | One note contains `[[the other]]`; more mentions make a thicker line |
| **Session**  | Same work session | Both notes were edited in the same work session                      |
| **Same day** | Same day          | Both notes have the same event date (or within a set number of days) |
| **Sequence** | Previous / next   | The notes are neighbors by event date within the same folder         |
| **Semantic** | Similar content   | The notes' content is similar in meaning (requires local AI)         |

The rules for Session, Same day, and Sequence are explained in [Time context](time.md).

**Turning a type off also removes it from the layout**, so the graph shifts slightly — but it starts from the current positions rather than reshuffling.

> **Try this**: show only Links to see the structure you built by hand. Show only Session to see which topics you tend to think about together. Show only Semantic to find notes that are related but not yet linked — often worth adding a `[[link]]`.

### Semantic links

> Requires [local AI](ai-setup.md), and the background index must be finished (the sidebar says AI ready).

Knowmon compares notes using an embedding model. Each note links to at most its 5 most similar notes, and only if the similarity reaches a threshold (0.65 by default). Both are adjustable under **Settings**:

| Setting              | Default | Range    | Meaning                                               |
| -------------------- | ------- | -------- | ----------------------------------------------------- |
| Similarity threshold | 0.65    | 0.3–0.95 | Higher = stricter, fewer lines                        |
| Max per note         | 5       | 1–20     | How many of its most similar notes each note links to |

## Filtering by time

The time bar below the toolbar temporarily hides notes outside a period. It **only hides nodes; the layout doesn't change** — notes appear and disappear in place, so dragging the slider shows your network growing over time.

| Item                                     | What it does                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Time menu (**Event date** / **Written**) | Which time to filter by: the date a note is about, or when you wrote it |
| Slider                                   | Drag either end to set the range                                        |
| **Undated**                              | Checked: notes without a date always show. Unchecked: they're hidden    |
| **Reset**                                | Restore the full range and show undated notes                           |

For the difference between the two kinds of time, see [Time context](time.md#two-kinds-of-time).

**Example**: choose Written, drag the slider to last week, and uncheck Undated. Now the graph shows only notes you touched last week — where your attention went.

> With the slider at full range and Undated checked (the default), both time menus show the same thing. That's expected.

## Local graph

Switch the right panel to **Local graph**. It's centered on the current note (highlighted in the accent color), shows only nearby notes, and follows you as you switch notes.

| Item              | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| **Depth** (1–3)   | How far out to go: 1 = directly connected, 2 = neighbors of neighbors, … |
| **Fit**           | Zoom to fit everything                                                   |
| Edge type buttons | Same as the global graph, but set independently                          |

The local graph **filters edge types first, then finds neighbors**. Show only Sequence, for example, and the local graph follows previous/next links — a chain of journal entries.

## Known limitations

- Sequence links have a direction (earlier → later), but no arrowheads are drawn.
- When two notes are connected in several ways, the lines overlap and only the top one is visible.
