# 檢索排序改進：中文斷詞、向量門檻、鄰居加分 / Retrieval ranking: Chinese segmentation, vector floor, neighbor bonus

> 中文版在前，English version below.

---

# 中文版

使用者回報（2026-11-04）：Hybrid 搜尋有時把完全無關的筆記排在第一。

完成標準：Hybrid 搜尋、問答、Agent 的 `search_notes` 對中文問句能用全文命中；查詢內容在 vault 中不存在時不回傳隨機筆記；連結很多的 hub 筆記不會因為連結多就排到前面。

## 調查結論（2026-11-04）

先排除常見的向量檢索錯誤：在 test-vault（bge-m3）實測，chunk id 與向量沒有錯位（重新 embedding 每塊最像的都是自己，相似度 1.0000）、沒有過期或孤兒向量、建索引和查詢用同一個模型（`sameModel` 檢查）、`vec0` 用 cosine、沒有 NaN／全 0／塌縮的向量。**資料與索引都正確，問題在排序邏輯**，共三個：

1. **中文查詢沒有斷詞**。側欄 Hybrid 用 `searchTerms`（只依空白切、AND），問答與 Agent 用 `keywords()`（只依標點與少數停用詞切）。一串中文會變成一個詞，必須在筆記中原文出現才會命中：`如何建立好習慣` → `建立好習慣`（0 篇）、`我上次讀深度工作學到了什麼` → `我上次讀深度工作學到`（0 篇）。全文沒有命中時，RRF 只剩向量那一份排名。
2. **向量沒有相似度門檻**。KNN 一定回傳 50 篇，RRF 只看名次，相似度 0.30 的第 1 名和 0.90 的第 1 名分數一樣。vault 中完全沒有的內容（`Electron`、`薛丁格方程式怎麼推導`）仍回傳 5 篇筆記。
3. **圖譜鄰居加分會累加**。前 5 名種子的鄰居，每個種子各加「種子分數 × 0.5」並相加，連到 3 個以上種子的筆記就會超過第 1 名。`歡迎` 與 `Knowmon 開發日誌` 連到大部分筆記，在 8 個相關查詢中都進入前 3 名；`我上次讀深度工作學到了什麼` 的第 1 名是 `歡迎`。

## 待確認的決定

- **Keyword 模式維持不變**（建議）：依空白切、AND、子字串比對，結果可預期（使用說明寫「中文不用斷詞」，指的就是這個行為）。斷詞只用在 Hybrid、問答、Agent。
- **側欄 Hybrid 的全文改為斷詞後 OR**，命中越多詞的排越前面（沿用問答的 `searchAny`）。目前是整句 AND，中文描述幾乎不會命中。
- **向量門檻只對已校準的模型生效**：bge-m3 設 0.45；其他模型不設門檻（維持現狀），因為不同模型的相似度分布差很多。
- 不改合約：`src/shared/types.ts`、IPC、DB schema 都不動，**不新增相依套件**（`Intl.Segmenter` 是 V8／ICU 內建）。

## 1. 中文斷詞（新檔 `src/main/llm/terms.ts`，純函式）

`keywords()` 從 `ask.ts` 移到這裡（`ask.ts`、`agent/tools.ts` 改 import）。

- `segmentTerms(text): string[]`：側欄 Hybrid 用。
  1. 標點與符號換成空白。
  2. 以 `new Intl.Segmenter('zh-TW', { granularity: 'word' })`（模組層級建立一次）切詞，只取 `isWordLike` 的片段。英文、數字、中英混合也由它處理。
  3. 去掉：1 個字的詞、純數字、通用虛詞與疑問詞（整詞比對：`什麼`、`怎麼`、`如何`、`為什麼`、`哪些`、`是否`…；英文 `a`、`the`、`of`、`is`、`what`、`how`…）。
  4. **片語詞**：兩個相鄰（原文中中間沒有其他字）且都保留下來的漢字詞，另外加上兩者相連的詞。`原子習慣` → `原子`、`習慣`、`原子習慣`。筆記裡有完整片語時多命中一個詞，排在只含零散字詞的筆記前面。
  5. 不分大小寫去重、依出現順序，最多 12 個詞（每個詞是一次 FTS／LIKE 查詢）。
- `keywords(text): string[]`：問答與 Agent 用。先做現有的前處理（序數「第二點」、句首的「那」），再用 `segmentTerms` 的流程，停用詞再加上問句專用的（`筆記`、`內容`、`寫過`、`告訴`、`總結`、`tell`、`summarize`、`notes`… 沿用現有 `ZH_STOP`／`EN_STOP`）。
  - 停用詞從「子字串切開」改為「整詞比對」：斷詞後 `的`、`嗎`、`了` 都是單字，自然被去掉，不會再切壞「目的」「了解」。實作時以測試確認 ICU 對這些詞的切法，必要時調整清單。
- `Intl.Segmenter` 不存在時（理論上不會發生）退回現在的行為。
- 側欄 Hybrid：`LlmService.retrieve` 改為傳入 `segmentTerms(query)` 作為 `retrieve()` 的 `keywords`，與問答走同一條 OR 路徑。snippet 標示用同一組詞（`toSegments` 已會合併重疊的範圍）。

## 2. 向量相似度門檻（`src/main/llm/retrieve.ts`）

- `VECTOR_MIN_SIMILARITY: Record<string, number> = { 'bge-m3': 0.45 }`，以 `vectorModel(db).model` 搭配 `sameModel` 查表；沒有的模型不設門檻。
- 第 2 步（向量）依 distance 由小到大，`1 - distance` 低於門檻就停止。
- 影響：查詢內容 vault 中沒有時，向量不貢獻候選；全文也沒有命中時結果為空。問答已有「完全找不到來源時直接回覆固定文字、不呼叫模型」的處理，Agent 的 `search_notes` 回 `No notes found`。
- 校準依據（test-vault、bge-m3，各查詢的最高相似度）：

  | 查詢 | 最高相似度 | 是否相關 |
  | --- | --- | --- |
  | 時間脈絡連結怎麼運作 | 0.66 | 是 |
  | 我上次讀深度工作學到了什麼 | 0.65 | 是 |
  | 習慣養成 | 0.63 | 是 |
  | 原子習慣這本書在講什麼 | 0.62 | 是 |
  | habit | 0.47 | 是（跨語言的單一英文詞） |
  | 薛丁格方程式怎麼推導 | 0.42 | 否 |
  | 番茄鐘 | 0.40 | 否 |
  | 如何烤出好吃的麵包 | 0.36 | 否 |
  | 量子力學的基本假設是什麼 | 0.36 | 否 |
  | Electron | 0.33 | 否 |

  「最高相似度減中位數」無法區分（`habit` 0.08、`薛丁格` 0.07），所以用絕對門檻。

## 3. 鄰居加分取最大值（`src/main/llm/retrieve.ts`）

- 第 4 步：同一個鄰居從多個種子得到的加分，**取最大值而非相加**（`EXPAND_SEEDS = 5`、`NEIGHBOR_FACTOR = 0.5` 不變）。
- 只靠連結進來的筆記最多拿到「第 1 名種子分數的一半」，不會超過種子；本身已是候選的筆記仍會因連結而上升。

## 預期結果（原型實測）

用暫時的原型（三項修改都套用、門檻 0.45）在 test-vault 實測，前 3 名：

| 查詢 | 斷詞結果 | 現在 | 修改後 |
| --- | --- | --- | --- |
| 習慣養成 | `習慣` `習慣養成` `養成` | 原子習慣、深度工作、歡迎 | 原子習慣、2026-10-05、深度工作 |
| 如何建立好習慣 | `建立` `習慣` | 原子習慣、深度工作、歡迎 | 原子習慣、深度工作、2026-10-05 |
| 原子習慣這本書在講什麼 | `原子` `原子習慣` `習慣` | 原子習慣、深度工作、歡迎 | 原子習慣、2026-10-05、深度工作 |
| 我上次讀深度工作學到了什麼 | `深度` `深度工作` `工作` | **歡迎**、深度工作、原子習慣 | 2026-10-04、深度工作、原子習慣 |
| 專注工作 | `專注` `專注工作` `工作` | 深度工作、原子習慣、歡迎 | 2026-10-04、深度工作、原子習慣 |
| 時間脈絡連結怎麼運作 | `時間` `時間脈絡` `脈絡` `脈絡連結` `連結` `運作` | 時間脈絡連結、Knowmon 開發日誌、歡迎 | 時間脈絡連結、Knowmon 開發日誌、2026-10-05 |
| habit | `habit` | 原子習慣、Knowmon 開發日誌、歡迎 | 原子習慣、2026-10-05、歡迎 |
| deep work focus | `deep` `work` `focus` | 深度工作、原子習慣、歡迎 | 深度工作、2026-10-04、原子習慣 |
| 番茄鐘 | `番茄` | 深度工作、原子習慣、歡迎 | （無結果） |
| Electron | `Electron` | 2026-10-05、Knowmon 開發日誌、歡迎 | （無結果） |
| 薛丁格方程式怎麼推導 | `方程式` `推導` | 歡迎、原子習慣、深度工作 | （無結果） |
| 如何烤出好吃的麵包 | `好吃` `麵包` | 深度工作、原子習慣、歡迎 | （無結果） |

- 相關查詢的第 1 名：7/8 → 8/8。
- hub 筆記（`歡迎`、`Knowmon 開發日誌`）出現在前 3 名：8/8 → 2/8（`時間脈絡連結` 本來就連到開發日誌）。
- 無關查詢：每個都回傳 5 篇 → 無結果。
- 原型用的停用詞清單比正式版簡化，正式版的斷詞結果可能略有不同。

## 測試

- `terms.test.ts`（新）：`segmentTerms` 與 `keywords` 對上表的查詢；片語詞只在相鄰時產生（`我上次讀深度工作` 不會產生 `上次深度`）；整詞停用詞不切壞「了解」「目的」「是否有效」；中英混合（`Knowmon開發`）；去重與 12 個詞的上限。現有 `ask.test.ts` 的 `keywords` 案例搬過來，預期值依新規則更新（例如 `深度工作的重點是什麼？` 多出 `深度`、`工作`）。
- `retrieve.test.ts`：門檻（以測試用模型名稱 `bge-m3` 建向量表、構造相似度高於與低於 0.45 的向量）；未校準的模型（`fake`）不套用門檻，現有測試不受影響；hub 筆記連到 5 個種子時排在第 1 名種子之後；鄰居加分取最大值。
- `service.test.ts`：側欄 `retrieve` 會把中文查詢斷詞後以 OR 搜尋。
- `ollama.integration.test.ts`（`OLLAMA_IT=1`）：上表 12 個查詢作為回歸測試，相關查詢第 1 名正確、無關查詢無結果。
- 效能：`node scripts/gen-vault.mjs ~/knowmon-1000 1000`，量測 12 個詞的 Hybrid 查詢時間（目標與現在同一量級，< 100 ms 不含 embedding）。
- 手動：`docs/testing.md` 的 Hybrid 搜尋與問答各加上述代表性查詢。

## 文件

- `docs/architecture.md`：「LLM」的混合檢索（門檻、鄰居取最大值）、「問答」的全文改為斷詞（`terms.ts`）。
- `docs/user-guide/{zh-TW,en}/search.md`：Hybrid 可以直接輸入中文句子；找不到相近內容時可能沒有結果。Keyword 段落不變。
- `docs/roadmap.md`：階段 8 加一項「檢索品質：中文斷詞、向量門檻、鄰居加分」，完成後勾選。
- 本計畫在實作後補上「實作結果與偏離計畫之處」。

## 原則對照

- **Markdown 是唯一真相、DB 可重建**：不改 schema、不存新資料，只改查詢時的邏輯。
- **Ollama 是可選的**：斷詞不依賴 Ollama；離線時 Hybrid 退回全文，斷詞後的 OR 搜尋反而讓離線時的中文查詢更容易命中。
- **只在 main process 存取 DB**：所有修改都在 `src/main/llm/`。
- 不新增 IPC，不需要動 `shared/channels.ts`、`preload`。

## 風險

- **門檻是用 9 篇的 test-vault 校準的**，相關（0.47）與無關（0.42）的差距很小，尤其是跨語言的單一英文詞。實作後在較大的 vault 上再確認；若誤殺相關結果，優先調低門檻，而不是改演算法。
- ICU 字典會切錯部分詞（`番茄鐘` → `番茄`、`鐘`；`薛丁格` 切成單字後被去掉）。片語詞與向量可以部分彌補；不打算為此引入 jieba 等套件。
- 斷詞後詞變多（最多 12 個），每個詞一次查詢；以 1000 篇的 vault 量測確認。
- Hybrid 從 AND 改成 OR，部分符合的筆記也會出現（排在全部符合的後面），這是刻意的取捨。

---

# English version

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
- Calibration data (test-vault, bge-m3, top similarity per query): see the table in the Chinese section. Relevant queries score 0.62–0.66 (Chinese) and 0.47 (`habit`, a single cross-lingual English word); unrelated queries score 0.33–0.42. "Top minus median" doesn't separate them (`habit` 0.08 vs. `薛丁格` 0.07), hence an absolute floor.

## 3. Neighbor bonus takes the maximum (`src/main/llm/retrieve.ts`)

- Step 4: when a neighbor gets bonuses from several seeds, **take the maximum instead of the sum**. `EXPAND_SEEDS = 5` and `NEIGHBOR_FACTOR = 0.5` stay the same.
- A note that enters only through links gets at most half the #1 seed's score, so it can't outrank the seeds. Notes that are already candidates can still rise through links.

## Expected results (prototype)

A throwaway prototype applied all three changes (floor 0.45) on test-vault; the full top-3 table is in the Chinese section.

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
