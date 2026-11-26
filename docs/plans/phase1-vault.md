# Phase 1 implementation plan: vault reading/writing and the editor

Done when: you can open a folder, edit and save Markdown, and external changes sync into the app.

## Confirmed decisions (2026-10-06)

- Fill in the skeleton missing from phase 0: main/renderer entry points, `vitest.config.ts`, sample notes in `test-vault/`.
- `src/shared/types.ts` uses the proposed version (`Note`, `NoteEvent`, `TreeNode`, `VaultChange`, `KnowmonAPI`). All paths are posix paths relative to the vault root.
- `note_events` are written both to `<vault>/.knowmon/events.jsonl` (append-only, the source of truth) and to SQLite (the index). After the DB is deleted, history can be rebuilt from the jsonl.

## Storage locations

| Data                | Location                                |
| ------------------- | --------------------------------------- |
| Last opened vault   | `app.getPath('userData')/settings.json` |
| Index database      | `<vault>/.knowmon/index.db`             |
| Editing history log | `<vault>/.knowmon/events.jsonl`         |

`.knowmon/` and every file/folder starting with a dot never appear in the file tree and aren't watched.

## Modules

- `src/main/settings.ts`: reads and writes settings.json.
- `src/main/vault/paths.ts`: normalizes relative paths and prevents escaping the vault (`..`, absolute paths, `.knowmon`).
- `src/main/vault/tree.ts`: scans folders to build `TreeNode`s and lists all `.md` files.
- `src/main/vault/watcher.ts`: a chokidar wrapper used only as a "something changed" trigger.
- `src/main/vault/index.ts`: the `Vault` class, coordinating files, the DB and the event log.
- `src/main/db/index.ts`: schema (following the roadmap's target schema; vector tables wait for phase 5) and queries.
- `src/main/db/events-log.ts`: reading, writing and replaying the jsonl.
- `src/main/ipc.ts`: IPC handlers; `src/shared/channels.ts`: channel name constants.
- Renderer: `src/renderer/src/` (App, file tree), `src/renderer/editor/` (the CodeMirror component).

## Sync strategy: reconcile

External changes always go through the same path, `reconcile()`: walk the vault and compare it with the `notes` table.

1. Files whose mtime and size match the DB are skipped without reading their content (incremental).
2. Other files get a sha256: the same hash only updates the mtime; a different hash records an `edit`.
3. Files in the DB but not on disk are treated as renamed if their hash matches a new file (keeping their history); otherwise they are deleted.
4. Files on disk but not in the DB are added with a `create` (using the birthtime).

chokidar events trigger reconcile with a 200 ms debounce, and changes are pushed to the renderer through `vault:changed`. The app's own writes update the hash/mtime in the DB right after writing, so watcher echoes are skipped in step 1.

Create, rename and delete inside the app update the DB and the log directly, without guessing from hashes. Deleting moves files to the system trash (`shell.trashItem`).

## note_events rules

- `create`: created in the app, or reconcile found a new file (this includes the first time an existing vault is opened; uses the birthtime).
- `edit`: saved in the app, or reconcile found a changed hash.
- `open`: `notes.read()`.
- For the same note and event kind, only one event is recorded per 60 seconds (autosave is frequent; phase 4 sessions default to 30 minutes, so one-minute granularity is enough).

events.jsonl format (one entry per line):

```
{"ts":1759730000000,"kind":"edit","path":"日記/2026-10-06.md"}
{"ts":1759730000000,"op":"rename","from":"a.md","to":"b.md"}
{"ts":1759730000000,"op":"delete","path":"b.md"}
```

Rebuilding: when `note_events` is empty and the jsonl exists, replay the log in order (rename moves history, delete clears it), then write the notes that currently exist.

## Renderer

- On startup, `vault.getCurrent()`; with no vault, show "Open folder".
- File tree: click to open; the context menu can create a note, rename and delete.
- Editor: CodeMirror 6 + `@codemirror/lang-markdown`, autosaving 500 ms after typing stops, `Ctrl/Cmd+S` saves immediately, and it flushes before switching notes.
- External change to the current note: reload directly if there's no unsaved content; otherwise show a bar letting the user choose between reloading and keeping theirs.

## Tests

- `paths`, `tree`, `settings`, `events-log` (replay), `db` queries, `Vault` (create/rename/delete/reconcile/event throttling/DB rebuild).
- Pure renderer functions (the autosave debouncer, tree path helpers).
- Manual checks with `test-vault/`.
