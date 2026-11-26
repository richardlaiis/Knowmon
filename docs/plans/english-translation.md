# Plan: Translate comments, test titles and docs to English; remove the zh-TW user guide

## Context

Most comments, test titles and project documents in Knowmon are in Traditional Chinese. The user wants them all in clear, professional English, and the Chinese user guide removed.

User decisions (2026-11-26):

- **Delete** only `docs/user-guide/zh-TW/` (17 files). `test-vault/` (Chinese fixture notes that tests rely on) and the Word/PowerPoint/PDF files in `Reports/` stay as they are.
- **Code:** translate every comment and every Chinese `it()` / `describe()` title.
- **Docs:** translate all Markdown docs, including the historical plans in `docs/plans/`.

**Never changed (it's functional, not documentation):** Chinese string literals the app or tests depend on. That covers:

- zh-TW model prompts (`SYSTEM['zh-TW']` and similar)
- Chinese keyword and stopword lists, and time phrases (`上週`, `最近 N 天`…)
- zh-TW UI or notice text such as `TRUNCATED_NOTICE['zh-TW']`
- test inputs and expected outputs
- `test-vault/`

An English comment may still quote a Chinese example (for example "phrases like `上週`") when the example is the point.

No code behavior, types, IPC or schema changes. No new dependencies.

## Steps

### 1. Remove the zh-TW user guide

- `git rm -r docs/user-guide/zh-TW`.
- Fix links to it:
  - `README.md`: the header link and the two installation links point to `docs/user-guide/en/…`, with anchors updated.
  - `docs/user-guide/README.md`: drop the 繁體中文 entry.
  - `docs/user-guide/en/README.md`: drop the `[繁體中文版]` link.
- References in historical plans (`docs/user-guide/{zh-TW,en}/…`) stay as written, since they record what was done then.

### 2. Translate the Markdown docs

- Living docs: `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/testing.md`, `docs/releasing.md`, `docs/time-layer.md`.
- Historical plans: all of `docs/plans/*.md`. `search-ranking.md` already has an English half, so drop the duplicated Chinese half.
- Keep the structure exactly: headings, tables, code blocks, file paths, dates, and the "user decision" (使用者決定) markers, which become "User decision". Anchors that change are fixed wherever they're linked.
- `CLAUDE.md`:
  - Translate it fully.
  - Change the shortcuts rule to "update `docs/user-guide/en/shortcuts.md`".
  - Plans and docs going forward are written in English.

### 3. Translate code comments and test titles

- About 175 files in `src/`, `scripts/`, config files (`electron.vite.config.ts`, `vitest.config.ts`, `electron-builder.yml`), `.github/workflows/*.yml`, `.gitignore` and `.gitattributes`.
- Work directory by directory: `src/shared` → `src/main` → `src/preload` → `src/renderer` → `scripts` and config. Run `npx vitest run` and `npm run typecheck` after each batch.
- Comments: translate their meaning rather than word for word, and keep them about as long as they are now. JSDoc tags and `eslint-disable` lines stay as they are.
- Test titles: short English sentences describing the behavior, for example `'equals the existing constants at 8192 (default behavior unchanged)'`.

### 4. Record the decision

- Save this plan as `docs/plans/english-translation.md`.
- Add a line to `docs/architecture.md` (development environment section): docs, comments and test titles are in English, and Chinese appears only where it's functional.
- Add a checked item to `docs/roadmap.md`.

## Verification

- **Behavior unchanged:** compile `src/` (excluding tests) to JS with comments stripped (`tsc --removeComments`, output in the scratchpad) before and after. The two outputs must be byte-identical.
- **Tests:** for test files, the same comparison should differ only in `it()` / `describe()` title strings. Check with a diff filtered to those lines.
- **Nothing missed:** a script lists remaining CJK characters in comments and test titles across `src/`, `scripts/` and config files. Expect none, apart from quoted Chinese examples, which I'll review by hand. The same check runs on the docs, where Chinese should only appear inside code spans or examples.
- `npx vitest run`, `npm run typecheck`, `npm run lint` and `npx prettier --check` on the changed Markdown all pass.
- Links: check every relative `.md` link in `README.md` and `docs/` resolves (script) after the zh-TW guide is deleted.
