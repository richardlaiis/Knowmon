# Workspace: tabs and resizable panels

User request (2026-10-07): browser-style tabs, where a tab can be a note or the graph; the widths of the file tree, editor and right panel can be dragged; the file tree and right panel can be toggled (similar to VS Code).

## Confirmed decisions (2026-10-07)

- Choosing a note in the file tree, search results, backlinks or the graph **replaces the current tab**; `Ctrl/Cmd+click` or middle-click opens a new tab. A note already open in a tab is switched to instead of opened again.
- No back/forward for tabs.
- Each vault remembers its open tabs and restores them when reopened (stored in the renderer's localStorage, not in the vault; notes that no longer exist are skipped).
- The right panel keeps its Backlinks / Local graph tabs, and the whole panel can be toggled.

## Tabs

- Tab kinds: note (`{ kind: 'note', path }`) and global graph (`{ kind: 'graph' }`). There is at most one graph tab (Cytoscape and the position cache only need one copy); `Ctrl/Cmd+G` switches to it, or opens a new one.
- Tab bar: shows the title and a close button; middle-click closes; drag to reorder; context menu "Close / Close others"; a "+" at the end opens the Quick switcher, and the chosen note opens in a new tab.
- Shortcuts: `Ctrl/Cmd+W` closes a tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` switch tabs, `Ctrl/Cmd+T` opens the Quick switcher (new tab), and `Ctrl/Cmd+Enter` in the Quick switcher opens in a new tab.
- Wikilinks: `Ctrl/Cmd+click` opens in the current tab (as now), `Ctrl/Cmd+Shift+click` opens a new tab.
- Each note tab has its own editor and reads its file only when first shown (so restoring many tabs doesn't read every file at once or record an `open` event for each), then stays mounted (hidden), so switching tabs keeps the cursor, scroll position and undo history.
- Rename/move: the paths of all tabs follow; delete: affected tabs are closed. External changes: the existing rules (reload if there's no unsaved content, otherwise show a bar in that tab) apply to every open tab.
- Tab state operations are pure functions (`src/renderer/src/workspace/tabs.ts`, with tests): open (replace or new tab), close (activate the tab to the right, or the left if none), move, rename, delete, serialize/validate on restore.

### Electron's Ctrl+W

"Close Window" in Electron's default menu is bound to `Ctrl/Cmd+W` and closes the window outright. The main process uses a custom application menu instead: it keeps the editing (copy/paste) and developer tools items and drops the `Ctrl/Cmd+W` shortcut, so the renderer can use it to close tabs. No IPC contract change is needed.

## Panels

- Layout: left file tree/search | tabs + editor | right panel. Both dividers can be dragged, with widths bounded above and below (the pure function `clampWidth`, with tests); double-clicking a divider restores the default width.
- Toggling: `Ctrl/Cmd+B` toggles the left sidebar and `Ctrl/Cmd+Alt+B` the right panel; there are also buttons at the right of the tab bar. These replace the old "Links" button in the title bar.
- Widths and visibility are stored in localStorage (`knowmon.layout`), shared by all vaults.
- When the graph tab is active, the right panel can still be opened and shows "no note open".

## Unchanged

- No changes to `src/shared/types.ts` or the IPC.
- Autosave keeps the existing `createAutosave` (only one tab receives input at a time, and it flushes before switching tabs).

## Tests

- `tabs.ts`: every opening scenario, the active tab after closing, opening twice, the single graph tab, renames (including folders), deletes, drag reordering, skipping missing notes and broken data on restore.
- `clampWidth` and reading/writing layout preferences.
- Running the real app (driven over CDP): open several tabs, undo still works after switching, Ctrl+W closes only the tab, drag dividers, toggle panels, tabs restored after reopening the vault.

## Order of work

1. Tab state pure functions + tests
2. Layout (dividers, toggling) + tests
3. Refactor App: tab bar, an editor per tab, restoring
4. Electron menu (Ctrl+W)
5. Verify in the running app, update the docs
