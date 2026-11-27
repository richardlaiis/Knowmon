# Files and Data

Knowmon's guiding principle: **your notes are always your own Markdown files**. This page explains what Knowmon stores where, what's safe to delete, and what to back up.

## Vault layout

```
My Notes/                  ← the vault (the folder you chose)
├── Welcome.md
├── Journal/
│   ├── 2026-10-05.md
│   └── 2026-10-06.md
├── Books/
│   └── Atomic Habits.md
├── attachments/           ← pasted or dragged-in images
│   └── Pasted image 20261020143015.png
└── .knowmon/              ← Knowmon's own data (hidden)
    ├── events.jsonl       ← edit history
    ├── index.db           ← index database
    └── settings.json      ← this vault's settings
```

## What each file is

| Data           | Location                                 | Safe to delete?                      |
| -------------- | ---------------------------------------- | ------------------------------------ |
| Notes          | `.md` files in the vault                 | They _are_ your data                 |
| Images         | Usually `attachments/`                   | They _are_ your data                 |
| Edit history   | `.knowmon/events.jsonl`                  | **No** — it can't be recovered       |
| Index database | `.knowmon/index.db`                      | Yes; rebuilt automatically next time |
| Vault settings | `.knowmon/settings.json`                 | Yes; defaults are restored           |
| App settings   | Linux: `~/.config/knowmon/settings.json` | Yes; defaults are restored           |

### Edit history (events.jsonl)

This file records when you created, edited, and opened each note. It powers [time context](time.md): Session links, the timeline's Written mode, and the graph's written-time filter.

It **can only be recorded as things happen** — there's no way to reconstruct it from your notes later — so treat it as being as important as the notes themselves. It's append-only; earlier entries are never rewritten.

### Index database (index.db)

Holds links, the full-text index, semantic vectors, and so on — all of it can be regenerated from your notes and edit history. If something seems off (odd search results, say):

1. Quit Knowmon.
2. Delete `.knowmon/index.db` (and `index.db-wal` / `index.db-shm` if present).
3. Reopen the vault.

Knowmon rebuilds the index automatically; semantic vectors are recomputed in the background (requires Ollama).

### Where settings live

| Settings                                                              | Stored in                | Scope                       |
| --------------------------------------------------------------------- | ------------------------ | --------------------------- |
| Time and Semantic link settings                                       | `.knowmon/settings.json` | Travels with this vault     |
| Ollama address, models, last vault                                    | App settings file        | All vaults on this computer |
| Theme, panel widths, graph options, search mode, other UI preferences | App's internal storage   | This computer               |
| Open tabs                                                             | App's internal storage   | One set per vault           |

## Backup and sync

- **Backups**: back up the whole vault folder, **including `.knowmon/events.jsonl`**. `index.db` can be skipped.
- **git**: add `.knowmon/index.db*` to `.gitignore`; commit everything else.
- **Cloud sync** (Dropbox, Syncthing, …): works, but avoid having the same vault open on two computers **at the same time**, or `events.jsonl` may conflict.

```gitignore
.knowmon/index.db*
```

## Using other tools

- **Other editors**: edit notes in VS Code, Vim, Typora, or anything else at any time. If Knowmon is open it picks up changes immediately; if not, it catches up the next time you open the vault.
- **Obsidian**: Knowmon uses the same `[[wikilink]]` and frontmatter conventions, so one folder can be used by both. Knowmon ignores the `.obsidian` folder. Note that Knowmon doesn't render `![[embed]]` image syntax.
- **File manager**: create, delete, and move notes directly in your file manager; Knowmon updates on its own. If you move or rename a note outside Knowmon without changing its content, Knowmon recognizes it as the same note and keeps its edit history.

## What's ignored

- Files and folders whose names start with `.` (`.knowmon`, `.obsidian`, `.git`, `.trash`, …) are hidden and not indexed.
- The file tree shows only `.md` files.

## Deleting and the trash

Deleting a note in Knowmon moves it to your **system trash**, where you can restore it. If the vault is somewhere without trash support (such as `/tmp` on Linux), deletion fails with "Failed to move item to trash" — Knowmon won't fall back to permanent deletion.
