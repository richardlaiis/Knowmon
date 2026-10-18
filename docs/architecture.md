# Knowmon 架構與設計決定

整體技術選型與原則見 `roadmap.md`。這裡記錄實作過程中做出的設計決定。

## 資料存放位置

| 資料                                            | 位置                                           | 可否重建             |
| ----------------------------------------------- | ---------------------------------------------- | -------------------- |
| 筆記                                            | `<vault>/**/*.md`                              | 唯一真相             |
| 編輯歷程                                        | `<vault>/.knowmon/events.jsonl`（append-only） | 唯一真相             |
| 索引資料庫                                      | `<vault>/.knowmon/index.db`                    | 可從上面兩者完整重建 |
| vault 設定（時間、semantic 參數）               | `<vault>/.knowmon/settings.json`               | 不存在時用預設值     |
| App 設定（上次開啟的 vault、Ollama 位址與模型） | `userData/settings.json`                       | —                    |

- `note_events` 無法事後補回，所以 SQLite 裡的只是索引，真相在 `events.jsonl`。DB 被刪除後，重新開啟 vault 時會從日誌重播（`src/main/db/events-log.ts` 的 `replay`）。
- 日誌以路徑記錄，不用 note id（id 重建後會變）。改名寫 `{"op":"rename"}`、刪除寫 `{"op":"delete"}`，重播時歷程跟著路徑走，資料夾改名/刪除會套用到底下所有筆記。
- schema 版本記在 `PRAGMA user_version`。版本不符時直接刪掉 DB 重建，不寫 migration。
- 所有 dot 開頭的檔案/資料夾（含 `.knowmon`、`.obsidian`、`.git`）都不屬於 vault 內容：不顯示、不監聽，IPC 也拒絕存取。

## 同步：reconcile

`Vault`（`src/main/vault/index.ts`）是 main process 唯一能動檔案與 DB 的地方，所有操作經過同一個佇列依序執行。

- 資料夾不進 DB、也不記事件；`notes.createFolder` 只建立空資料夾並通知 renderer（2026-10-06 經使用者同意加入合約）。
- App 內的建立/改名/刪除/寫入：直接更新檔案、DB、日誌，並立刻記下新的 mtime 與 hash。
- 外部修改：chokidar 只負責觸發（200ms debounce），實際差異由 `reconcile()` 比對磁碟與 `notes` 表得出。mtime 沒變就不讀檔；hash 沒變就不算 edit；不見的檔案若與新檔 hash 相同就視為改名，保留歷程。
- App 自己寫入造成的 watcher 回音，會因為 mtime 已經一致而被略過。
- 刪除透過 `shell.trashItem` 移到系統垃圾桶。

## note_events 規則

- `create`：App 內新增，或發現新檔（時間用檔案 birthtime，第一次開啟既有 vault 時每篇都會記一筆）。
- `edit`：App 儲存，或 reconcile 發現內容 hash 改變（時間用 mtime）。
- `open`：`notes.read()`。
- 同一篇、同一種事件在 `EVENT_THROTTLE_MS`（60 秒）內只記一次，避免自動儲存灌爆日誌。階段 4 的 session 預設 30 分鐘，1 分鐘粒度足夠。

## 索引、連結、搜尋（階段 2）

- 解析器 `src/main/indexer/parse.ts` 是純函式：`event_date` 取 frontmatter `date:`，其次是檔名開頭的 `YYYY-MM-DD`；wikilink 排除 frontmatter、圍欄程式碼與行內程式碼；YAML 損毀時當作沒有 frontmatter。
- 標題一律用檔名（使用者決定，2026-10-07），frontmatter 的 `title:` 只是一般屬性。
- wikilink 解析規則在 `src/shared/links.ts`，main 與 renderer 共用：不分大小寫、Unicode NFC；目標含 `/` 比對路徑結尾，否則比對檔名；同名時取路徑最短者，再依字典序。
- `links` 表：wikilink 每個（來源, 目標）一列，`weight` 為出現次數。`dst` 為 NULL 表示目標不存在，`target` 保留原文；筆記新增、改名、刪除後由 `relinkWikilinks` 重新解析所有 `dst`（不重讀檔案），所以先寫連結再建筆記也會接上。改名不會改寫其他筆記裡的 `[[舊名]]`。
- `notes_fts`（trigram，rowid = notes.id）存標題與內文。內文的 frontmatter 換成等量空行，行號與原檔一致；反向連結的上下文直接從這裡取，不讀檔。刪除與改名靠 trigger 同步。
- 增量：內容 hash 與 DB 相同時只更新 mtime，不重新解析；改名時強制重新解析（檔名日期可能改變）。
- 搜尋：依空白切詞、全部 AND。3 字以上走 `MATCH`（bm25，標題權重 10），不足 3 字（常見的 2 字中文詞）用 `LIKE`。標題包含所有詞的排前面。摘要在 main 以 JS 擷取，用 `TextSegment[]` 回傳，renderer 不插入 HTML。
- Renderer：側欄「Files / Search」分頁（`Ctrl/Cmd+Shift+F`）、`Ctrl/Cmd+O` Quick switcher（模糊比對，最近開啟的排前面，只存在記憶體）、右側反向連結面板。`Ctrl/Cmd+點擊` wikilink 開啟筆記（加 Shift 開在新分頁），目標不存在時在 vault 根目錄建立。`[[` 自動補全使用 `@codemirror/autocomplete`，插入能唯一解析的最短目標。

## 圖譜（階段 3）

- 資料：`graph.get()` 回傳所有筆記與已解析的 wikilink（`src/main/db/graph.ts`），同一對筆記的多列合併、權重相加，排除自我連結。尚未建立的筆記不顯示（使用者決定，2026-10-07）。局部圖由 renderer 以 BFS 從全域資料算出，不另外加 IPC。
- 繪製用 Cytoscape canvas，版面配置用 `d3-force`，在 Web Worker（`src/renderer/graph/layout.worker.ts`）執行；Cytoscape 內建的 `cose` 與 `fcose` 在 1000 篇時要 10–37 秒且會卡住 UI。座標以 `Float32Array`（transferable）傳回主執行緒。
- 標籤不重疊：碰撞力以「節點＋下方標籤」的矩形計算（`labelCollide.ts`，標籤寬度依字元估計：中日韓文字一個字寬、其他約 0.6），收斂時再做一次只有碰撞的整理。Cytoscape 的標籤與節點在同一座標系、跟著縮放，所以版面上不重疊，任何縮放倍率都不會重疊。為了留出空間，斥力較強、向心力較弱、不限制斥力距離（實測見 `docs/plans/phase3-graph.md`）。
- 超過 `LARGE_GRAPH`（500）個節點時：Worker 收斂後才一次回傳座標（Cytoscape canvas 每次整張重畫約 45ms），hover 只高亮鄰居、不淡化其他元素。
- 節點座標快取在 App 的記憶體中（每個 vault 一份，全域圖與局部圖各一），不寫入磁碟。新節點放在已有座標的鄰居旁邊，少量變動時只輕度重新加熱，不會整張重排。
- 全域圖是一種分頁（最多一個），分頁存在期間保持掛載，切到別的分頁時只是隱藏，切回來不需重建。
- Cytoscape 的 WebGL renderer 是實驗功能，測試中點擊判定失效，不使用。效能數據與取捨見 `docs/plans/phase3-graph.md`。
- 顏色讀 `main.css` 的 CSS 變數（`src/renderer/graph/style.ts`），切換主題時重新套用。偏好存在 localStorage：`knowmon.graph.labels`、`knowmon.graph.depth`、`knowmon.sidePanel`。
- 右側面板分為 Backlinks / Local graph 兩個分頁，跟著目前的筆記分頁；目前是圖譜分頁時顯示「沒有開啟的筆記」。

## 時間層（階段 4）

概念、規則與設計理由見 `docs/time-layer.md`；計畫與決定見 `docs/plans/phase4-time.md`。

- 三種時間邊由純函式 `src/main/indexer/timeLinks.ts` 從 `notes` 與 `note_events` 推導，寫進 `links` 表（`dst` 一定不為 NULL）：
  - `same_session`：全 vault 的 `edit` 事件依時間排序，間隔超過 `sessionGapMinutes` 就切成新 session；同一 session 編輯的筆記兩兩相連，權重為共同的 session 數。只看 `edit`（`create` 在第一次開啟 vault 時用 birthtime 補記，可能全部擠在同一刻；`open` 只是閱讀）。編輯超過 `sessionMaxNotes` 篇的 session 視為批次操作，不產生邊。
  - `same_day`：`event_date` 相差 ≤ `sameDayWindowDays`，權重 `1 / (1 + 相差天數)`。
  - `sequence`：同一資料夾（含根目錄）中有 `event_date` 的筆記依日期（同日依路徑）串起來，早 → 晚（使用者決定「同一主題」= 同一資料夾，2026-10-08）。
  - 無方向的邊以路徑字典序較小者為 `src`。
- 時間邊不做增量：事件、日期、路徑、設定任何一項改變都可能影響全 vault。`Vault` 改變時標記 dirty，`graph()` 讀取前才整批重算（1000 篇、5 萬筆事件在 500ms 內，見 `src/main/db/time.test.ts`）。不需要 schema 變更；DB 重建時從日誌重播事件後重算。
- session 切分（`sessionize`）、日期換算、參數預設值與範圍在 `src/shared/time.ts`，main 與 renderer 共用；時間軸的 session 與 `same_session` 用同一個函式與參數（時間軸也把 `create` 算進 session）。
- 時間參數存在 vault 的 `.knowmon/settings.json` 的 `time` 欄位（使用者決定，2026-10-08），main 以 `clampTimeSettings` 限制範圍；寫入時保留檔案中其他欄位。
- `GraphNode.activeDays`：有 `create` / `edit` 事件的本地日期，圖譜「寫作時間」篩選用。日期一律用本地時區（`localDay`），main 與 renderer 在同一台機器上。
- 圖譜：`edgeId` 含類型（同一對筆記可能同時有多種邊）。邊類型篩選影響版面（時間邊也參與排版），切換時沿用座標快取、輕度加熱；時間範圍篩選只替節點加 `hidden` class（`display: none`），不重新排版，以 `requestAnimationFrame` 節流。haystack 邊不支援箭頭，`sequence` 的方向沒有畫出來；同一對筆記的多種邊會重疊在同一條線上。
- 偏好（localStorage）：`knowmon.graph.types`、`knowmon.graph.localTypes`（逗號分隔，預設全開）、`knowmon.graph.timeAxis`、`knowmon.graph.undated`、`knowmon.timeline.mode`。時間範圍本身不存。
- 時間軸是一種分頁（`kind: 'timeline'`，最多一個），和圖譜一樣存在期間保持掛載；隱藏時不重新取得資料。「寫作時間」模式一次取得全部的 `create` / `edit` 事件（`timeline.activity`），在 renderer 分組。

## LLM（階段 5）

計畫與決定見 `docs/plans/phase5-llm.md`。所有 Ollama 呼叫都在 `src/main/llm/`；Ollama 是可選的，連不上時其他功能照常。

- Ollama client（`ollama.ts`）只用 Node 內建的 `fetch`，對話一律帶 `think: false`（qwen3 不輸出思考過程；模型不支援時不帶參數重送）。連線檢查逾時 2 秒、embedding 每批 60 秒、對話可取消不逾時。
- `LlmService`（`service.ts`）管理連線狀態：開啟 vault、使用者按 Retry、embedding 或總結遇到離線時檢查；離線時每 30 秒重試。狀態以 `llm:statusChanged` 推送給 renderer。設定（位址、模型）存 App 的 `userData/settings.json`，所有 vault 共用。
- 切塊（`indexer/chunk.ts`，純函式）：依標題切章節、空行分段、累積到約 800 字；過長的段落依句子切（英文句點後要接空白，避免切開 3.14）；圍欄程式碼整段保留。每塊記起始行與章節標題路徑，送去 embedding 的文字前面加上「標題 › 章節」。
- Schema 版本 3：`chunks`（`AUTOINCREMENT`，id 不重複使用）、`meta`（`embed_model`、`embed_dim`）。比計畫多了 `chunks.heading` 欄位（embedding 文字要用）。向量表 `vec_chunks`、`vec_notes`（sqlite-vec `vec0`，cosine）在第一次拿到 embedding 時才建立，維度取決於模型；刪除用 trigger。換模型時丟掉兩張表重算。
- `indexFile` 重新解析時一併重寫 chunk；內容完全相同時（例如改名）保留原本的向量。只動 DB，不呼叫 Ollama。
- `Embedder` 在背景每批 16 塊呼叫 Ollama。**不經過 Vault 佇列**：better-sqlite3 是同步的，寫入不會與其他操作交錯；embedding 途中筆記被修改或刪除時，舊 chunk 已不存在（id 不重複），`storeEmbeddings` 會略過。整篇向量 = 各塊向量正規化後的平均。
- 混合檢索（`retrieve.ts`）：全文（`searchNotes`）與向量（`vec_chunks` KNN）各取前 50 篇，以 RRF（k = 60）合併；前 5 名的 wikilink／semantic 鄰居加上種子分數的一半。日期篩選用 `event_date`，沒有的話用最後修改日。查詢向量取不到時（離線、還沒建好、模型不同）退回全文＋圖譜，`vector: false`。
- semantic 邊：每篇取相似度最高的 5 篇（≥ 門檻）的聯集，權重為相似度。門檻預設 0.65：bge-m3 在 test-vault 上無關的句子約 0.42、相關的約 0.77，0.6 時會多出幾條勉強的邊（實測見計畫）。vec0 逐篇 KNN 在 1000 篇時要 1.5 秒，改在 JS 兩兩計算（約 0.6 秒），每約 10ms 讓出一次 event loop，不卡住 main process；因此 `Vault.graph()` 改成 async。和時間邊一樣讀取圖譜前才整批重算（整篇向量、筆記、設定改變時標 dirty）。
- 總結（`summarize.ts`）：條列、保留原文的 wikilink。提示詞附上原文的連結清單（`linkTargets`），只准使用清單裡的連結；提示詞本身不寫任何 `[[...]]` 範例（小模型會把範例原樣抄進總結）。輸出再經 `createLinkFilter` 串流過濾，原文沒有的 `[[x]]` 改成純文字 `x`，等到 `]]` 或換行才判斷，所以連結被切在多個片段之間也沒問題。語言由 `SummaryRequest.language` 決定（`zh-TW` 預設、`en`，2026-10-12 經使用者同意加入合約），AI 分頁的「中文 / EN」切換，偏好存 localStorage `knowmon.summary.language`。英文模式在內容後面再提醒一次用英文：qwen3:8b 對中文筆記容易跟著用中文回答，提示詞裡放中文範例時甚至改用簡體。超過 12000 字時先每 6000 字分段摘要再合併（分段的結果不顯示）。內文從 `notes_fts` 取（frontmatter 已換成空行），所以 renderer 會先 flush 自動儲存。串流片段以 `llm:summary` 推送，renderer 依 request id 對應。
- 總結以 Markdown 渲染（`renderer/chat/markdown.ts`）：用編輯器同一個 lezer 解析器（GFM）加上 wikilink 擴充，轉成簡單的樹再由 React 產生元素，不插入 HTML；外部連結只允許 http(s) 與 mailto，表格與 HTML 顯示原文。
- Renderer：右側面板新增「AI」分頁（狀態、總結），側欄底部顯示狀態；搜尋面板有 Keyword / Hybrid 切換（`knowmon.search.mode`），Hybrid 按 Enter 才查詢，結果點擊後捲到最相關的段落。背景 embedding 結束時（busy → false）遞增 `indexVersion`，讓圖譜取得新的 semantic 邊。
- 圖譜邊類型偏好的儲存格式改為「`a,-b`」（記錄開與關）；舊格式沒有提到的新類型（semantic）預設開啟。

## 問答（階段 6）

計畫與決定見 `docs/plans/phase6-rag.md`。

- `llm.ask(req)` 回傳 request id，片段經 `llm:answer` 推送（與總結相同的模式，取消沿用 `llm.cancel`）。第一個片段帶 `sources`、實際套用的 `range` 與 `vector`，最後的 `done` 帶回答中實際引用的編號 `cited`。
- 流程（`src/main/llm/ask.ts`）：解析時間範圍 → 決定關鍵字與向量查詢（`planQuery`）→ `retrieve`（前 8 篇）→ 每篇取最相關的 chunk、再依名次輪流補相鄰的 chunk，總共約 8000 字（`gatherSources`）→ 提示詞附編號來源 → 串流過濾。
- 全文改用關鍵字 OR：中文問句沒有空白，`searchNotes` 的 AND 整句比對不會命中。`keywords()` 去掉標點、疑問詞、虛詞與「第二點」之類的序數；`retrieve()` 的內部參數 `keywords` 讓每個關鍵字各自搜尋，命中越多個的排越前面（側欄搜尋仍是 AND）。
- 只有時間、沒有關鍵字（「上個月寫了什麼？」），或檢索結果為空但有時間範圍時，改列出範圍內的筆記（新 → 舊）。完全找不到來源時直接回覆固定文字，不呼叫模型。
- 時間範圍解析是純函式 `src/shared/timeRange.ts`（main 與 renderer 共用，renderer 輸入時即時顯示偵測到的範圍）：今天／昨天、這週／上週（週一開始）、這個月／上個月、今年／去年、最近 N 天／週／個月、`YYYY-MM`、日期與日期範圍、沒寫年份的月份（取最近一次）及對應的英文。只取最前面的一個片語，並從檢索查詢中移除。`AskRequest.range`：`undefined` 由 main 解析、`null` 不篩選、有值則直接使用。
- 引用格式 `[n]`：對應到段落（路徑＋行號），點擊捲到該行。`createCitationFilter` 把 `[1, 2]`、`【1】` 統一成 `[1][2]`，超出範圍的拿掉；再經 `createLinkFilter`，只保留來源中出現過的 wikilink 與來源標題。
- 回答語言依問題（漢字數 ≥ 英文單字數時用繁體中文）；英文時在內容後重申語言。多輪對話附最近 3 輪（6 則，各截到 1000 字），舊回答的 `[n]` 先去掉（對應的是之前的來源）。追問（沒有關鍵字或語氣像追問）時向量查詢加上前一個問題。
- Renderer：AI 分頁上方「Chat / Summary」切換（`knowmon.ai.mode`），`Ctrl/Cmd+Shift+A` 打開對話並聚焦輸入框；`Ctrl/Cmd+Shift+S` 切到 Summary。對話狀態是純函式（`renderer/chat/conversation.ts`），只存在 App 的記憶體，換 vault 時清空。`Markdown` 元件的 `citations` 選項把 `[n]` 解析成引用（lezer inline 擴充，排在 Link 之前，`[1][2]` 不會被當成參考連結）。複製回答時 `[n]` 換成 `[[來源標題]]`。輸入法選字時的 Enter 不送出。

## Agent（階段 7）

計畫與決定見 `docs/plans/phase7-agent.md`。程式在 `src/main/llm/agent/`。

- 使用 Ollama 原生的工具呼叫（`/api/chat` 帶 `tools`）。`OllamaClient.chatTools` 回傳文字與 `tool_calls`（`arguments` 是字串時先解析 JSON）；模型不支援工具時（`does not support tools`）回報清楚的錯誤，請使用者在 Settings 換模型。agent 請求帶 `num_ctx = 16384`（`AGENT_NUM_CTX`）。
- 迴圈（`loop.ts` 的 `runAgent`，chat／工具／確認都由呼叫者注入）：模型回覆工具呼叫 → 依序執行 → 結果以 `role: 'tool'` 加回 → 下一步，直到模型直接回答。最多 8 次工具呼叫，用完後不再提供工具並要求作答。相同工具＋參數（不分順序）的重複呼叫不執行；工具錯誤、不認得的工具都把錯誤當結果回給模型，不中止任務。每個結果截到 3000 字，總量超過 16000 字時從最舊的換成一行說明（該呼叫可以再做一次）。
- 工具（`tools.ts`）回傳精簡的純文字（不是 JSON），每篇筆記「標題 | 路徑 | 日期」。路徑參數也接受標題或 `[[標題]]`（`shared/links.ts` 的規則）。時間範圍由 `period` 參數以 `parseTimeRange` 解析，**不讓模型自己換算日期**（實測 qwen3:8b 把「上週」算錯一天、且只給 `from`）；寫在 `query` 裡的時間片語也會被取出。`search_notes` 沿用問答的關鍵字 OR＋向量檢索。`get_note` 用 `Vault.peek` 讀檔，**不記 `open` 事件**（不是使用者打開的），長筆記以 `offset` 分段。`get_neighbors` 先 `await vault.graph()` 讓時間邊與 semantic 邊是最新的，依類型分組，並列出尚未建立的連結目標。
- 寫入工具只產生提案（`AgentStep.status = 'confirm'` 帶 `proposal`），`LlmService` 以 `${request id}:${step}` 等待 `llm.confirm`。停止、換 vault、關閉 App 時等待中的提案視為拒絕。使用者可修改提案（`create_note` 的路徑與內容、`add_tags` 刪掉個別標籤），IPC 只取這些欄位，其餘沿用 main 端原本的提案。
  - `create_note` 走 `Vault.create(path, content)`（`wx`，絕不覆蓋；帶內容時記 `create` 與 `edit`）。路徑補 `.md`，經 `normalizeRel` 拒絕 `..` 與隱藏資料夾。
  - `add_tags` 走 `Vault.update(path, f)`：在佇列中重新讀檔、套用、寫回，所以等待確認期間使用者改過筆記也不會被蓋掉。寫入後推送 `vault:changed`（`change`），開著的分頁沿用外部修改的處理（沒有未儲存內容就重新載入）。
- 標籤寫在 frontmatter 的 `tags:`（使用者決定，2026-10-18）。`addTags`（`tags.ts`，純函式）只改 `tags` 那幾行：flow 清單加在 `]` 前、區塊清單照縮排加在後面、單一字串或多行 flow 改寫成 `tags: [...]`、沒有 `tags` 時加在結尾的 `---` 前、沒有 frontmatter 時在開頭新增；保留 CRLF。比對既有標籤不分大小寫、忽略 `#`；YAML 損毀時拒絕修改。
- 最終回答經 `createLinkFilter`，只保留工具結果中出現過的筆記標題與讀到的內文裡的連結。系統提示詞附今天的日期與星期，語言依任務（`detectLanguage`）。多輪只附之前的任務與最終回答（不含工具過程）。
- Renderer：AI 分頁上方改為「Chat / Agent / Summary」（使用者決定保留 Chat，2026-10-18）（`knowmon.ai.mode` 多了 `agent`）；`Ctrl/Cmd+Shift+G` 打開 Agent 並聚焦輸入框。任務狀態是純函式（`renderer/chat/agentRun.ts`）：文字與步驟依到達順序排列，同 index 的步驟取代；最後一個步驟之後的文字是最終回答，之前的以淡色顯示。等待確認時 Agent 按鈕、AI 分頁與側欄底部的狀態都顯示提醒。只存在記憶體，換 vault 時清空。

## 工作區：分頁與面板

計畫與決定見 `docs/plans/workspace-tabs.md`。

- 分頁狀態是純函式（`src/renderer/src/workspace/tabs.ts`）：分頁為筆記、圖譜或時間軸；同一篇筆記只開一個分頁（再開就切過去），圖譜與時間軸分頁各最多一個。
- 點選筆記（檔案樹、搜尋、反向連結、圖譜、Quick switcher）預設**取代目前分頁**，`Ctrl/Cmd+點擊`或中鍵開新分頁（使用者決定，2026-10-07）。新建的筆記開在新分頁。沒有上一頁／下一頁。
- 取代分頁時分頁換新 id；畫面以分頁 id 作為 key，所以換筆記會重建編輯器，改名（`renamePaths`）則保留 id 與編輯器（游標、undo 不受影響）。
- 每個筆記分頁（`NotePane`）有自己的 CodeMirror，第一次切到時才讀檔（還原很多分頁時不會一次讀所有檔案、也不會替每篇記 `open` 事件），之後保持掛載、隱藏。外部修改由各分頁自己監聽處理；外部刪除由 App 關閉受影響的分頁。
- 自動儲存仍是單一個 `createAutosave`：同時只有目前分頁在輸入，編輯另一篇時會先寫出前一篇；取代或關閉分頁前也會 flush。
- 分頁存在 renderer 的 localStorage（`knowmon.tabs:<vault 路徑>`），每個 vault 各一份；還原時略過已不存在的筆記。還原完成前不存檔，避免空狀態蓋掉上次的分頁。
- Electron 預設選單把 `Ctrl/Cmd+W` 綁成關閉視窗，main process 改用自訂選單（`src/main/index.ts` 的 `buildMenu`）拿掉它，renderer 用來關分頁。
- 面板：左側欄與右側面板寬度可拖曳（`Splitter`，雙擊恢復預設），寬度限制在上下限內且編輯器至少保留 `EDITOR_MIN`（`workspace/layout.ts`）。`Ctrl/Cmd+B`、`Ctrl/Cmd+Alt+B` 或分頁列兩端的按鈕開關左右面板。寬度與開關存 localStorage `knowmon.layout`，所有 vault 共用。
- 全域快捷鍵在 `App.tsx` 以 capture 階段攔截並 `stopPropagation`，編輯器不會再處理同一個按鍵（CodeMirror 的 `Ctrl/Cmd+G`「找下一個」因此停用，改用 `F3`）。所有快捷鍵的列表在 README 的「快捷鍵」，新增或修改快捷鍵時要同步更新。
- 快捷鍵：`Ctrl/Cmd+W` 關分頁、`Ctrl+Tab` / `Ctrl+Shift+Tab` 切換、`Ctrl/Cmd+T` 以新分頁開 Quick switcher（Quick switcher 裡 `Ctrl/Cmd+Enter` 也是新分頁）、`Ctrl/Cmd+G` 圖譜分頁、`Ctrl/Cmd+Shift+T` 時間軸分頁。

## 啟動

- 啟動時不自動開啟上次的 vault（使用者要求，2026-10-06）。`settings.json` 仍記住上次的 vault，「Open folder」對話框會以它作為起始位置。

## Renderer

- 自動儲存：停止輸入 500ms 後寫入，`Ctrl/Cmd+S` 立即寫入。取代或關閉分頁、改名、刪除、換 vault 前都會先 flush。
- 外部修改開著的筆記（任何已載入的分頁）：沒有未儲存內容就直接重新載入；有的話在該分頁顯示提示列讓使用者選擇。
- 檔案樹拖曳移動直接使用 `notes.rename(from, to)`，不另外加 IPC。拖曳資料用自訂 MIME type `application/x-knowmon-path`，和從系統拖進來的檔案區分。
- Markdown 即時渲染（`src/renderer/editor/livePreview.ts`）：以 CodeMirror 裝飾實作，不改動文件內容。行內元素（粗體、連結、程式碼、wikilink）在游標碰到該元素時顯示原始語法；區塊標記（標題 #、引用 >、清單、分隔線）在游標所在行顯示。`Ctrl/Cmd+E` 或右上角按鈕切換原始碼模式，偏好存在 renderer 的 localStorage。
- frontmatter 用正則判斷文件開頭的 `---` 區塊，不寫 lezer 語法擴充（未閉合的 `---` 會被誤吞整份文件）。wikilink 也用正則找，並排除程式碼內的；lezer 會把 `[[x]]` 裡的 `[x]` 當成 Link，所以與 wikilink 重疊或沒有網址的 Link 不做渲染。
- 程式碼區塊：游標不在區塊內時，``` 圍欄隱藏，只在右上角顯示語言（圍欄行保持原本行高，行號才對得齊）。語法上色使用 `@codemirror/language-data`（2026-10-06 經使用者同意加入），語言套件在筆記裡出現時才動態載入；不認得的語言以純文字顯示。
- 外部連結需 `Ctrl/Cmd+點擊`，只允許 http(s) 與 mailto，經 main process 的 `setWindowOpenHandler` 交給系統瀏覽器。
- 字型清單要明確寫 `Noto Sans CJK TC`：單獨成一個文字節點的全形標點（被隱藏標記切開時常發生）若交給系統 fallback，會選到窄字形。
- 主題：淺色（米白）與深色（比 Nord 更深的底色、Nord 程式碼配色）。所有顏色都是 `main.css` 的 CSS 變數，深色版定義在 `:root[data-theme='dark']`，程式碼語法顏色用 `--hl-*` 變數，所以 `livePreview.ts` 不需要知道目前主題。選擇存在 renderer 的 localStorage（`knowmon.theme`），在 React 第一次渲染前就套用以避免閃爍。
- IPC channel 名稱集中在 `src/shared/channels.ts`。

## 開發環境注意事項

- better-sqlite3 13 附 N-API prebuild，同一個 binary 在 Node（vitest）和 Electron 都能用，不需要 rebuild。
- sqlite-vec 由 `openDb` 載入（`node_modules/sqlite-vec-<平台>` 裡的 `.so`）；載入失敗時向量功能停用，AI 狀態顯示原因。打包時（階段 8）要確認這個檔案沒有被包進 asar。
- Cytoscape 的 canvas 以整數像素取高度，容器高度有小數時會溢出 1px，所以 `.graph-canvas` 設 `overflow: hidden`（工具列換行時曾讓整頁出現捲軸）。
- chokidar 5 只有 ESM，在 `electron.vite.config.ts` 中設定為打包進 main，而不是 external。
- `npx tsc --noEmit` 搭配根目錄的 project references 不會檢查任何檔案，型別檢查請用 `npm run typecheck`。
