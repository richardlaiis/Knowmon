# Quickstart

This page takes you from opening Knowmon to a small set of linked notes in about five minutes. If you haven't installed it yet, start with [Installation](installation.md).

> Shortcuts in this guide are written for Windows and Linux. On macOS, use `Cmd` instead of `Ctrl` (except for `Ctrl+Tab`).

## 1. Pick a vault

The first time you open Knowmon you'll see a welcome screen. Click **Open folder** and choose a folder:

- An **empty folder** to start fresh, or
- **A folder that already has Markdown notes** (an old Obsidian vault, for example). Knowmon reads every `.md` file and builds an index. It doesn't change your files.

That folder is now your **vault**. To switch vaults later, click the vault name in the top-left corner.

> **Tip**: Knowmon doesn't reopen your last vault automatically, but the folder picker starts in your last vault's location, so it's one click away.

## 2. Create your first note

Click the "New note" icon at the top of the left sidebar (or right-click the file tree → **New note**), type a name such as `Reading list`, and press `Enter`.

The note opens in a new tab. Start typing:

```markdown
# Reading list

- [ ] Atomic Habits
- [ ] Deep Work
```

**There's no need to save.** Knowmon saves about half a second after you stop typing. Press `Ctrl+S` if you want to save right away.

## 3. Connect notes with `[[links]]`

Change the list to:

```markdown
- [ ] [[Atomic Habits]]
- [ ] [[Deep Work]]
```

When you type `[[`, a menu suggests existing note names. It's fine that these notes don't exist yet: hold `Ctrl` and click `[[Atomic Habits]]`, and Knowmon creates the note at the root of your vault and opens it.

Write a few thoughts in "Atomic Habits", then look at **Backlinks** in the right panel. It lists "Reading list" along with the line containing the link. That's a backlink — you never have to write the link in both directions.

## 4. Write a journal entry

Create a note whose name starts with a date, for example `2026-10-20`:

```markdown
# 2026-10-20

Finished chapter 3 of [[Atomic Habits]]. Want to try habit stacking.
```

The date at the start of the file name is this note's **event date**. Write a few days' worth and press `Ctrl+Shift+T` to open the **Timeline** and browse by date. Dated notes in the same folder are also chained together in the graph by **Sequence** links. See [Time context](time.md).

## 5. Find your notes

| To…                                 | Do this                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| Jump to a note you know the name of | `Ctrl+O` for the Quick switcher, type a few letters, `Enter` |
| Find a word inside your notes       | `Ctrl+Shift+F` to search                                     |
| See how notes relate                | `Ctrl+G` for the graph                                       |
| Look back over time                 | `Ctrl+Shift+T` for the timeline                              |

## 6. (Optional) Turn on local AI

Install [Ollama](https://ollama.com) and download two models:

```bash
ollama pull bge-m3      # understands what your notes mean (embeddings)
ollama pull qwen3:8b    # writes summaries, answers, and runs Agent tasks
```

While Ollama is running, the bottom of the left sidebar changes from "Indexing …" to **AI ready**. Then try:

- With a note open, press `Ctrl+Shift+S` to summarize it.
- Press `Ctrl+Shift+A` and ask "What did I think about Atomic Habits?" — the answer comes from your notes, with sources.

See [Setting up local AI](ai-setup.md).

## Next steps

- [Interface tour](interface.md): what each panel does
- [Notes and editing](notes-and-editing.md): Markdown syntax and editing tips
- [Keyboard shortcuts](shortcuts.md): the full list
