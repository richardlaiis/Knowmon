# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Knowmon

An Obsidian-style note-taking app (Electron + React + CodeMirror 6 + SQLite) with two distinguishing features: time-context links and a local LLM agent (Ollama, optional).

## Commands

- Development: `npm run dev`
- Tests: `npx vitest run`
- Integration tests against a real Ollama (skipped by default): `OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts` (add `OLLAMA_CHAT_MODEL=<model>` to use a chat model other than qwen3:8b)
- Integration tests against cloud providers (skipped by default, need a key): `OPENAI_IT=1` / `GEMINI_IT=1` / `CUSTOM_IT=1` plus the matching key and model environment variables; see the top of `src/main/llm/openai.integration.test.ts`
- Type check: `npm run typecheck` (don't use `npx tsc --noEmit`: it checks no files)
- Before finishing, vitest, typecheck and `npm run lint` must all pass
- Installing and running: see README.md. Manual test checklist: see docs/testing.md

## Architecture rules

- The Markdown files and `.knowmon/events.jsonl` are the only source of truth. SQLite is just an index and must be rebuildable. When the schema version doesn't match, delete the DB and rebuild; don't write migrations
- Ask me before changing any contract: `src/shared/types.ts` (types and the IPC interface), the database schema, or adding a dependency
- Only the main process may access the file system and the DB, and every operation goes through the queue in `Vault` (`src/main/vault/index.ts`) in order
- Dot files and folders (`.knowmon`, `.obsidian`, `.git`) are not part of the vault: they are not shown or watched, and IPC refuses to access them
- The renderer never inserts HTML (search snippets, summaries and answers are all turned into React elements)
- Adding an IPC call: `shared/channels.ts` → `main/ipc.ts` → `preload/index.ts` (+ `index.d.ts`) → renderer
- Design decisions and implementation details live in `docs/architecture.md` (not loaded automatically). Before touching a module, read its section (sync, indexing, graph, time layer, LLM, Q&A, agent, workspace, images, renderer, development environment). Don't overturn items marked "User decision" on your own

## Workflow

- For every task, first write a plan in plan mode and save it to `docs/plans/`; implement only after I approve it
- When done, check off progress in `docs/roadmap.md`; record new design decisions in `docs/architecture.md`
- When adding or changing a keyboard shortcut, update `docs/user-guide/en/shortcuts.md`
- If something conflicts with the "Core design principles" in `docs/roadmap.md`, stop and ask
- Write documentation, plans, code comments and test titles in English. Chinese belongs only where it is functional (zh-TW prompts, Chinese keyword lists and time phrases, test data that checks Chinese handling, and `test-vault/中文/`)

## Conventions

- New features must come with vitest tests; run the tests yourself and make sure they pass before finishing
- Use test-vault/ for manual checks: first `cp -r test-vault ~/knowmon-test-vault`. Don't put it in `/tmp` (no system trash there, so deleting fails), and don't edit test-vault/ in the repo directly
- Performance tests on a large vault: `node scripts/gen-vault.mjs ~/knowmon-1000 1000` (output goes outside the repo)
