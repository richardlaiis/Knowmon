# 階段 1 實作計畫：Vault 讀寫與編輯器

完成標準：能打開資料夾、編輯並儲存 Markdown，外部修改會同步到 App。

## 已確認的決定（2026-10-06）

- 補齊階段 0 缺漏的骨架：main / renderer 入口、`vitest.config.ts`、`test-vault/` 範例筆記。
- `src/shared/types.ts` 採用提案版本（`Note`、`NoteEvent`、`TreeNode`、`VaultChange`、`KnowmonAPI`）。所有路徑都是相對於 vault 根目錄的 posix 路徑。
- `note_events` 同時寫入 `<vault>/.knowmon/events.jsonl`（append-only，真相來源）與 SQLite（索引）。DB 刪掉後可從 jsonl 重建歷程。

## 儲存位置

| 資料 | 位置 |
| --- | --- |
| 上次開啟的 vault | `app.getPath('userData')/settings.json` |
| 索引資料庫 | `<vault>/.knowmon/index.db` |
| 編輯歷程日誌 | `<vault>/.knowmon/events.jsonl` |

`.knowmon/` 與所有 dot 開頭的檔案/資料夾不會出現在檔案樹，也不會被監聽。

## 模組

- `src/main/settings.ts`：讀寫 settings.json。
- `src/main/vault/paths.ts`：相對路徑正規化與防止跳出 vault（`..`、絕對路徑、`.knowmon`）。
- `src/main/vault/tree.ts`：掃描資料夾建出 `TreeNode`，以及列出所有 `.md`。
- `src/main/vault/watcher.ts`：chokidar 包裝，只當作「有東西變了」的觸發器。
- `src/main/vault/index.ts`：`Vault` 類別，協調檔案、DB、事件日誌。
- `src/main/db/index.ts`：schema（依 roadmap 目標 schema，向量表留待階段 5）與查詢。
- `src/main/db/events-log.ts`：jsonl 讀寫與重播。
- `src/main/ipc.ts`：IPC handler；`src/shared/channels.ts`：channel 名稱常數。
- renderer：`src/renderer/src/`（App、檔案樹），`src/renderer/editor/`（CodeMirror 元件）。

## 同步策略：reconcile

外部變更一律走同一條路徑 `reconcile()`：走訪 vault，與 `notes` 表比對。

1. mtime 與 size 跟 DB 一樣的檔案跳過，不讀內容（增量）。
2. 其他檔案計算 sha256：hash 一樣只更新 mtime；hash 不同就記 `edit`。
3. DB 有、磁碟沒有的檔案，如果 hash 與某個新檔相同，就視為改名（保留歷程），否則刪除。
4. 磁碟有、DB 沒有的檔案，新增並記 `create`（時間用 birthtime）。

chokidar 事件以 200ms debounce 觸發 reconcile，並把變更透過 `vault:changed` 推給 renderer。App 自己的寫入會在寫完後立刻更新 DB 的 hash/mtime，所以 watcher 回音會在第 1 步被略過。

App 內的建立、改名、刪除直接更新 DB 與日誌，不依賴 hash 推測。刪除會移到系統垃圾桶（`shell.trashItem`）。

## note_events 規則

- `create`：App 內新增，或 reconcile 發現新檔（第一次開啟既有 vault 時也算，時間用 birthtime）。
- `edit`：App 儲存，或 reconcile 發現 hash 改變。
- `open`：`notes.read()`。
- 同一篇筆記、同一種事件在 60 秒內只記一次（自動儲存很頻繁；階段 4 的 session 預設 30 分鐘，1 分鐘的粒度已足夠）。

events.jsonl 格式（每行一筆）：

```
{"ts":1759730000000,"kind":"edit","path":"日記/2026-10-06.md"}
{"ts":1759730000000,"op":"rename","from":"a.md","to":"b.md"}
{"ts":1759730000000,"op":"delete","path":"b.md"}
```

重建：`note_events` 為空且 jsonl 存在時，依序重播日誌（rename 搬移歷程、delete 清除歷程），再寫入目前存在的筆記。

## Renderer

- 啟動時 `vault.getCurrent()`；沒有 vault 就顯示「開啟資料夾」。
- 檔案樹：點擊開啟；右鍵選單可新增筆記、重新命名、刪除。
- 編輯器：CodeMirror 6 + `@codemirror/lang-markdown`，停止輸入 500ms 後自動儲存，`Ctrl/Cmd+S` 立即儲存，切換筆記前會先 flush。
- 外部修改目前這篇：沒有未儲存的內容就直接重新載入；有的話顯示提示列，讓使用者選擇重新載入或保留。

## 測試

- `paths`、`tree`、`settings`、`events-log`（重播）、`db` 查詢、`Vault`（建立/改名/刪除/reconcile/事件節流/DB 重建）。
- renderer 的純函式（autosave debouncer、樹狀路徑工具）。
- 用 `test-vault/` 手動驗證。
