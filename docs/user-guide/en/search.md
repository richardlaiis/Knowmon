# Search and Quick Switcher

There are two ways to find a note:

- **Quick switcher** (`Ctrl+O`): fastest when you **know the note's name**.
- **Search** (`Ctrl+Shift+F`): for words **inside** notes, or for finding notes by meaning.

## Quick switcher

Press `Ctrl+O` (or **Go to…** in the left sidebar) and type part of a note's name:

- Matching is fuzzy: you don't need the whole name, or even consecutive letters. `dpwk` finds "Deep Work".
- With nothing typed, **recently opened notes** come first, so flipping between notes is quick.
- Each result shows the folder it's in.

| Key                            | Action                  |
| ------------------------------ | ----------------------- |
| `↑` `↓` (or `Ctrl+N` `Ctrl+P`) | Choose                  |
| `Enter`                        | Open in the current tab |
| `Ctrl+Enter`                   | Open in a new tab       |
| `Esc`                          | Close                   |

`Ctrl+T` (or the "+" in the tab bar) opens the Quick switcher in "new tab" mode, where `Enter` opens in a new tab.

## The search panel

Press `Ctrl+Shift+F` (or **Search** in the left sidebar). If the sidebar is hidden, it opens. Below the search box you can switch between two modes.

### Keyword

Results update as you type. Best when you know a word that appears in the note.

- **Separate words with spaces; all of them must appear.** `habit cue` finds notes containing both "habit" and "cue".
- **Works for Chinese and other languages without spaces**, including two-character words, and for mixed text.
- **Title matches come first**, then the rest by relevance.
- Each result shows its folder and a snippet with the matching words highlighted.
- Searches titles and note bodies, **not** frontmatter properties.

| Key                           | Action                              |
| ----------------------------- | ----------------------------------- |
| `Enter`                       | Open the first result               |
| `Esc`                         | Clear the search box                |
| Click / `Ctrl`+click a result | Open in the current tab / a new tab |

### Hybrid: search by meaning

> Requires [local AI](ai-setup.md).

Sometimes you remember roughly what a note was about, but not the words you used. Hybrid mode combines three methods:

1. **Full text**: word matches, like Keyword mode.
2. **Meaning**: a local embedding model finds passages with similar meaning, even when the wording is completely different.
3. **Graph neighbors**: notes linked from the top results get a boost.

Type a question or description and **press `Enter`** to search (it takes a moment, so it doesn't run as you type). Once results appear, press `Enter` again to open the first one.

Labels on each result explain why it was found:

| Label       | Meaning                               |
| ----------- | ------------------------------------- |
| **meaning** | Similar meaning (vector match)        |
| **text**    | Matching words (full-text match)      |
| **linked**  | Linked from another high-scoring note |

Clicking a result opens the note and **scrolls to the most relevant passage**.

**Example**: search `ways to build good habits`. Even if no note contains those words, "Atomic Habits" appears near the top, labeled meaning.

#### Date range

In Hybrid mode, two date fields next to the search box restrict results to a period. Knowmon uses each note's **event date** (the [`date` property](properties.md) or a dated file name), falling back to its last-modified date.

Set the dates, then press `Enter`.

#### When AI is offline

If Ollama isn't running or the semantic index isn't ready, Hybrid falls back to keyword results and says "Semantic search is unavailable right now; showing keyword matches."

## Which should I use?

| Situation                                             | Use                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| "I have a note called 'Weekly sync'"                  | `Ctrl+O`                                                         |
| "I know I wrote the word `bm25` somewhere"            | Search → Keyword                                                 |
| "I think I wrote something about focus"               | Search → Hybrid                                                  |
| "What did I think about the books I read last month?" | Chat in the AI tab — see [Summary and Chat](summary-and-chat.md) |
