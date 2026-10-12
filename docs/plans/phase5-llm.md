# 階段 5 實作計畫：LLM 基礎能力

完成標準：向量檢索可用，能總結單篇筆記。

環境（2026-10-11 確認）：Ollama 0.35.1，已下載 `qwen3:8b`、`qwen3.5:9b`、`bge-m3`（1024 維，context 8192）。`sqlite-vec` 0.1.9 可由 better-sqlite3 13 載入（`vec0`、`distance_metric=cosine` 正常）。

## 已確認的決定（2026-10-11）

- 預設對話模型 `qwen3:8b`（設定中可切換）。
- 總結結果放在右側面板新增的 AI 分頁。
- 同意 `types.ts` 合約與 schema 變更（SCHEMA_VERSION 2 → 3）。

## 實作結果與偏離計畫之處（2026-10-11）

- `chunks` 多了 `heading` 欄位（送去 embedding 的文字要加上章節標題），並用 `AUTOINCREMENT` 讓 id 不重複使用。
- Embedder 寫入向量**不經過 Vault 佇列**：better-sqlite3 是同步的，不會交錯；以「chunk 還存在且尚未 embed」判斷是否過期即可。
- semantic 邊不用 vec0 逐篇 KNN（1000 篇 1.5 秒，會卡住 main），改在 JS 兩兩計算並分段讓出 event loop（1000 篇約 0.6 秒，每段 < 50ms）。`Vault.graph()` 因此改成 async。
- semantic 門檻預設改為 **0.65**。bge-m3 實測（`OLLAMA_IT=1`）：「早上跑步五公里」與「清晨慢跑五公里」0.765、與「晚餐煮番茄炒蛋」0.420、與英文同義句 0.800。test-vault 在 0.6 時有 14 條邊，0.61–0.65 之間多是勉強的關聯（例如「時間脈絡連結 – 深度工作」0.607），0.65 以上是明確相關的（「2026-10-04 – 深度工作」0.723）。
- 總結：qwen3:8b 總結「原子習慣」約 15–30 秒（含載入模型），沒有輸出思考過程。
- 狀態列：App 沒有狀態列，改放在左側欄底部（點擊打開右側 AI 分頁）；模型設定在 AI 分頁的「Settings」。
- 混合檢索的 UI 多了日期範圍（from / to）。
- 圖譜邊類型偏好改為記錄開與關（`a,-b`），讓舊偏好裡沒有的 semantic 預設開啟。
- 改名時內容相同的筆記保留原本的向量（`setChunks` 比對後不重寫）。

## 原則對照

- **Markdown 是唯一真相**：chunk 與向量都是索引，可從筆記重建（代價是重新 embedding）。DB 刪掉後背景重算。
- **Ollama 是可選的**：所有 LLM 呼叫只在 `src/main/llm/` 發生；連不上時 `llm.status()` 回報離線，UI 顯示提示，其餘功能不受影響。embedding 進度停在原處，Ollama 恢復後繼續。
- **只在 main process 存取 DB 與 Ollama**：renderer 只透過 IPC。
- 本階段沒有任何會寫入筆記的 LLM 動作（總結結果只顯示、可複製）。

## 1. Ollama client（`src/main/llm/ollama.ts`）

- 用 Node 內建 `fetch`，不加相依套件。`baseUrl` 預設 `http://127.0.0.1:11434`。
- `version()`、`tags()`（已下載的模型）、`embed(model, texts)`（`/api/embed`，批次）、`chat(model, messages, { signal, onDelta })`（`/api/chat` 串流 NDJSON，`think: false`，qwen3 不輸出思考過程）。
- 逾時：連線檢查 2 秒；embedding 每批 60 秒；chat 不設總逾時、可取消（`AbortController`）。
- 狀態檢查在開啟 vault 時、embedding 失敗時、使用者按「重試」時執行；離線時每 30 秒背景重試一次，恢復後通知 renderer。

## 2. 切塊與 embedding

### 切塊（純函式 `src/main/indexer/chunk.ts`）

- 輸入是 `parseNote` 的 `body`（frontmatter 已換成空行，行號與原檔一致）。
- 先依 Markdown 標題切段，段內依空行（段落）累積到約 `CHUNK_CHARS = 800` 字；單一段落過長時依句號／換行再切。圍欄程式碼不從中間切開（除非本身超長）。
- 每塊記 `line`（起始行，1-based），並在送進 embedding 的文字前面加上「標題 › 所在章節標題」，讓短塊也有上下文；DB 存原文。
- 空白筆記沒有 chunk。

### Schema（`SCHEMA_VERSION` 2 → 3，舊 DB 直接重建）

```sql
CREATE TABLE chunks (
  id      INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,      -- 筆記內第幾塊
  line    INTEGER NOT NULL,      -- 起始行（1-based）
  text    TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX chunks_note ON chunks(note_id, seq);
CREATE INDEX chunks_pending ON chunks(embedded) WHERE embedded = 0;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- embed_model、embed_dim

-- 向量表在第一次拿到 embedding 時才建立（維度取決於模型）：
-- CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[<dim>] distance_metric=cosine)  -- rowid = chunks.id
-- CREATE VIRTUAL TABLE vec_notes  USING vec0(embedding float[<dim>] distance_metric=cosine)  -- rowid = notes.id，chunk 向量的平均（正規化）
```

- `vec0` 不支援外鍵，chunk／筆記刪除時由 trigger 刪掉對應向量（向量表建立時一併建 trigger）。
- 換 embedding 模型（`meta.embed_model` 不同）時丟掉兩張向量表、所有 chunk 標回未 embed，背景重算。

### 流程

- `indexFile` 重新解析筆記時（內容 hash 改變才會發生）一併重寫該筆記的 chunk（全部 `embedded = 0`）。只動 DB，不呼叫 Ollama，不拖慢佇列。
- `Embedder`（`src/main/llm/embedder.ts`）在背景依序處理 `embedded = 0` 的 chunk：每批 16 塊呼叫 Ollama，回來後**在 Vault 佇列內**檢查這些 chunk 是否還存在（筆記可能已被修改或刪除）再寫入向量，該筆記全部完成時更新 `vec_notes`。
- Vault 每次變更後喚醒 Embedder；Ollama 離線或模型未下載時暫停，狀態裡帶錯誤訊息。
- 進度（已 embed 筆記數 / 總數）以事件推送給 renderer，狀態列顯示「Embedding 120/1000」。

## 3. 檢索（`src/main/llm/retrieve.ts`）

`retrieve(query, opts)` 混合四種來源：

1. **全文**：沿用 `searchNotes`（FTS5 trigram + 短詞 LIKE），取前 50 篇。
2. **向量**：query embedding 在 `vec_chunks` 取 KNN 前 50 塊，同一篇取最近的一塊。
3. **合併**：Reciprocal Rank Fusion（`1 / (60 + rank)`，兩邊相加）。純函式，測試排序。
4. **圖譜鄰居**（`expand`，預設開）：前 5 名的 wikilink／semantic 鄰居各加上 `0.5 ×` 該篇分數，讓相關但沒有命中關鍵字的筆記也能出現。
5. **時間篩選**：`from` / `to`（YYYY-MM-DD，含兩端），依 `event_date`（沒有的話用寫作時間 `modified_at` 的本地日期）。在合併前套用。

Ollama 離線或向量尚未建好時自動退回只用全文＋圖譜，結果標註 `vector: false`，UI 提示「語意搜尋暫不可用」。

每筆結果帶最相關的 chunk（`line`、文字片段），階段 6 的 RAG 直接沿用。

UI：側欄 Search 分頁加「關鍵字 / 混合」切換（偏好存 localStorage `knowmon.search.mode`），混合模式在 Enter 後才查詢（需呼叫 Ollama）；結果顯示命中的段落，點擊開啟並捲到該行。

## 4. 總結

- **總結筆記**：命令 `Ctrl/Cmd+Shift+S`，以及筆記分頁右上角按鈕。
- **總結選取文字**：有選取時同一個快捷鍵改為總結選取範圍。
- 結果顯示在右側面板新增的第三個分頁 **AI**（Backlinks / Local graph / AI），串流顯示，可停止、複製、重新產生。結果只存在記憶體。
- main 組 prompt：繁體中文、條列重點、保留 `[[wikilink]]`；筆記過長（> 12000 字）時先分塊各自摘要再合併（map-reduce）。
- 串流：`llm.summarize()` 回傳 request id，片段透過 `llm:summary` 事件推送，`llm.cancel(id)` 取消。

## 5. `semantic` 邊

- 由 `vec_notes` 推導：每篇取 KNN 前 `semanticMaxPerNote`（預設 5）篇，相似度（`1 - cosine distance`）≥ `semanticThreshold`（預設 0.6，bge-m3 實測後調整）才建邊，權重 = 相似度，無方向（路徑字典序較小者為 `src`）。
- 和時間邊一樣不做增量：embedding 有變動就標 dirty，`graph()` 讀取前才重算（1000 篇以 `vec0` KNN 計算，會加測試量測）。
- 參數存 vault `.knowmon/settings.json` 的 `semantic` 欄位（與 `time` 並列），限制範圍：threshold 0.3–0.95、maxPerNote 1–20。
- 圖譜：邊類型篩選加入 `semantic`（新的 CSS 變數 `--edge-semantic`），參與排版。時間設定對話框旁加一組語意參數。

## 6. 設定

| 設定                                  | 存放位置                                          | 理由                        |
| ------------------------------------- | ------------------------------------------------- | --------------------------- |
| Ollama 位址、對話模型、embedding 模型 | App `userData/settings.json` 的 `llm` 欄位        | 跟著機器走，不同 vault 共用 |
| semantic 門檻、每篇上限               | vault `.knowmon/settings.json` 的 `semantic` 欄位 | 跟著 vault 走，與時間參數同 |

預設：對話 `qwen3:8b`、embedding `bge-m3`。狀態列的 LLM 指示燈可點開一個小對話框：顯示連線狀態、從已下載的模型中選擇、重試。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' | 'semantic'

export interface LlmSettings {
  baseUrl: string
  chatModel: string
  embedModel: string
}

export interface SemanticSettings {
  /** 相似度（0–1）門檻 */
  semanticThreshold: number
  /** 每篇最多連到幾篇 */
  semanticMaxPerNote: number
}

export interface LlmStatus {
  online: boolean
  /** 離線、模型未下載等原因，給使用者看 */
  error: string | null
  /** Ollama 已下載的模型 */
  models: string[]
  settings: LlmSettings
  /** embedding 進度：已完成的筆記數 / 有內容的筆記數 */
  embedded: number
  total: number
  /** 背景正在 embedding */
  busy: boolean
}

export interface RetrieveOptions {
  limit?: number // 預設 20
  from?: string // YYYY-MM-DD，含
  to?: string
  /** 加入前幾名的圖譜鄰居，預設 true */
  expand?: boolean
}

export interface RetrieveHit {
  path: string
  title: string
  score: number
  /** 最相關的段落起始行（1-based） */
  line: number
  snippet: TextSegment[]
  /** 這篇由哪些來源命中 */
  via: ('fulltext' | 'vector' | 'graph')[]
}

export interface RetrieveResult {
  hits: RetrieveHit[]
  /** false 表示這次沒有用到向量（Ollama 離線或尚未建好） */
  vector: boolean
}

export interface SummaryRequest {
  path: string
  /** 有值時只總結這段選取文字（path 提供標題與上下文） */
  selection?: string
}

export interface SummaryChunk {
  id: string
  delta: string
  done: boolean
  error?: string
}

// KnowmonAPI 新增：
llm: {
  status(): Promise<LlmStatus>
  /** 重新檢查連線並恢復 embedding */
  retry(): Promise<LlmStatus>
  onStatus(cb: (s: LlmStatus) => void): () => void
  setSettings(s: Partial<LlmSettings>): Promise<LlmStatus>
  retrieve(query: string, opts?: RetrieveOptions): Promise<RetrieveResult>
  /** 開始串流總結，回傳 request id；片段經 onSummary 推送 */
  summarize(req: SummaryRequest): Promise<string>
  cancel(id: string): Promise<void>
  onSummary(cb: (c: SummaryChunk) => void): () => void
}
settings: {
  // 既有 getTime / setTime 不變，新增：
  getSemantic(): Promise<SemanticSettings>
  setSemantic(s: Partial<SemanticSettings>): Promise<SemanticSettings>
}
```

## 測試

- `chunk.test.ts`：標題切段、長段落、程式碼區塊、行號、中英文。
- `ollama.test.ts`：以假的 `fetch` 測 NDJSON 串流解析、逾時與離線錯誤。
- `embedder.test.ts`：假的 embed 函式（依文字產生固定向量）；筆記在 embedding 途中被修改／刪除時不寫入舊向量；換模型時重算；離線時暫停、恢復後繼續。
- `retrieve.test.ts`：RRF 排序、鄰居擴展、時間篩選、無向量時退回全文。
- `semantic.test.ts`：門檻、每篇上限、無方向去重；1000 篇的重算時間。
- `db.test.ts`：刪除筆記時 chunk 與向量一起刪除；schema 版本升級會重建。
- 與 Ollama 實際連線的整合測試只在 `OLLAMA_IT=1` 時執行（CI 不跑）。

## 之後的追加（2026-10-12）

- 總結可切換繁體中文／英文（`SummaryRequest.language`，經使用者同意修改合約）。
- 總結以 Markdown 渲染，取代原本只把 wikilink 變成連結的純文字顯示（`splitWikilinks` 已移除）。
- 總結偶爾出現原文沒有的連結（例如把提示詞裡的 `[[wikilink]]` 抄進去）：提示詞改附原文的連結清單、不寫範例，輸出再過濾掉清單以外的連結。test-vault 實測 3 篇（含一篇無連結）× 中英文，連結都與原文一致。
- 實測 qwen3:8b：英文提示詞若含中文範例會改用簡體中文回答，已拿掉範例並在內容後重申語言；小模型偶爾仍會補充筆記裡沒有的內容。

## 不做（留到之後）

- 對話面板與 RAG 回答（階段 6）、agent 工具（階段 7）。
- embedding 快取到 `.knowmon/` 以避免 DB 重建後重算（若重建時間過長再評估）。
