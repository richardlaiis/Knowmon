# LaTeX math rendering

## Context

Notes and AI replies often contain math (`$E = mc^2$`, `$$\int_0^1 f(x)\,dx$$`), but Knowmon shows it as raw text. The goal is to render math in the editor's live preview (like tables and images) and in AI replies (Chat, Agent, Summary), while the Markdown file keeps the raw TeX as the only source of truth.

Decisions (user approved, 2026-11-25):

- Library: **KaTeX** (new dependency). It is synchronous, so it fits CodeMirror widgets that are rebuilt while typing. `katex.render()` builds DOM nodes with `createElement`, not an HTML string, so the "renderer doesn't insert HTML" rule still holds. `trust` stays `false`, so `\href`, `\url`, `\includegraphics`, `\htmlClass` and similar commands are rejected.
- Scope: the editor (live preview and table cells) **and** the AI Markdown renderer (`parseMarkdown.ts` / `Markdown.tsx`).
- Syntax: `$...$` and `$$...$$` everywhere (the same as Obsidian, so notes stay portable). AI replies additionally accept `\(...\)` and `\[...\]`, because models often write those. In notes, `\(` stays a normal Markdown escape.

No change to `types.ts`, IPC, the database, or the main process. Search, the index and embeddings keep seeing the raw TeX.

## Syntax rules

Parsed by a lezer Markdown extension (`src/renderer/editor/mathSyntax.ts`), so code spans, escapes and math follow the normal precedence: whichever opens first wins, `\$` is a literal dollar sign, and `$` inside code is not math.

- **Inline `$...$`**: the opening `$` must not be followed by whitespace or another `$`. Only the first unescaped `$` after the opener can close it, and it must not be preceded by whitespace or followed by a digit; otherwise that opener isn't math. (TeX math never contains an unescaped `$`, and this keeps `$5 and $10, or $x$` from swallowing the prices.) The math must be on one line, and `\$` inside it does not close it. So `$5 and $10` stays text.
- **Inline `$$...$$`** (inside a paragraph): on one line, with non-empty content. Rendered in display style but kept inline.
- **Math block**: a line (indent < 4, inside any quote or list) that starts with `$$`.
  - `$$ x $$` alone on one line is a one-line block.
  - `$$` with no other `$$` on that line opens a multi-line block. The block closes at the first line whose text ends with `$$` (for example `$$` or `\end{aligned}$$`).
  - A line that starts with `$$` but also has `$$` in the middle (`$$a$$ and $$b$$`) is a paragraph with inline math.
  - Blank lines can't be inside a block (TeX doesn't allow them in display math either). A blank line, or the end of the enclosing quote or list, ends an **unclosed** block. Unclosed blocks are never rendered, so a stray `$$` only affects the lines up to the next blank line.
  - A block can interrupt a paragraph, like a fenced code block.
- AI replies only: `\(...\)` (inline), `\[...\]` (inline, or a block when the line starts with `\[`), with the same block rules.

Syntax tree: `InlineMath` and `BlockMath`, each with `MathMark` children for the delimiters. Quote markers inside a block stay child nodes and are removed from the TeX. In source mode the math text is highlighted in monospace and the delimiters in the syntax color.

## Editor

- `src/renderer/editor/mathRender.ts`: `renderMath(tex, display)` returns a DOM element. It calls KaTeX with `throwOnError: true`, `strict: 'ignore'` (Chinese text in math must not spam the console) and `trust: false`. On a parse error it returns the raw TeX in a red monospace span, with the KaTeX message as its tooltip. Results are cached by `(display, tex)` (max 500 entries) and cloned, so scrolling doesn't re-run KaTeX.
- **Inline math** (`livePreview.ts` ViewPlugin): when the cursor isn't on it, the whole `$...$` is replaced by a `MathWidget`. When the cursor touches it, the raw source is shown.
- **Block math** (`math.ts`, a `StateField` like `tables.ts`, because a replacement that crosses line breaks can't come from a ViewPlugin): when the selection doesn't touch a closed block, the range from the opening `$$` to the end of the closing line is replaced by a display-mode widget. This works for top-level blocks and for blocks in quotes and lists, because the replaced range starts after the container markers of the first line. When the cursor is inside a closed block, the source is shown with a **live preview below it** (a block widget after the closing line), so errors show up while typing. Only container nodes (quotes, lists) are walked, not the whole tree.
- `buildDecorations` skips `BlockMath`, and wikilink detection treats math like code (no `[[...]]` decorations inside math, which also avoids overlapping replace decorations).
- **Table cells** (`tables.ts`): inline math in a cell becomes a `math` span rendered by `renderMath`. As with code in cells, `\|` inside math becomes `|`.
- Clicking a rendered formula puts the cursor next to it (`ignoreEvent() → false`), which shows the source. Source mode (`Ctrl+E`) doesn't render math.
- `main.tsx` imports `katex/dist/katex.min.css`. Vite bundles the fonts and the CSP's `default-src 'self'` already allows them. `main.css` styles: inline `.katex-display` stays inline, blocks get vertical spacing and scroll sideways when too wide, errors use `--danger`.

## AI replies

- `parseMarkdown.ts`: the parser gets the math extension with `\(` / `\[` enabled. New node types are `{ t: 'math', tex, display }` (inline) and `{ t: 'math', tex }` (block). An unclosed block, which is common while streaming, is shown as its raw text.
- `Markdown.tsx`: a `TexMath` component renders into a `<span>`/`<div>` via `ref` + `useLayoutEffect` with `renderMath`. React never receives an HTML string.

## Files

- New: `src/renderer/editor/mathSyntax.ts`, `mathRender.ts`, `math.ts`, plus tests `mathSyntax.test.ts`, `math.test.ts`.
- Changed: `livePreview.ts`, `tables.ts`, `chat/parseMarkdown.ts`, `chat/Markdown.tsx`, `src/main.tsx`, `assets/main.css`, `package.json` (`katex`).

## Tests

- `mathSyntax.test.ts`: the inline scanning rules (currency, escapes, digits after the closer, `$$` inline, no line breaks, `\(` only when enabled); blocks (one-line, multi-line, closer with content, unclosed at a blank line or the end of the document, inside a quote with markers removed from the TeX, inside a list, interrupting a paragraph, `$$a$$ and $$b$$` staying a paragraph, indented code not being math); precedence with inline code and `\$`.
- `math.test.ts`: block decorations (replace when the cursor is outside, preview widget when inside, unclosed blocks not rendered, frontmatter skipped); the TeX/display extraction helper.
- `livePreview.test.ts`: inline math replaced or shown as source depending on the cursor; no wikilink decoration inside math; `BlockMath` produces no ViewPlugin decorations.
- `tables.test.ts`: a math span in a cell, including `\|`.
- `parseMarkdown.test.ts`: inline, display, `\(`, `\[` blocks, unclosed streaming blocks, `$` currency staying text.

## Docs

- `docs/architecture.md` (Renderer): the math design. `docs/roadmap.md`: a checked item. `docs/testing.md`: the test files and a manual checklist row.
- User guide (en and zh-TW): `notes-and-editing.md` (a "Math" row and section) and `summary-and-chat.md` (math in replies). No shortcut changes.

## Verification

1. `npx vitest run`, `npm run typecheck`, `npm run lint`.
2. `cp -r test-vault ~/knowmon-test-vault`, `npm run dev`: inline and block math, errors, a cursor entering and leaving, math in a quote, a list and a table cell, `Ctrl+E`, dark theme, and an AI reply with `\[...\]`.
