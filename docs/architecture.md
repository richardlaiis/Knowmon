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

## 啟動

- 啟動時不自動開啟上次的 vault（使用者要求，2026-10-06）。`settings.json` 仍記住上次的 vault，「Open folder」對話框會以它作為起始位置。

## Renderer

- 自動儲存：停止輸入 500ms 後寫入，`Ctrl/Cmd+S` 立即寫入。切換筆記、改名、刪除、換 vault 前都會先 flush。
- 外部修改目前開著的筆記：沒有未儲存內容就直接重新載入；有的話顯示提示列讓使用者選擇。
- 檔案樹拖曳移動直接使用 `notes.rename(from, to)`，不另外加 IPC。拖曳資料用自訂 MIME type `application/x-knowmon-path`，和從系統拖進來的檔案區分。
- IPC channel 名稱集中在 `src/shared/channels.ts`。

## 開發環境注意事項

- better-sqlite3 13 附 N-API prebuild，同一個 binary 在 Node（vitest）和 Electron 都能用，不需要 rebuild。
- chokidar 5 只有 ESM，在 `electron.vite.config.ts` 中設定為打包進 main，而不是 external。
- `npx tsc --noEmit` 搭配根目錄的 project references 不會檢查任何檔案，型別檢查請用 `npm run typecheck`。
