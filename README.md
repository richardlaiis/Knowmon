# Knowmon

類 Obsidian 的本地筆記軟體，特色是時間脈絡連結與本地 LLM agent。技術架構與開發路線見 [`docs/roadmap.md`](docs/roadmap.md)，設計決定見 [`docs/architecture.md`](docs/architecture.md)。

## 環境需求

- Node.js 22 以上（目前開發使用 v24）
- Linux / macOS / Windows。以下 Linux 專屬步驟會特別標註。

## 安裝

```bash
npm install
```

如果之後執行時出現 `Electron failed to install correctly`，代表 Electron 的執行檔沒有下載成功，補下載即可：

```bash
node node_modules/electron/install.js
```

better-sqlite3 附有 N-API 預編譯檔，同一個檔案在 Node（測試）和 Electron（App）都能用，**不需要** rebuild。

### Linux：設定 Electron sandbox 權限

第一次執行前要做一次，否則 App 會直接閃退（錯誤訊息：`The SUID sandbox helper binary was found, but is not configured correctly`）：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

重新安裝 `node_modules` 之後需要再做一次。不想用 sudo 的話，開發時可以改用 `npx electron-vite dev -- --no-sandbox`。

## 執行

```bash
npm run dev       # 開發模式（renderer 支援熱更新）
npm run build     # 型別檢查 + 建置到 out/
npm start         # 執行 out/ 裡建置好的版本
```

啟動後按「Open folder」選一個資料夾作為 vault。App 不會自動開啟上次的 vault，但選擇對話框會從上次的位置開始。

### 資料存放位置

| 資料                             | 位置                                     |
| -------------------------------- | ---------------------------------------- |
| 筆記                             | vault 裡的 `.md` 檔                      |
| 編輯歷程（無法重建，請勿刪除）   | `<vault>/.knowmon/events.jsonl`          |
| 索引資料庫（可刪除，會自動重建） | `<vault>/.knowmon/index.db`              |
| App 設定（上次的 vault）         | Linux：`~/.config/knowmon/settings.json` |

## 自動測試

```bash
npx vitest run       # 單元與整合測試
npm run typecheck    # 型別檢查（main/preload 與 renderer 兩個專案）
npm run lint         # ESLint + Prettier 檢查
```

注意：`npx tsc --noEmit` 在根目錄不會檢查任何檔案（根 tsconfig 只有 project references），請用 `npm run typecheck`。

測試檔放在被測檔案旁邊（`*.test.ts`），主要的有：

- `src/main/vault/vault.test.ts`：建立、改名、刪除、外部修改（reconcile）、事件節流、刪掉 DB 後從 `events.jsonl` 重建、chokidar 監聽
- `src/main/db/*.test.ts`：schema、查詢、日誌重播
- `src/main/vault/paths.test.ts`、`tree.test.ts`：路徑安全檢查、檔案樹
- `src/renderer/editor/autosave.test.ts`、`src/renderer/src/lib/tree.test.ts`：自動儲存、檔案樹路徑工具（含拖曳）

新功能必須附測試，完成前要確認上面三個指令都通過。

## 手動測試

先複製一份測試 vault。**請放在家目錄底下，不要放在 `/tmp`**：`/tmp` 不支援系統垃圾桶，在那裡刪除筆記會失敗。

```bash
cp -r test-vault ~/knowmon-test-vault
npm run dev
```

| #   | 操作                                                                          | 預期結果                                                                        |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | 按「Open folder」，選 `~/knowmon-test-vault`                                  | 左側出現檔案樹，資料夾排在前面                                                  |
| 2   | 點「歡迎」，打幾個字，等約 1 秒                                               | `cat ~/knowmon-test-vault/歡迎.md` 看得到新內容                                 |
| 3   | 按 `Ctrl+S`                                                                   | 立即存檔                                                                        |
| 4   | 按側邊欄上方的新增筆記 / 新增資料夾圖示，或在檔案樹按右鍵                     | 出現 `Untitled` / `Untitled folder` 並進入改名狀態，輸入名稱後按 Enter          |
| 5   | 右鍵 →「Rename」                                                              | 磁碟上的檔案跟著改名；開著的筆記不會被關掉                                      |
| 6   | 把筆記或資料夾拖到另一個資料夾、筆記上，或檔案樹空白處                        | 移進目標資料夾（拖到空白處就移到根目錄）；停在收合的資料夾上約 0.6 秒會自動展開 |
| 7   | 右鍵 →「Delete」                                                              | 跳出確認視窗，檔案移到系統垃圾桶                                                |
| 8   | 開著「歡迎」，在終端機執行 `echo '# 外部改的' > ~/knowmon-test-vault/歡迎.md` | 編輯器自動換成新內容                                                            |
| 9   | 打字後 0.5 秒內馬上做第 8 項                                                  | 出現提示列，可以選「Load external version」或「Keep my version」                |
| 10  | 在終端機新增、`rm`、`mv` 筆記                                                 | 檔案樹自動更新                                                                  |

### 檢查編輯歷程

```bash
cat ~/knowmon-test-vault/.knowmon/events.jsonl
sqlite3 ~/knowmon-test-vault/.knowmon/index.db \
  "select n.path, e.kind, datetime(e.ts/1000,'unixepoch','localtime')
   from note_events e join notes n on n.id = e.note_id order by e.ts"
```

第一次開啟時，每篇筆記會各記一筆 `create`，之後是操作產生的 `open` / `edit`。同一篇筆記的同一種事件，60 秒內只會記一筆。

### 測試 DB 重建

關掉 App 後執行 `rm ~/knowmon-test-vault/.knowmon/index.db*`，再重新開啟同一個 vault，用上面的 sqlite3 指令檢查。歷程應該跟刪除前完全一樣，`events.jsonl` 也不會多出重複的紀錄。

## 常見的終端機訊息

以下訊息在 Linux 上屬於正常現象，可以忽略：

| 訊息                                                           | 原因                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `vaInitialize failed: unknown libva error`                     | 沒有硬體影片解碼驅動，Chromium 改用軟體解碼              |
| `components/dbus/xdg/request.cc ... Request cancelled by user` | 在選擇資料夾的對話框按了取消                             |
| `GLib-GObject ... has no handler with id`                      | 刪除時把檔案移到垃圾桶產生的 GLib 警告，檔案仍會正常刪除 |
| `wayland_object.cc ... Binding to ... version`                 | Wayland 協定版本提示                                     |

如果在 `/tmp` 底下的 vault 刪除筆記，畫面會出現 `Failed to move item to trash`。這是預期行為：系統不支援垃圾桶時，App 不會改成永久刪除。

## 建置安裝檔

```bash
npm run build:linux   # 或 build:win / build:mac
```
