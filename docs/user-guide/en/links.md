# Links and Backlinks

Links are at the heart of Knowmon. Rather than burying notes in nested folders, link each idea to related ideas. Later, wherever you start, you can follow the links to everything connected.

## Writing a link

Wrap a note's name in double square brackets:

```markdown
This sounds a lot like "deliberate practice" from [[Deep Work]].
```

### Autocomplete

Type `[[` and a list of notes appears (with the folder each one is in):

- Keep typing to narrow it down, `↑` `↓` to choose, `Enter` to insert, `Esc` to close.
- Closed the menu and want it back? Press `Ctrl+Space`.
- Knowmon inserts **the shortest link that points to exactly that note** — usually just the name, like `[[Atomic Habits]]`. If two notes share a name, it includes the folder: `[[Books/Atomic Habits]]`.

### Other forms

| You write                      | Meaning                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `[[Atomic Habits]]`            | Link to the note named "Atomic Habits"                                               |
| `[[Books/Atomic Habits]]`      | Specify the folder, for notes with the same name                                     |
| `[[Atomic Habits\|that book]]` | Link to "Atomic Habits", displayed as "that book"                                    |
| `[[Atomic Habits#Chapter 3]]`  | Link to "Atomic Habits" (currently opens the note, without scrolling to the heading) |

### Opening a link

| Action             | Result                  |
| ------------------ | ----------------------- |
| `Ctrl`+click       | Open in the current tab |
| `Ctrl+Shift`+click | Open in a new tab       |

A plain click just moves the cursor, so you can edit the link text.

## Link first, write later

You can link to a note that **doesn't exist yet**. This is handy while writing: when a concept deserves its own note, write it as a `[[link]]` now and fill it in later.

`Ctrl`+clicking a link to a missing note creates it at the **vault root** and opens it. Every existing link to that name connects automatically.

**Example**: in "Deep Work", write

```markdown
This reminds me of [[attention residue]].
```

`Ctrl`+click it and you get a new "attention residue.md" whose Backlinks panel already lists "Deep Work".

## How links find their note

Knowmon resolves `[[some name]]` with these rules:

1. **Case-insensitive**: `[[english note]]` links to `English note.md`.
2. With a `/`, it matches the **end of the path**; otherwise just the **file name**.
3. If several notes match, the one with the **shortest path** wins, then alphabetical order.
4. The `.md` extension is optional.

## Renaming

Renaming a note does **not** update links in other notes. After renaming "Atomic Habits" to "Atomic Habits (book)", other notes' `[[Atomic Habits]]` links point to a note that doesn't exist. Search for the old name to find and fix them.

## Backlinks

The **Backlinks** tab in the right panel lists every note that links to the current one, showing **the line that contains the link** — so you can see the context without opening anything.

- Click to open the note in the current tab; `Ctrl`+click or middle-click for a new tab.
- When nothing links here yet, it shows "No notes link here yet."

**Example**: with "Deep Work" open, Backlinks might show:

- 2026-10-04 — "Read chapter 2 of [[Deep Work]]; thinking about tracking focus blocks."
- Reading list — "- [ ] [[Deep Work]]"
- Atomic Habits — "Works even better alongside [[Deep Work]]."

## Beyond written links

Knowmon also creates other kinds of connections. They show up in the graph, not in Backlinks:

- **Time links**: notes written together, notes about the same day, consecutive notes in a folder. See [Time context](time.md).
- **Semantic links**: notes with similar content (requires local AI). See [Graph](graph.md).
