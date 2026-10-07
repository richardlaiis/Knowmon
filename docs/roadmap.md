# Knowmon 專案交接文件

Oct 6, 2026 · @Richard Lai

## 專案概述

Knowmon 是一個類 Obsidian 的本地筆記軟體，階段 0（骨架）已完成，接下來由 Claude Code 從階段 1 開始實作功能。它與 Obsidian 的差異在三個特色：

1. **雙向連結**：筆記之間用 `[[筆記名稱]]` 互相連結，並有反向連結面板。
2. **時間脈絡連結**：除了手動連結，系統也會依照編輯時間與事件時間自動建立連結，讓每個 vault 有更完整的知識圖譜。
3. **本地 LLM agent**：透過 Ollama 接上本地模型，提供檢索、總結、篩選等功能，所有資料都不離開使用者的電腦。

## 技術架構與選型

整個專案只使用 TypeScript，分成前端 UI（renderer）與核心服務（main process）兩層，兩者透過 IPC 溝通。

| 用途 | 技術 | 備註 |
| --- | --- | --- |
| 桌面框架 | Electron + electron-vite | React + TypeScript 範本 |
| 編輯器 | CodeMirror 6 | `@codemirror/lang-markdown` |
| 資料庫 | SQLite（better-sqlite3） | 原生模組，版本不符時執行 `npx electron-builder install-app-deps` |
| 向量檢索 | sqlite-vec | SQLite 擴充 |
| 全文搜尋 | SQLite FTS5 | 必須使用 `trigram` tokenizer 才能搜尋中文 |
| 檔案監聽 | chokidar | 偵測外部編輯器的修改 |
| Frontmatter 解析 | gray-matter |  |
| 圖譜視覺化 | Cytoscape.js | 效能不足時可評估改用 sigma.js |
| 本地 LLM | Ollama HTTP API | 對話模型 `qwen3:8b`，embedding 模型 `bge-m3` |
| 測試 | vitest |  |

資料夾職責：

- `src/shared/types.ts`：資料型別與 IPC 介面合約，修改前需經過使用者同意。
- `src/main/vault/`：讀寫檔案、監聽變更。
- `src/main/indexer/`：解析連結、frontmatter、日期。
- `src/main/db/`：schema 與查詢。
- `src/main/llm/`：Ollama client、檢索、agent 工具。
- `src/renderer/`：`editor/`、`graph/`、`timeline/`、`chat/` 四個 UI 模組。
- `test-vault/`：測試用筆記，含中文、日期 frontmatter、互相連結、日記格式檔名。
- `docs/`：`architecture.md`、`roadmap.md`、`plans/`（每個功能的實作計畫）。

## 目前進度

階段 0（骨架與基礎設施）除了 Ollama 安裝之外已全部完成，尚未實作任何功能。

- [x] 用 electron-vite 建立專案，`npm run dev` 可開出視窗
- [x] 安裝相依套件：better-sqlite3、sqlite-vec、chokidar、gray-matter、CodeMirror、Cytoscape.js、vitest
- [x] 建立資料夾結構，每個模組有 `index.ts` 與職責註解
- [x] 撰寫 `src/shared/types.ts` 初版
- [x] 撰寫 SQLite schema 初版
- [x] 撰寫 `CLAUDE.md`
- [x] 設定 vitest
- [x] 準備 `test-vault/` 測試筆記
- [x] 初始化 git
- [ ] 安裝 Ollama 並下載模型：`ollama pull qwen3:8b`、`ollama pull bge-m3`（階段 5 之前完成即可，不影響階段 1–4）

`types.ts` 與 schema 是使用者手寫的初版，Claude Code 接手時應先閱讀並確認是否涵蓋本文件「資料模型」一節的內容，有缺漏時先提出，不要直接修改。

## 核心設計原則

以下原則在任何階段都不可違反，有衝突時先停下來詢問使用者。

1. **Markdown 檔是唯一真相來源。** SQLite 只是索引，刪掉資料庫後必須能從 vault 完整重建。使用者的筆記內容永遠不能只存在資料庫裡。
2. **檔案系統與資料庫只在 main process 存取。** renderer 一律透過 `types.ts` 定義的 IPC 介面呼叫。
3. **從階段 1 起就要記錄 `note_events`。** 檔案系統只保留最後修改時間，過去的編輯歷程無法事後補回，所以即使時間功能在階段 4 才做，紀錄必須先開始。
4. **索引是增量的。** 用 content hash 判斷檔案是否變動，只重新索引有改變的檔案。
5. **Ollama 是可選的。** 沒有啟動 Ollama 時，所有非 LLM 功能都必須正常運作，LLM 功能顯示清楚的提示即可。
6. **Agent 預設唯讀。** 任何會修改或建立筆記的動作，都必須經過使用者確認。

## 資料模型

圖譜的核心是「邊有類型與權重」，這是本專案與 Obsidian 最大的差異。目標 schema 如下，實際 `types.ts` 與 schema 若有出入，以使用者確認後的版本為準。

```sql
notes(id, path, title, created_at, modified_at, event_date, content_hash)
note_events(note_id, ts, kind)        -- kind: create / edit / open
links(src, dst, type, weight, meta)   -- 邊有類型與權重
chunks(id, note_id, text)             -- 供 LLM 檢索的文字塊
notes_fts USING fts5(title, body, tokenize='trigram')
-- 向量表由 sqlite-vec 建立，對應 chunks.id
```

筆記有兩種時間：`created_at` / `modified_at` 是「何時寫的」，`event_date` 是「內容講的事何時發生」，來源為 frontmatter 的 `date:` 或日記檔名。兩者都要保存，讓圖譜能切換兩種時間視角。

| 連結類型 | 產生方式 | 實作階段 |
| --- | --- | --- |
| `wikilink` | 使用者在內文寫 `[[ ]]` | 2 |
| `same_session` | 在同一段工作時間內被編輯（預設 30 分鐘，需可調整） | 4 |
| `same_day` | `event_date` 相同或接近 | 4 |
| `sequence` | 同一主題下時間上的前後篇 | 4 |
| `semantic` | embedding 相似度高於門檻 | 5 |

## 開發路線圖

階段依相依關係排序，每個階段結束時都要有一個使用者能實際使用的版本。每個任務是一個 Claude Code session 的工作量，完成後勾選並 commit。

### 階段 1：Vault 讀寫與編輯器

完成標準：能打開資料夾、編輯並儲存 Markdown，外部修改會同步到 App。

- [x] 選擇 vault 資料夾，並記住上次開啟的 vault（啟動時不自動開啟，選擇對話框從上次的位置開始）
- [x] 檔案樹（新增、重新命名、刪除筆記）
- [x] CodeMirror 6 編輯器，開啟與儲存筆記
- [x] chokidar 監聽外部修改並更新畫面
- [x] 記錄 `note_events`（create / edit / open）

### 階段 2：索引、連結、搜尋

完成標準：反向連結與中文搜尋正常，刪掉資料庫後能完整重建。這是整個專案的地基，值得花最多時間。

- [x] 解析器：frontmatter、`[[連結]]`、日期（純函式，必須有測試）
- [x] 寫入資料庫，以 content hash 做增量索引
- [x] FTS5 trigram 中文全文搜尋
- [x] 反向連結 API 與面板
- [x] 輸入 `[[` 時的筆記名稱自動補全
- [x] 快速切換筆記（Quick switcher）

### 階段 3：圖譜視圖

完成標準：全域圖與單篇局部圖可互動，1000 篇筆記時不卡頓。

- [ ] 全域圖譜（先只顯示 `wikilink` 邊）
- [ ] 互動：縮放、點擊開啟筆記、hover 高亮鄰居
- [ ] 單篇局部圖，可調整顯示深度
- [ ] 用大型測試 vault 做效能測試

### 階段 4：時間層

完成標準：時間軸視圖可用，圖譜能依時間範圍與邊類型篩選。

- [ ] 從 `note_events` 推導 `same_session` 邊
- [ ] 從 `event_date` 推導 `same_day` 與 `sequence` 邊
- [ ] 時間軸視圖
- [ ] 圖譜時間滑桿與邊類型篩選
- [ ] 時間參數（session 長度等）做成可調整的設定

### 階段 5：LLM 基礎能力

開始前需完成 Ollama 安裝。完成標準：向量檢索可用，能總結單篇筆記。

- [ ] Ollama client 與連線檢查（未啟動時優雅降級）
- [ ] 筆記切塊與 embedding
- [ ] 向量搜尋與混合檢索（全文 + 向量 + 圖譜鄰居 + 時間篩選）
- [ ] 單次功能：總結筆記、總結選取文字
- [ ] `semantic` 邊加入圖譜

### 階段 6：問答（RAG）

完成標準：對話面板能回答問題，並附上可點擊的來源筆記。

- [ ] 對話面板 UI
- [ ] RAG 回答附來源連結
- [ ] 支援時間範圍篩選（例如「上個月的筆記」）

### 階段 7：Agent

完成標準：能執行多步驟檢索與整理，所有寫入動作都需確認。

- [ ] 唯讀工具：`search_notes`、`get_note`、`get_neighbors`、`list_notes_in_range`
- [ ] 多步驟執行與過程顯示
- [ ] 寫入工具（建立摘要筆記、加標籤），附使用者確認流程

### 階段 8：打磨與打包

- [ ] 設定頁
- [ ] 效能優化
- [ ] 產出安裝檔

## 下一步

Claude Code 接手後，先檢查骨架，再開始階段 1 的第一個任務。

1. **骨架檢查（只讀不改）**：閱讀 `CLAUDE.md`、`src/shared/types.ts`、schema 與資料夾結構，對照本文件列出缺漏或不一致之處，交給使用者決定是否修改。
2. **確認開發指令可用**：`npm run dev`、`npx vitest run`、`npx tsc --noEmit` 都能正常執行，並寫一個最小的範例測試確認 vitest 設定正確。
3. **階段 1 第一個任務**：在 plan mode 下為「選擇 vault 資料夾與檔案樹」寫出實作計畫，存到 `docs/plans/phase1-vault.md`，經使用者同意後再實作。

建議使用者把本文件匯出為 Markdown，存成 `docs/roadmap.md`，在 `CLAUDE.md` 中用 `@docs/roadmap.md` 引用，每個 session 開始時請 Claude Code 讀取並確認目前進度。

## 協作方式

使用者負責架構決策與環境操作，Claude Code 負責在既定架構內實作功能。

1. **一個 session 只做一個任務。** 任務完成、測試通過後 commit，再開新 session。
2. **先計畫再實作。** 每個任務先在 plan mode 寫出計畫並存到 `docs/plans/`，使用者同意後才動手。
3. **自我驗證。** 新功能必須附 vitest 測試，完成前自己執行測試與型別檢查，不能只回報「完成了」。
4. **修改合約前先詢問。** 變更 `types.ts`、資料庫 schema、或新增相依套件，都要先說明理由並取得同意。
5. **不確定就問。** 遇到與本文件「核心設計原則」衝突的情況，停下來詢問，不要自行取捨。
6. **更新進度。** 每完成一個任務，在 `docs/roadmap.md` 勾選對應項目；有新的設計決定時，記錄到 `docs/architecture.md`。
