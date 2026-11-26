# Plan: an English, richer sample vault; English test data where the language doesn't matter

## Context

`test-vault/` is 9 tiny Chinese notes (about 1 KB in total). It's what users and manual tests open first, and it feels thin: there's little for the timeline, graph, semantic links, Q&A or the Agent to work with, and most UI features (tables, math, images, task lists, code) never appear in it. The user wants it in English and richer, and wants the test data and code tied to it translated too.

User decisions (2026-11-26):

- **Vault language**: mostly English, plus a small Chinese set (4–5 notes in their own folder) so Chinese-specific features can still be tried and integration-tested: 2-character search, keyword extraction, time phrases like 上週, zh-TW summaries, cross-lingual semantic links.
- **Unit tests**: translate sample data only where the language doesn't matter; keep Chinese where the test checks Chinese handling.
- **Size**: about 30 notes.

No changes to app behavior, `types.ts`, IPC, the DB schema, or dependencies.

CLAUDE.md says not to edit `test-vault/` in the repo directly; that rule is about manual testing (work on a copy). Rewriting the vault itself is the point of this task, so it's edited in place here, and all checks run on a copy.

## 1. New `test-vault/` (~30 notes, replacing the current 9)

One person's knowledge base: a developer who builds Knowmon on the side, reads, trains for a half marathon and cooks. Event dates span 2026-10-05 to 2026-11-25, so phrases like "last month" and "this month" still find notes today. All content is original writing (book notes are my own summaries, no quoted passages).

| Folder                    | Notes                                                                                                                                                                                                      | What they exercise                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| root                      | `Welcome.md`                                                                                                                                                                                               | Index linking every area; a task list; the note the README screenshot opens                                                                 |
| `Journal/`                | ~12 dated entries (`2026-10-05.md` …), some consecutive days and some gaps, tags in both flow and block style                                                                                              | Timeline, Sequence chain, Same day (one entry shares a date with a meeting note), "what did I do between…" questions, `add_tags` Agent task |
| `Books/`                  | Atomic Habits, Deep Work, The Pragmatic Programmer, Thinking in Systems                                                                                                                                    | Book notes with `author`/`date`/`tags` frontmatter; cross-links; Q&A and comparison-note Agent task                                         |
| `Projects/Knowmon/`       | Dev log, Time context links, Design notes (one **long note, ~13,000 characters**, for split summaries and chunking), Ideas                                                                                 | Headings, code blocks, a table, wikilinks with labels and `#heading`                                                                        |
| `Projects/Half marathon/` | Training plan (table of weekly mileage, a pace formula in `$…$` and a `$$…$$` block), Ideas                                                                                                                | Math, tables; `Ideas` duplicates a name in another folder (link resolution: `[[Ideas]]` vs `[[Half marathon/Ideas]]`)                       |
| `Meetings/`               | 2–3 notes such as `2026-10-14 Design review.md`                                                                                                                                                            | Date in the file name, same day as a journal entry                                                                                          |
| `Cooking/`                | 2–3 recipes                                                                                                                                                                                                | A cluster unrelated to the rest (semantic links stay apart; "nothing relevant" Q&A checks)                                                  |
| `Inbox/`                  | One orphan note with no links; one linking to `[[A note that doesn't exist yet]]`                                                                                                                          | Orphan nodes, missing link targets                                                                                                          |
| `Reference/`              | Markdown showcase: nested lists, task list, quote, table with alignment and `\|`, inline and block math, a fenced code block, an image                                                                     | Live preview features in one place                                                                                                          |
| `中文/`                   | 4–5 Chinese notes: a welcome/explainer, a 原子習慣 reading note, a 跑步紀錄 running log (cross-lingual pair with the English training notes), two dated journal entries (`2026-11-18.md`, `2026-11-20.md`) | 2-character search (習慣, 專注), Chinese questions, 上週 / 這個月 phrases, zh-TW summaries, mixed Chinese/English text                      |
| `attachments/`            | `knowmon-logo.png` (copied from `resources/icon.png`)                                                                                                                                                      | Images in notes                                                                                                                             |

## 2. Code and tests tied to the vault

- `src/main/llm/ollama.integration.test.ts`: rewrite the vault-based tests against the new notes.
  - Retrieval: an English query ("how to build better habits") plus the Chinese query 培養好習慣的方法 against the Chinese notes.
  - Q&A: "What are the key ideas of Deep Work?", an explicit date-range question over journal entries, and the "nothing relevant" question.
  - Agent: English tasks (links between journal entries in a range; a comparison note of two books → Reject/Apply; adding a tag to a journal entry).
  - The bge-m3 similarity test (Chinese sentences, cross-lingual) stays as is: it tests Chinese handling.
- `src/main/llm/openai.integration.test.ts`: the task text "notes about 跑步 (running)" becomes English.
- `src/renderer/chat/AgentPanel.tsx`: the three example tasks shown in the UI become English examples that work with the new vault. `ChatPanel.tsx`'s hint that mentions “上個月” stays, since it shows that Chinese phrases are supported.
- `scripts/gen-vault.mjs`: CLI messages, topics and generated text in English, with about 1 in 5 notes still Chinese so large-vault tests keep exercising CJK labels and trigram search.

## 3. Unit test data: translate only where the language doesn't matter

**Translate** (note names, bodies, tags and queries are just placeholders): `vault.test`, `indexing.test`, `vault/time.test`, `tree.test` (except the zh-Hant ordering case), `paths.test`, `db.test`, `events-log.test`, `graph.test`, `db/time.test`, `vectors.test`, `agent/tools.test`, `agent/loop.test`, `agent/tags.test` (keep one CJK tag case), `embedder.test`, `ollama.test`, `openai.test`, `settings.test`, `assets.test` (keep one non-ASCII path for URL encoding), the renderer tests (`tabs`, `fuzzy`, `wikilinks`, `tables`, `livePreview`, `parseMarkdown`, `agentRun`, `conversation`, `summary`, `autosave`, `graph/model`, …).

**Keep Chinese**, with a short comment where it isn't obvious why: `timeRange.test` (Chinese phrases), `search.test` (2-character LIKE path, trigram, mixed text), `ask.test` (keywords, language detection, Chinese questions), `retrieve.test` (keyword OR with Chinese terms), `summarize.test` and the service's language-selection tests (zh-TW prompts), `chunk.test` (Chinese sentence punctuation), `links.test` (NFC/NFD), `labelCollide.test` (CJK width), the zh-Hant case in `tree.test`.

Within mixed files, only the generic cases change. Expected values change together with their inputs, so each test keeps asserting the same behavior.

## 4. Docs

- `docs/testing.md`: rewrite the manual checklist's note names and inputs for the new vault (English, with a few Chinese steps against `中文/`), and drop the "the vault's notes have Chinese names" paragraph.
- `docs/user-guide/en/installation.md`: "The sample notes are in Chinese" → mostly English with a Chinese folder.
- `docs/roadmap.md` (`test-vault/` description), `CLAUDE.md` and `docs/architecture.md` (the language rule: `test-vault/` is no longer a blanket exception, only `中文/` is), `docs/architecture.md` screenshot instructions (open `Welcome`).
- README screenshots show the old Chinese vault. Retake them from a built app with the new vault (per the instructions in `architecture.md`) if the app can run here; otherwise leave them and say so.
- Historical plans in `docs/plans/` keep their old note names (they record what was tested then).
- Save this plan, check off a roadmap item.

## Verification

- `npx vitest run`, `npm run typecheck`, `npm run lint` pass. The comment-stripped compile check from the last task shows non-test source unchanged apart from `AgentPanel.tsx`'s example strings and `gen-vault.mjs`.
- Real Ollama is available locally (bge-m3, qwen3.5:2b): open a copy of the new vault through `Vault` + `LlmService` (as in the integration test) and check: every note indexes, there are no unexpected unresolved links besides the intended one, semantic edges at the default 0.65 form sensible clusters (books/habits, running ↔ 跑步, cooking apart), Hybrid search for an English and a Chinese query ranks the right notes first, and the long note is split for summaries. Run `OLLAMA_IT=1` with `chatModel` overridden to `qwen3.5:2b` if the test allows it; report what wasn't run.
- `node scripts/gen-vault.mjs ~/knowmon-gen-check 200` works and produces mixed titles; delete the output after.
- Manually skim `cp -r test-vault ~/knowmon-test-vault` in the app if it can be launched (graph, timeline, Reference note rendering).
