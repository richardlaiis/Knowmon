# Interface Tour

Once a vault is open, the Knowmon window has three columns:

```
┌──────────────┬──────────────────────────────────┬──────────────────┐
│ Left sidebar │ Tab bar                          │ Right panel      │
│              ├──────────────────────────────────┤                  │
│ Vault name   │                                  │ Backlinks        │
│ Files│Search │   Editor / Graph / Timeline      │ Local graph      │
│ Graph│Timeline│                                 │ AI               │
│ Go to…       │                                  │                  │
│              │                                  │                  │
│ File tree    │                                  │                  │
│ or results   │                                  │                  │
│              │                                  │                  │
│ AI status    │                                  │                  │
└──────────────┴──────────────────────────────────┴──────────────────┘
```

Drag the dividers between columns to resize them; **double-click a divider** to restore its default width. Both side columns can be hidden (`Ctrl+B`, `Ctrl+Alt+B`, or the buttons at either end of the tab bar). Widths and visibility are remembered.

## Left sidebar

### Header

| Element         | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| Vault name      | Hover to see the full path; click to switch to another vault |
| New note icon   | Create a note at the vault root                              |
| New folder icon | Create a folder at the vault root                            |
| Moon / sun icon | Switch between dark and light themes                         |

### Navigation buttons

| Button       | What it does                                                         |
| ------------ | -------------------------------------------------------------------- |
| **Files**    | Show the file tree                                                   |
| **Search**   | Show the search panel (`Ctrl+Shift+F`) — see [Search](search.md)     |
| **Graph**    | Open the graph tab (`Ctrl+G`) — see [Graph](graph.md)                |
| **Timeline** | Open the timeline tab (`Ctrl+Shift+T`) — see [Time context](time.md) |
| **Go to…**   | Open the Quick switcher (`Ctrl+O`)                                   |

### File tree

- Folders come first. Only `.md` notes are listed — images and other files aren't shown (though folders holding them are).
- Files and folders whose names start with `.` (like `.git`, `.obsidian`, `.knowmon`) are hidden.
- **Right-click** for New note, New folder (created inside the folder you clicked), Rename, and Delete.
- **Drag** a note or folder onto another folder to move it; drop on empty space to move it to the root. Hover over a collapsed folder for about 0.6 seconds while dragging and it opens.

### AI status

The bottom of the sidebar shows the status of local AI. Click it to open the AI tab.

| Shows                   | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| AI: checking…           | Checking for Ollama                                           |
| AI offline              | Can't reach Ollama; nothing else is affected                  |
| Indexing 12/40          | Building the semantic index in the background                 |
| AI ready                | All set                                                       |
| AI: needs attention     | Something's wrong, such as a missing model; hover for details |
| Agent: confirm a change | The Agent is waiting for you to approve a change              |

## Center: tabs and the main area

The main area holds tabs of three kinds:

- **Note**: one editor per note. A note only ever has one tab; opening it again switches to that tab.
- **Graph**: the whole-vault graph. At most one.
- **Timeline**: browse notes by time. At most one.

### How notes open

**Clicking** a note in the file tree, search results, backlinks, graph, or timeline **replaces the current tab**. **`Ctrl`+click** (or middle-click) **opens it in a new tab**. Newly created notes always open in a new tab.

This keeps tabs from piling up while you browse; open a new tab on purpose when you want to compare.

### Tab bar

| Action                        | Result                   |
| ----------------------------- | ------------------------ |
| Drag a tab                    | Reorder                  |
| Middle-click a tab / `Ctrl+W` | Close                    |
| Right-click a tab             | Close / Close others     |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab      |
| "+" button / `Ctrl+T`         | Open a note in a new tab |

Tabs are remembered: close Knowmon, reopen the same vault, and your tabs are back (each vault keeps its own set).

### Note tab header

| Button                    | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| **Summarize**             | Summarize this note (or the selected text) with AI, `Ctrl+Shift+S` |
| **Live preview / Source** | Toggle live preview and source mode, `Ctrl+E`                      |

## Right panel

The right panel follows the **current note tab**. It has three tabs:

| Tab             | Contents                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Backlinks**   | Notes that link here, with the line containing each link. See [Links](links.md)                                      |
| **Local graph** | A small graph centered on the current note. See [Graph](graph.md)                                                    |
| **AI**          | Chat, Agent, Summary, plus AI status and settings. See [Summary and Chat](summary-and-chat.md) and [Agent](agent.md) |

When the current tab is the graph or timeline, Backlinks and Local graph show "No note is open in this tab."

## Themes

Knowmon has two themes: a warm off-white light theme and a deep dark theme (with Nord colors for code). Switch with the moon / sun icon at the top left. Your choice is remembered, and the graph follows it.

## Menu bar

The menu bar is hidden by default. Press `Alt` to show it.
