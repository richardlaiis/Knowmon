# Retrieval ranking: Chinese segmentation, vector floor, neighbor bonus

User report (2026-11-04): Hybrid search sometimes ranks a completely unrelated note first.

Done when: Hybrid search, Chat (Q&A) and the agent's `search_notes` get full-text hits for Chinese questions; queries about something absent from the vault return no random notes; heavily linked hub notes no longer rank high just because they have many links.

## Findings (2026-11-04)

Common vector-search bugs were ruled out first. Measured on test-vault with bge-m3:

- Chunk ids and vectors are aligned: re-embedding each chunk finds itself as the nearest neighbor, with similarity 1.0000.
- No stale or orphaned vectors.
- Indexing and queries use the same model (checked with `sameModel`).
- `vec0` uses cosine.
- No NaN, all-zero or collapsed vectors.

**The data and the index are correct. The problems are in the ranking logic.** There are three:

1. **Chinese queries are not segmented.** The sidebar's Hybrid search uses `searchTerms`, which splits on whitespace only and ANDs the terms. Chat and the agent use `keywords()`, which splits only on punctuation and a few stop words. A run of Chinese text becomes one term that must appear verbatim in a note: `如何建立好習慣` becomes `建立好習慣` (0 notes) and `我上次讀深度工作學到了什麼` becomes `我上次讀深度工作學到` (0 notes). With no full-text hits, RRF is left with only the vector ranking.
2. **The vector side has no similarity floor.** KNN always returns 50 notes, and RRF looks only at rank, so a #1 hit at similarity 0.30 scores the same as a #1 hit at 0.90. Queries about things absent from the vault (`Electron`, `薛丁格方程式怎麼推導`, "how to derive the Schrödinger equation") still return 5 notes.
3. **Graph neighbor bonuses add up.** Each of the top 5 seeds gives its neighbors "seed score × 0.5", and these are summed. A note linked to 3 or more seeds outranks the #1 hit. `歡迎` (Welcome) and `Knowmon 開發日誌` (dev log) link to most notes, and they reached the top 3 in all 8 relevant queries. For `我上次讀深度工作學到了什麼` the #1 result was `歡迎`.

## Decisions to confirm

- **Keyword mode stays as is** (recommended): whitespace split, AND, substring matching, with predictable results. The user guide's line "no word segmentation needed for Chinese" describes exactly this behavior. Segmentation is used only by Hybrid, Chat and the agent.
- **Sidebar Hybrid full-text switches to segmented OR**: notes that match more terms rank higher, reusing Chat's `searchAny`. Today it ANDs the whole sentence, so Chinese descriptions almost never match.
- **The vector floor applies only to calibrated models**: 0.45 for bge-m3. Other models get no floor (current behavior), because similarity distributions vary a lot between models.
- No contract changes: `src/shared/types.ts`, IPC and the DB schema are untouched, and **no new dependencies** are added (`Intl.Segmenter` is built into V8/ICU).

## 1. Chinese segmentation (new file `src/main/llm/terms.ts`, pure functions)

`keywords()` moves here from `ask.ts`; `ask.ts` and `agent/tools.ts` update their imports.

- `segmentTerms(text): string[]` is used by sidebar Hybrid:
  1. Replace punctuation and symbols with spaces.
  2. Segment with `new Intl.Segmenter('zh-TW', { granularity: 'word' })`, created once at module level, keeping only `isWordLike` segments. It also handles English, digits and mixed Chinese/English.
  3. Drop single-character words, pure numbers, and common function and question words, matched as whole words: `什麼`, `怎麼`, `如何`, `為什麼`, `哪些`, `是否`, …; in English `a`, `the`, `of`, `is`, `what`, `how`, ….
  4. **Phrase terms**: when two kept Han words are adjacent (nothing between them in the original text), also add their concatenation. `原子習慣` gives `原子`, `習慣` and `原子習慣`. A note containing the whole phrase matches one more term, so it ranks above notes that contain only the scattered words.
  5. Dedupe case-insensitively, keep order of appearance, and cap at 12 terms, since each term is one FTS/LIKE query.
- `keywords(text): string[]` is used by Chat and the agent:
  - It first runs the existing preprocessing (ordinals like 「第二點」, a leading 「那」).
  - It then follows the `segmentTerms` pipeline, adding question-specific stop words (`筆記`, `內容`, `寫過`, `告訴`, `總結`, `tell`, `summarize`, `notes`, …), carried over from the current `ZH_STOP`/`EN_STOP`.
  - Stop words change from substring splitting to whole-word matching. After segmentation, `的`, `嗎` and `了` are single characters and drop out on their own, so they no longer break words like 「目的」 or 「了解」. Tests will confirm how ICU segments these words, and the lists will be adjusted where needed.
- If `Intl.Segmenter` is unavailable (it shouldn't be), fall back to the current behavior.
- Sidebar Hybrid: `LlmService.retrieve` passes `segmentTerms(query)` as `retrieve()`'s `keywords`, so it takes the same OR path as Chat. Snippet highlighting uses the same terms; `toSegments` already merges overlapping ranges.

## 2. Vector similarity floor (`src/main/llm/retrieve.ts`)

- `VECTOR_MIN_SIMILARITY: Record<string, number> = { 'bge-m3': 0.45 }`, looked up from `vectorModel(db).model` with `sameModel`. Models not in the table get no floor.
- Step 2 (vector) walks hits by ascending distance and stops once `1 - distance` drops below the floor.
- Effect:
  - When the vault has nothing on the topic, the vector side adds no candidates. If full text also has no hits, the result is empty.
  - Chat already handles this: with no sources at all, it replies with a fixed message without calling the model.
  - The agent's `search_notes` returns `No notes found`.
- Calibration data (test-vault, bge-m3, top similarity per query):

  | Query                                                                      | Top similarity | Relevant?                                 |
  | -------------------------------------------------------------------------- | -------------- | ----------------------------------------- |
  | 時間脈絡連結怎麼運作 ("how do time-context links work")                    | 0.66           | Yes                                       |
  | 我上次讀深度工作學到了什麼 ("what did I learn last time I read Deep Work") | 0.65           | Yes                                       |
  | 習慣養成 ("habit formation")                                               | 0.63           | Yes                                       |
  | 原子習慣這本書在講什麼 ("what is Atomic Habits about")                     | 0.62           | Yes                                       |
  | habit                                                                      | 0.47           | Yes (a single cross-lingual English word) |
  | 薛丁格方程式怎麼推導 ("how to derive the Schrödinger equation")            | 0.42           | No                                        |
  | 番茄鐘 ("pomodoro")                                                        | 0.40           | No                                        |
  | 如何烤出好吃的麵包 ("how to bake good bread")                              | 0.36           | No                                        |
  | 量子力學的基本假設是什麼 ("what are the postulates of quantum mechanics")  | 0.36           | No                                        |
  | Electron                                                                   | 0.33           | No                                        |

  Relevant queries score 0.62–0.66 (Chinese) and 0.47 (`habit`); unrelated queries score 0.33–0.42. "Top minus median" doesn't separate them (`habit` 0.08 vs. `薛丁格` 0.07), hence an absolute floor.

## 3. Neighbor bonus takes the maximum (`src/main/llm/retrieve.ts`)

- Step 4: when a neighbor gets bonuses from several seeds, **take the maximum instead of the sum**. `EXPAND_SEEDS = 5` and `NEIGHBOR_FACTOR = 0.5` stay the same.
- A note that enters only through links gets at most half the #1 seed's score, so it can't outrank the seeds. Notes that are already candidates can still rise through links.

## Expected results (prototype)

A throwaway prototype applied all three changes (floor 0.45) on test-vault. Top 3:

| Query                      | Segmented terms                                   | Now                                  | After the change                           |
| -------------------------- | ------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| 習慣養成                   | `習慣` `習慣養成` `養成`                          | 原子習慣, 深度工作, 歡迎             | 原子習慣, 2026-10-05, 深度工作             |
| 如何建立好習慣             | `建立` `習慣`                                     | 原子習慣, 深度工作, 歡迎             | 原子習慣, 深度工作, 2026-10-05             |
| 原子習慣這本書在講什麼     | `原子` `原子習慣` `習慣`                          | 原子習慣, 深度工作, 歡迎             | 原子習慣, 2026-10-05, 深度工作             |
| 我上次讀深度工作學到了什麼 | `深度` `深度工作` `工作`                          | **歡迎**, 深度工作, 原子習慣         | 2026-10-04, 深度工作, 原子習慣             |
| 專注工作                   | `專注` `專注工作` `工作`                          | 深度工作, 原子習慣, 歡迎             | 2026-10-04, 深度工作, 原子習慣             |
| 時間脈絡連結怎麼運作       | `時間` `時間脈絡` `脈絡` `脈絡連結` `連結` `運作` | 時間脈絡連結, Knowmon 開發日誌, 歡迎 | 時間脈絡連結, Knowmon 開發日誌, 2026-10-05 |
| habit                      | `habit`                                           | 原子習慣, Knowmon 開發日誌, 歡迎     | 原子習慣, 2026-10-05, 歡迎                 |
| deep work focus            | `deep` `work` `focus`                             | 深度工作, 原子習慣, 歡迎             | 深度工作, 2026-10-04, 原子習慣             |
| 番茄鐘                     | `番茄`                                            | 深度工作, 原子習慣, 歡迎             | (no results)                               |
| Electron                   | `Electron`                                        | 2026-10-05, Knowmon 開發日誌, 歡迎   | (no results)                               |
| 薛丁格方程式怎麼推導       | `方程式` `推導`                                   | 歡迎, 原子習慣, 深度工作             | (no results)                               |
| 如何烤出好吃的麵包         | `好吃` `麵包`                                     | 深度工作, 原子習慣, 歡迎             | (no results)                               |

- Relevant queries with the right note at #1: 7/8 → 8/8.
- Hub notes (`歡迎`, `Knowmon 開發日誌`) in the top 3: 8/8 → 2/8. `時間脈絡連結` legitimately links to the dev log.
- Unrelated queries: 5 notes each → no results.
- The prototype used a simplified stop list, so the final segmentation may differ slightly.

## Tests

- `terms.test.ts` (new):
  - `segmentTerms` and `keywords` on the queries in the table.
  - Phrase terms appear only for adjacent words (`我上次讀深度工作` does not produce `上次深度`).
  - Whole-word stop words don't break 「了解」, 「目的」 or 「是否有效」.
  - Mixed Chinese/English (`Knowmon開發`).
  - Dedupe and the 12-term cap.
  - The existing `keywords` cases in `ask.test.ts` move here, with expectations updated to the new rules (e.g. `深度工作的重點是什麼？` now also yields `深度` and `工作`).
- `retrieve.test.ts`:
  - The floor: build the vector tables under the model name `bge-m3`, with vectors constructed above and below 0.45.
  - An uncalibrated model (`fake`) gets no floor, so existing tests are unaffected.
  - A hub linked to 5 seeds ranks below the #1 seed.
  - Neighbor bonus takes the maximum.
- `service.test.ts`: sidebar `retrieve` segments Chinese queries and searches with OR.
- `ollama.integration.test.ts` (`OLLAMA_IT=1`): the 12 queries from the table as a regression set. Relevant queries must have the right note at #1; unrelated queries must return nothing.
- Performance: run `node scripts/gen-vault.mjs ~/knowmon-1000 1000` and time a 12-term Hybrid query. Target: same order of magnitude as today, < 100 ms excluding embedding.
- Manual: add these representative queries to the Hybrid search and Chat sections of `docs/testing.md`.

## Documentation

- `docs/architecture.md`:
  - "LLM" section, hybrid retrieval: the floor and the max neighbor bonus.
  - "Q&A" section: full-text search now uses segmentation (`terms.ts`).
- `docs/user-guide/{zh-TW,en}/search.md`:
  - Hybrid accepts Chinese sentences directly.
  - It may return nothing when no similar content exists.
  - The Keyword section is unchanged.
- `docs/roadmap.md`: add "Retrieval quality: Chinese segmentation, vector floor, neighbor bonus" under Phase 8 and check it off when done.
- After implementation, add an "Implementation results and deviations" section to this plan.

## Design principles

- **Markdown is the source of truth; the DB is rebuildable**: no schema change and no new stored data. Only query-time logic changes.
- **Ollama is optional**: segmentation doesn't depend on Ollama. Offline, Hybrid falls back to full text, and segmented OR makes Chinese queries more likely to match even then.
- **DB access only in the main process**: all changes are in `src/main/llm/`.
- No new IPC, so `shared/channels.ts` and `preload` are untouched.

## Risks

- **The floor was calibrated on the 9-note test-vault.** The gap between relevant (0.47) and unrelated (0.42) is small, especially for single cross-lingual English words. Re-check on a larger vault after implementation. If relevant results get cut, lower the floor before changing the algorithm.
- ICU's dictionary mis-segments some words: `番茄鐘` (pomodoro) becomes `番茄` + `鐘`, and `薛丁格` (Schrödinger) splits into single characters that get dropped. Phrase terms and vectors partly compensate. Adding a package such as jieba for this is not planned.
- Segmentation produces more terms (up to 12), each one query. Confirm the cost on the 1000-note vault.
- Hybrid moving from AND to OR means partial matches also appear, ranked after full matches. This is a deliberate trade-off.
