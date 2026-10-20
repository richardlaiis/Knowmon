# Notes and Editing

## Notes are files

Every `.md` file in your vault is a note, and **the file name is the note's title**. `Books/Atomic Habits.md` is titled "Atomic Habits".

That means you can:

- Edit notes in any other editor; Knowmon notices and updates.
- Add, move, or delete notes from your file manager or terminal; the file tree follows.
- Back up or sync the whole folder however you like — git, cloud drives, anything.

## Managing notes and folders

### Create

- The "New note" and "New folder" icons at the top of the left sidebar create items at the vault root.
- Right-click a folder in the file tree → **New note** / **New folder** to create inside it.

A name box appears in the file tree. The item is only created when you press `Enter` (or click elsewhere); `Esc` or an empty name cancels. Two notes in the same folder can't share a name (ignoring case).

> You can also write a `[[link]]` to a note that doesn't exist yet and `Ctrl`+click it. See [Links](links.md).

### Rename

Right-click → **Rename**. `Enter` confirms, `Esc` cancels. If the note is open, its tab stays open with the cursor and undo history intact, and its edit history follows the new name.

> **Heads up**: renaming does **not** rewrite `[[Old name]]` links in other notes. After a rename, links to the old name point to a note that doesn't exist.

### Move

Drag a note or folder onto another folder. Drop it on empty space in the file tree to move it to the root.

### Delete

Right-click → **Delete**. After you confirm, the file goes to your **system trash**, so you can restore it from there.

## Autosave

Knowmon saves about 0.5 seconds after you stop typing; `Ctrl+S` saves immediately. It also saves before you switch or close a tab, rename, delete, or switch vaults — you won't lose work.

### When a note changes outside Knowmon

If you edit an open note in another editor:

- **No** unsaved changes in Knowmon → the tab simply reloads with the new version.
- **You were typing too** → a bar appears above the note asking you to choose **Load external version** or **Keep my version**.

## Live preview

By default the editor uses **live preview**: Markdown symbols are hidden and you see formatted text. When the cursor reaches an element, its raw syntax appears so you can edit it.

- **Inline elements** (bold, italic, strikethrough, inline code, links, wikilinks): raw syntax shows when the cursor touches the element.
- **Block markers** (`#` for headings, `>` for quotes, list bullets, horizontal rules): raw syntax shows on the line the cursor is on.

Press `Ctrl+E` or the **Live preview / Source** button at the top right to switch to **source mode** and see plain Markdown. This preference is remembered.

### Supported Markdown

| Element         | Syntax                            | Notes                                |
| --------------- | --------------------------------- | ------------------------------------ |
| Headings        | `# Title`, `## Subtitle` …        | Six levels                           |
| Bold / italic   | `**bold**`, `*italic*`            |                                      |
| Strikethrough   | `~~gone~~`                        |                                      |
| Inline code     | `` `code` ``                      |                                      |
| Link            | `[text](https://example.com)`     | `Ctrl`+click to open in your browser |
| Wikilink        | `[[Note name]]`                   | See [Links](links.md)                |
| Lists           | `- item`, `1. item`               |                                      |
| Tasks           | `- [ ] to do`, `- [x] done`       | Click the checkbox to toggle         |
| Quote           | `> quote`                         |                                      |
| Horizontal rule | `---`                             |                                      |
| Code block      | ` ```python ` … ` ``` `           | Syntax highlighted by language       |
| Image           | `![caption](attachments/pic.png)` | See "Images" below                   |
| Frontmatter     | A `---` block at the top          | See [Properties](properties.md)      |

Tables and HTML are shown as plain text, not rendered.

### Code blocks

When the cursor is outside a code block, its ` ``` ` fences are hidden and the language name appears in the top-right corner. Most common languages are highlighted (each one loads the first time it appears); unknown languages show as plain text.

````markdown
```python
def greet(name):
    return f"Hello, {name}"
```
````

### External links

To avoid accidental clicks while typing, external links open only with **`Ctrl`+click**, in your system browser. Only `http`, `https`, and `mailto` links are allowed.

## Images

### Adding images

- **Paste**: take a screenshot and press `Ctrl+V` in a note.
- **Drag in**: drag an image file from your file manager into the editor.

The image is saved to an `attachments/` folder at the vault root, and image syntax is inserted at the cursor:

```markdown
![](<attachments/Pasted image 20261020143015.png>)
```

- The path is relative to the current note; it's wrapped in `< >` when the file name has spaces or parentheses.
- Pasted screenshots are named `Pasted image YYYYMMDDHHmmss.png`; dragged files keep their names.
- If the name is taken, a number is added — existing files are **never overwritten**.
- Each file can be up to 50 MB.
- If the clipboard also holds text, it's pasted as text.

### Image path rules

Knowmon supports only standard Markdown, `![caption](path)`, and the path must be **relative to the folder the note is in**:

| You write                                         | Shown?                                   |
| ------------------------------------------------- | ---------------------------------------- |
| `![](attachments/a.png)` (note at the root)       | ✓                                        |
| `![](../attachments/a.png)` (note in a subfolder) | ✓                                        |
| `![](<my image.png>)` or `![](my%20image.png)`    | ✓ either works for names with spaces     |
| `![](https://example.com/a.png)`                  | ✗ web images aren't shown                |
| `![](/home/me/a.png)`                             | ✗ absolute paths aren't supported        |
| `![[a.png]]`                                      | ✗ Obsidian-style embeds aren't supported |

If the file can't be found, you'll see a red "Image not found".

> **Tip**: if you move images out of `attachments` yourself, update the paths in your notes.

When the cursor isn't on the image's line, the syntax is replaced by the image; when it is, you see both. Source mode doesn't show images.

## Editing tips

A few handy editor commands (full list in [Keyboard shortcuts](shortcuts.md)):

| Shortcut                        | Action                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `Ctrl+F`                        | Find and replace in the note; `F3` / `Shift+F3` for next / previous |
| `Ctrl+D`                        | Select the next occurrence (multiple cursors)                       |
| `Alt+↑` / `Alt+↓`               | Move the line up / down                                             |
| `Shift+Alt+↑` / `Shift+Alt+↓`   | Duplicate the line                                                  |
| `Ctrl+Shift+K`                  | Delete the line                                                     |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Fold / unfold a heading, list, or code block                        |

> In many editors `Ctrl+G` means "find next". In Knowmon it opens the graph, so use `F3` instead.
