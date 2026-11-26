# UI improvements: logo and icons

## Context

The app icon is currently Electron's default atom (`build/icon.*`, `resources/icon.png`); the welcome page is just one `<h1>Knowmon</h1>`; the sidebar and right panel tabs are plain text buttons; the file tree uses the characters `▸ ▾`; and the tab bar's `×` and `+` are characters too. Icon SVGs are scattered across `App.tsx` (`NewNoteIcon`, `NewFolderIcon`, `MoonIcon`, `SunIcon`, `iconProps`) and `TabBar.tsx` (`SidebarIcon`).

Goals (chosen by the user, 2026-11-13):

- The logo is "B: dark + time orbit": a Polar Night rounded square with a K made of connected nodes (the note graph) and an outer ring of dotted marks (time context); the top-right node is Frost cyan `#88c0d0` and the bottom-right node purple `#b48ead`. The final version is `build/icon.svg`.
- Full scope: the app icon, the welcome and empty pages, icons in the sidebar and tabs, and file tree icons.

Constraints: no changes to `types.ts`, IPC or the DB; **no new dependencies** (all icons are hand-written inline SVGs in the existing 24×24, `currentColor`, stroke 1.8 style; no package such as lucide). No shortcut changes, so shortcuts.md is untouched.

## Implementation

### 1. Logo source and app icons

- Add `build/icon.svg` (the final logo on a 1024 viewBox, refined from draft B so the outer dots stay visible at small sizes).
- Add `scripts/gen-icons.mjs`: it calls the system `magick` (ImageMagick, not an npm dependency) to convert the SVG into
  - `build/icon.png` (1024×1024) and `resources/icon.png` (512, the Linux window icon, already referenced by `src/main/index.ts`)
  - `build/icon.ico` (multiple sizes: 16/24/32/48/64/128/256)
  - `build/icon.icns`: assembled in Node (a header plus four PNG chunks, `ic07/ic08/ic09/ic10`; the format is simple), with no need for `iconutil`.
- The generated files are committed (packaging doesn't depend on ImageMagick); the README's developer section gets a line: "after changing the logo, run `node scripts/gen-icons.mjs`".

### 2. Centralized icon components: `src/renderer/src/components/icons.tsx` (new)

- A shared `Icon` frame (`iconProps` moves here; `aria-hidden`, 18px by default, accepts `size`).
- Move the existing icons in from `App.tsx` and `TabBar.tsx`: NewNote, NewFolder, Moon, Sun, Sidebar.
- New: Files, Search, Graph (three connected nodes), Timeline (an axis with tick marks), GoTo (command/arrow), Backlinks (a reversed arrow link), LocalGraph, Sparkle (AI), Note (document), Folder/FolderOpen, Chevron (rotated to show expanded), Close, Plus, FolderOpen (for the welcome page button).
- `Logo` component: an inline SVG version of the logo (the same shapes as `build/icon.svg`) with `role="img"` + `aria-label="Knowmon"`. Inline rather than an imported image, so the CSP doesn't change.

### 3. Welcome page (the `!vault` branch in `App.tsx`)

- A 96px logo, the `Knowmon` title, a one-line tagline (along the lines of "Notes linked by what you wrote together, not just by links."; finalize during implementation), and a primary "folder icon + Open folder" button. The theme toggle at the top right stays.
- CSS: `.welcome` centered with a card-like feel (no background box; hierarchy comes from spacing and type sizes), with adjusted title weight and letter spacing.

### 4. Empty page (no tabs open)

- A faded logo (`opacity` controlled by a variable so it suits both themes) plus the existing hint text.
- Shortcuts become a two-column list: `<kbd>Ctrl</kbd>+<kbd>O</kbd>` on the left and the description on the right (Go to note / Search / Graph / Timeline / Summarize). The list data lives in `src/renderer/src/lib/shortcutHints.ts` (plain data plus a function that splits `"Ctrl+Shift+F"` into keys, showing `⌘` on a Mac), so it can be tested.
- New `kbd` style (`--code-bg` background, `--border` border, small radius).

### 5. Sidebar and right panel tabs

- Left `.sidebar-tabs`: Files / Search / Graph / Timeline / Go to…, each button "icon + text".
- Right `.side-tabs`: Backlinks / Local graph / AI likewise; AI's `attention-dot` stays.
- Narrow widths: `.sidebar` and `.side-panel` set `container-type: inline-size`, and when too narrow (about < 300px; tune against `PANE_LIMITS` when implementing) `@container` hides the text and leaves only icons (the `title` already explains each; add `aria-label` for accessibility).
- Sidebar header: an 18px logo before the vault name.

### 6. Tab bar (`TabBar.tsx`)

- A type icon before each tab title: note → Note, graph → Graph, timeline → Timeline (mapping directly from `Tab.kind` in `tabs.ts`, without changing the tabs model).
- `×` becomes the Close icon and `+` the Plus icon, keeping the same size and click area.

### 7. File tree (`FileTree.tsx`)

- `▸ ▾` become a Chevron SVG (`rotate(90deg)` with a short transition when expanded).
- Folders show the Folder/FolderOpen icon and notes the Note icon (`--muted` color, `--fg` on the selected row); the input row for new items shows the matching icon too.
- `.tree-icon` widens from 12px to fit the chevron plus the type icon, keeping the `8 + depth * 14` indent.

### 8. Other small polish (only within the components above)

- Consistent hover/active states for icon buttons (the `.icon` class), with a `--accent` outline for `:focus-visible`.
- The editor, graph, timeline and AI panel layouts are untouched.

## Tests (vitest, `src/**/*.test.ts`, node environment)

- `src/renderer/src/components/icons.test.ts`: using `renderToStaticMarkup` from `react-dom/server` + `createElement`, check that every exported icon outputs `<svg aria-hidden="true">`, uses `currentColor`, and honors `size`; `Logo` has `role="img"` and `aria-label`.
- `src/renderer/src/lib/shortcutHints.test.ts`: splitting keys (`Ctrl+Shift+F` → `['Ctrl','Shift','F']`) and `Ctrl` → `⌘` on a Mac.
- Extract the ICNS assembly in `scripts/gen-icons.mjs` into an importable function and test its header (the `icns` magic, total length, each chunk's type/length). If scripts aren't in vitest's include list, put the test in `scripts/` and add `scripts/**/*.test.mjs` to the include in `vitest.config.ts` (needs your approval; otherwise verify manually).

## Documentation

- `docs/architecture.md` Renderer section: icons are centralized in `components/icons.tsx`, hand-written SVGs with no package; the logo source is `build/icon.svg` and `scripts/gen-icons.mjs` generates the platform icons; a narrow sidebar shows only icons (container query).
- `docs/roadmap.md`: check off / add this item.
- If the user guide has screenshots or text describing "Files/Search text tabs", update the text to match.

## Verification

1. `npx vitest run`, `npm run typecheck` and `npm run lint` all pass.
2. After `node scripts/gen-icons.mjs`, look at `build/icon.png`, confirm the multiple sizes with `magick identify build/icon.ico`, and run `file build/icon.icns`.
3. `cp -r test-vault ~/knowmon-test-vault` → `npm run dev`: take screenshots of the welcome page, empty page, sidebar (wide/narrow), right panel, tab bar and file tree expanding/collapsing, once in each theme; confirm the window/dock icon is the new logo.

## Adjustments during implementation (2026-11-13)

- The default 280px sidebar couldn't fit five "icon + text" buttons: Files/Search (which switch the sidebar's content) keep their text, while Graph/Timeline/Quick switcher (actions that open tabs) became icon-only and right-aligned (the tooltip has the name and shortcut). Container query thresholds: text is hidden when the sidebar is ≤ 240px and the right panel ≤ 290px.
- The empty page's logo was meant to be semi-transparent, but it looked grey on the light background in practice, so it's an opaque 64px logo instead; the logo was too close to the background in the dark theme, so the welcome page, empty page and sidebar logos all got a thin `box-shadow` border.
- vitest's `include` gained `scripts/**/*.test.mjs` (testing the ICNS assembly).
- User guide: the sidebar description in `interface.md`, and "Graph/Timeline/Go to… in the left sidebar" in graph/time/search, now describe icons (Chinese and English).

## Follow-up: settings entry (2026-11-13)

User feedback: Settings had no icon and was hard to find; they wanted it at the bottom left.

- Added `SettingsIcon` (a gear) and `components/SettingsMenu.tsx`: the bottom of the sidebar became `.sidebar-footer`, with the gear on the left and the AI status on the right. The gear opens an upward menu: **Time & links…** (`TimeSettingsDialog`) and **AI (Ollama)…** (`LlmSettingsDialog`, disabled while `llmStatus` is null). Clicking outside, Esc or the window losing focus closes it.
- The existing Settings buttons in the graph toolbar, timeline toolbar and AI tab gained the gear icon.
- The two dialogs weren't merged and no shortcut was added (the roadmap's "settings page" is a separate discussion).
- Docs: a new "Settings" subsection in `interface.md` (Chinese and English); `architecture.md` Renderer records the settings entry.

## Follow-up: README (2026-11-13)

- The top of `README.md` became a centered header: `build/icon.svg` (128px, referencing the SVG directly without a separate PNG), the title, a one-line tagline, and links to the user guide / English guide / quick start (replacing the old single "user guide" line). No shields.io badges.
- An app screenshot follows the feature description, with `<picture>` showing `docs/images/screenshot-light.png` or `screenshot-dark.png` by the reader's theme (about 124 KB each; test-vault's 「歡迎」 note + Local graph at depth 2).
- How to retake them is recorded under "Development environment notes" in `docs/architecture.md`.
