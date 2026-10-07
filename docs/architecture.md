# Knowmon 架構與設計決定

整體技術選型與原則見 `roadmap.md`。這裡記錄實作過程中做出的設計決定。

## 資料存放位置

| 資料 | 位置 | 可否重建 |
| --- | --- | --- |
| 筆記 | `<vault>/**/*.md` | 唯一真相 |
| 編輯歷程 | `<vault>/.knowmon/events.jsonl`（append-only） | 唯一真相 |
| 索引資料庫 | `<vault>/.knowmon/index.db` | 可從上面兩者完整重建 |
| App 設定（上次開啟的 vault） | `userData/settings.json` | — |

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

## 工作區：分頁與面板

計畫與決定見 `docs/plans/workspace-tabs.md`。

- 分頁狀態是純函式（`src/renderer/src/workspace/tabs.ts`）：分頁為筆記或圖譜；同一篇筆記只開一個分頁（再開就切過去），圖譜分頁最多一個。
- 點選筆記（檔案樹、搜尋、反向連結、圖譜、Quick switcher）預設**取代目前分頁**，`Ctrl/Cmd+點擊`或中鍵開新分頁（使用者決定，2026-10-07）。新建的筆記開在新分頁。沒有上一頁／下一頁。
- 取代分頁時分頁換新 id；畫面以分頁 id 作為 key，所以換筆記會重建編輯器，改名（`renamePaths`）則保留 id 與編輯器（游標、undo 不受影響）。
- 每個筆記分頁（`NotePane`）有自己的 CodeMirror，第一次切到時才讀檔（還原很多分頁時不會一次讀所有檔案、也不會替每篇記 `open` 事件），之後保持掛載、隱藏。外部修改由各分頁自己監聽處理；外部刪除由 App 關閉受影響的分頁。
- 自動儲存仍是單一個 `createAutosave`：同時只有目前分頁在輸入，編輯另一篇時會先寫出前一篇；取代或關閉分頁前也會 flush。
- 分頁存在 renderer 的 localStorage（`knowmon.tabs:<vault 路徑>`），每個 vault 各一份；還原時略過已不存在的筆記。還原完成前不存檔，避免空狀態蓋掉上次的分頁。
- Electron 預設選單把 `Ctrl/Cmd+W` 綁成關閉視窗，main process 改用自訂選單（`src/main/index.ts` 的 `buildMenu`）拿掉它，renderer 用來關分頁。
- 面板：左側欄與右側面板寬度可拖曳（`Splitter`，雙擊恢復預設），寬度限制在上下限內且編輯器至少保留 `EDITOR_MIN`（`workspace/layout.ts`）。`Ctrl/Cmd+B`、`Ctrl/Cmd+Alt+B` 或分頁列兩端的按鈕開關左右面板。寬度與開關存 localStorage `knowmon.layout`，所有 vault 共用。
- 全域快捷鍵在 `App.tsx` 以 capture 階段攔截並 `stopPropagation`，編輯器不會再處理同一個按鍵（CodeMirror 的 `Ctrl/Cmd+G`「找下一個」因此停用，改用 `F3`）。所有快捷鍵的列表在 README 的「快捷鍵」，新增或修改快捷鍵時要同步更新。
- 快捷鍵：`Ctrl/Cmd+W` 關分頁、`Ctrl+Tab` / `Ctrl+Shift+Tab` 切換、`Ctrl/Cmd+T` 以新分頁開 Quick switcher（Quick switcher 裡 `Ctrl/Cmd+Enter` 也是新分頁）、`Ctrl/Cmd+G` 圖譜分頁。

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
- chokidar 5 只有 ESM，在 `electron.vite.config.ts` 中設定為打包進 main，而不是 external。
- `npx tsc --noEmit` 搭配根目錄的 project references 不會檢查任何檔案，型別檢查請用 `npm run typecheck`。
