# Keyboard Shortcuts

On macOS, use `Cmd` instead of `Ctrl` (except for `Ctrl+Tab`).

## Global

These work everywhere, including inside the editor, and take priority over editor shortcuts with the same keys.

### Navigation

| Shortcut       | Action                                                       |
| -------------- | ------------------------------------------------------------ |
| `Ctrl+O`       | Quick switcher: find a note by name, open in the current tab |
| `Ctrl+T`       | Quick switcher, open in a new tab                            |
| `Ctrl+Shift+F` | Search (opens the left sidebar if hidden)                    |
| `Ctrl+G`       | Graph tab                                                    |
| `Ctrl+Shift+T` | Timeline tab                                                 |

### Tabs and panels

| Shortcut                      | Action                            |
| ----------------------------- | --------------------------------- |
| `Ctrl+W`                      | Close the current tab             |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab               |
| `Ctrl+B`                      | Toggle the left sidebar           |
| `Ctrl+Alt+B`                  | Toggle the right panel            |
| `Ctrl+E`                      | Toggle live preview / source mode |

### AI

| Shortcut       | Action                                                |
| -------------- | ----------------------------------------------------- |
| `Ctrl+Shift+S` | Summarize the current note, or just the selected text |
| `Ctrl+Shift+A` | Open Chat and focus the input                         |
| `Ctrl+Shift+G` | Open the Agent and focus the input                    |

## Editor

### Knowmon-specific

| Shortcut                      | Action                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| `Ctrl+S`                      | Save now (otherwise saves 0.5 s after you stop typing)                      |
| Type `[[`                     | Note name suggestions: `↑` `↓` to choose, `Enter` to insert, `Esc` to close |
| `Ctrl+Space`                  | Show suggestions manually                                                   |
| `Ctrl`+click `[[link]]`       | Open in the current tab; creates the note at the vault root if missing      |
| `Ctrl+Shift`+click `[[link]]` | Open in a new tab                                                           |
| `Ctrl`+click an external link | Open in your system browser (http, https, mailto only)                      |
| Click a checkbox              | Toggle `- [ ]` / `- [x]` (live preview)                                     |
| `Ctrl+V` an image             | Paste the image, saved into `attachments/`                                  |

### Text editing

| Shortcut                        | Action                                           |
| ------------------------------- | ------------------------------------------------ |
| `Ctrl+Z`                        | Undo                                             |
| `Ctrl+Y` or `Ctrl+Shift+Z`      | Redo (macOS: `Cmd+Shift+Z`)                      |
| `Ctrl+F`                        | Find and replace in the note                     |
| `F3` / `Shift+F3`               | Find next / previous                             |
| `Ctrl+D`                        | Select the next occurrence                       |
| `Alt+↑` / `Alt+↓`               | Move line up / down                              |
| `Shift+Alt+↑` / `Shift+Alt+↓`   | Duplicate line up / down                         |
| `Ctrl+Shift+K`                  | Delete line                                      |
| `Ctrl+]` / `Ctrl+[`             | Indent / outdent                                 |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Fold / unfold (macOS: `Cmd+Alt+[` / `Cmd+Alt+]`) |
| `Ctrl+/`                        | Toggle comment (`<!-- -->`)                      |

> `Ctrl+G` opens the graph in Knowmon, so use `F3` for "find next".

## Quick switcher and search box

| Shortcut                       | Action                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `↑` `↓` (or `Ctrl+N` `Ctrl+P`) | Choose in the Quick switcher                                                                     |
| `Enter`                        | Open (search box: open the first result; in Hybrid mode, search first, then press again to open) |
| `Ctrl+Enter`                   | Open in a new tab                                                                                |
| `Esc`                          | Close the Quick switcher / clear the search box                                                  |

## Chat and Agent input

| Shortcut      | Action   |
| ------------- | -------- |
| `Enter`       | Send     |
| `Shift+Enter` | New line |

`Enter` pressed while composing with an input method doesn't send.

## Mouse

| Action                                                               | Result                                             |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| Click a note (file tree, search results, backlinks, graph, timeline) | Open in the current tab                            |
| `Ctrl`+click or middle-click                                         | Open in a new tab (graph nodes: `Ctrl`+click only) |
| Right-click the file tree                                            | New note, New folder, Rename, Delete               |
| Drag a note or folder in the file tree                               | Move it to another folder                          |
| Middle-click a tab                                                   | Close it                                           |
| Drag a tab                                                           | Reorder                                            |
| Right-click a tab                                                    | Close / Close others                               |
| Drag a divider between panels                                        | Resize; double-click to reset                      |
| Graph: scroll / drag background / drag node                          | Zoom / pan / move node                             |

## Application

| Shortcut | Action                                |
| -------- | ------------------------------------- |
| `Alt`    | Show the menu bar (hidden by default) |
| `Ctrl+Q` | Quit                                  |
| `F11`    | Full screen                           |
| `Ctrl+M` | Minimize                              |
