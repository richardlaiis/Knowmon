# 階段 8 任務 1：在 Linux 試打包

## Context

階段 8 的最後一項是「產出安裝檔」，但專案到現在都只從原始碼執行，打包從沒真正跑過。打包是階段 8 風險最高的部分，所以先做：在 Linux 打出 deb 與 AppImage，確認安裝後所有功能（包括 AI 向量功能）都正常。範本留下的設定也一起清掉。設定頁與效能優化是後面的任務；最後一個任務才做正式版、三個平台打包與文件收尾。

目前已知的問題：

1. **sqlite-vec 在打包版會載入失敗。** `src/main/db/index.ts` 的 `loadVectorExtension` 呼叫 `sqliteVec.load(db)`。它以 `require.resolve` 找到 `vec0.so`，打包後路徑落在 `…/resources/app.asar/node_modules/sqlite-vec-linux-x64/vec0.so`。這個路徑交給 SQLite 的 C 層 `dlopen` 時不經過 Electron 的 asar 轉址，所以載入不了。更糟的是 `electron-builder.yml` 的 `asarUnpack` 只有 `resources/**`，`.so` 根本不在磁碟上。結果是打包版的 Hybrid 搜尋、Semantic 邊、問答、Agent 全部降級。better-sqlite3 的 `.node` 經 Node 的 `require` 載入，electron-builder 的 smartUnpack 會自動處理，不受影響。
2. **App 設定資料夾會改名。** 開發版的 userData 是 `~/.config/knowmon`（package.json 的 `name`），打包版預計會變成 `~/.config/Knowmon`（productName）。這樣上次的 vault、Ollama 設定、分頁與主題偏好（localStorage）都讀不到。使用者決定**固定用 `knowmon`**。
3. **範本留下的設定沒改：**
   - `package.json` 的 `description`、`author`（example.com）、`homepage`（electron-vite.org）。
   - `electron-builder.yml`：`linux.maintainer: electronjs.org`、`publish`（指向 example.com 的自動更新；專案沒有用 electron-updater）、macOS `extendInfo` 的相機／麥克風／文件夾權限說明。
   - `files` 沒有排除 `docs/`、`test-vault/`、`scripts/`，它們會被包進 app。
4. **Linux 格式**（使用者決定）：deb ＋ AppImage，拿掉 snap（需要 snapcraft，這台沒有）。deb 的 after-install 腳本會設定 chrome-sandbox 與 AppArmor profile（Ubuntu 24+）。AppImage 在 Ubuntu 24+ 會被 AppArmor 擋住 sandbox（這台 `apparmor_restrict_unprivileged_userns = 1`），只記錄現象並寫進說明，不硬改。
5. **作者資訊**（使用者決定）：`Richard Lai <richardlaiis@proton.me>`。

圖示仍是 Electron 預設圖示（`build/icon.*`、`resources/icon.png`），留到最後的正式打包任務處理，這次不動。

## 步驟

### 0. 收尾與存檔

- 刪除記憶 `image-feature-pending-test.md` 與 `MEMORY.md` 中對應的那一行（使用者已測過圖片功能）；`electron-headless-testing.md` 的 `[[image-feature-pending-test]]` 一併拿掉。
- 把這份計畫存成 `docs/plans/phase8-packaging.md`（依 roadmap 慣例）。之後的發現與量測結果寫在這份文件。

### 1. sqlite-vec 從 asar 外載入

`src/main/db/index.ts`：

- 新增並 export 純函式 `unpackedPath(p: string): string`：把路徑中的 `app.asar` 目錄段換成 `app.asar.unpacked`，`/` 與 `\` 都要處理；已經是 `app.asar.unpacked` 或不在 asar 裡的路徑原樣回傳。
- `loadVectorExtension` 改成 `db.loadExtension(unpackedPath(sqliteVec.getLoadablePath()))`，失敗時的 `console.warn` 與降級邏輯不變。開發與測試時路徑沒有 `app.asar`，行為完全一樣。
- 測試加在 `src/main/db/vectors.test.ts`：Linux 路徑、Windows 反斜線路徑、已 unpacked、不在 asar、檔名剛好含 `app.asar` 字樣但不是目錄段。

`electron-builder.yml`：`asarUnpack` 加入 `node_modules/sqlite-vec-*/**`。

### 2. 固定 userData 為 `knowmon`

`src/main/index.ts`：在模組頂層（`app.whenReady()` 之前、`registerSchemesAsPrivileged` 旁邊）呼叫 `app.setPath('userData', join(app.getPath('appData'), 'knowmon'))`，附一行註解說明原因。這是 main process 內部行為，不動 `types.ts` 與 IPC 合約。

### 3. 清理打包設定

`package.json`：

- `description`：一句話描述 Knowmon。
- `author`：`Richard Lai <richardlaiis@proton.me>`。
- `homepage`：`https://github.com/richardlaiis/Knowmon`。

`electron-builder.yml`：

- `files` 增加排除：`!{docs,test-vault,scripts}/**`、`!{CLAUDE.md,vitest.config.ts}`。
- `linux.target` 改為 `AppImage`、`deb`；`linux.maintainer` 改為作者資訊；`linux.category` 改為 `Office`。
- 刪除 `publish` 區塊（沒有自動更新）。
- 刪除 `mac.extendInfo` 中用不到的權限說明。

### 4. 建置並檢查內容

- `npm run build:linux`，產出 `dist/knowmon-1.0.0.AppImage`、`dist/knowmon_1.0.0_amd64.deb`、`dist/linux-unpacked/`。
- 用 `npx asar list dist/linux-unpacked/resources/app.asar` 確認：
  - 沒有 `docs`、`test-vault`、`scripts`、`src`。
  - `app.asar.unpacked/` 裡有 `node_modules/sqlite-vec-linux-x64/vec0.so` 與 better-sqlite3 的 `.node`。
- 記錄安裝檔大小。better-sqlite3 會帶進 8 個平台的 prebuild（約 17 MB），只記錄，不在這次優化。

### 5. 自動驗證打包後的 asar 結構

沿用記憶 `electron-headless-testing` 的做法：用 scratchpad 裡的 wrapper main.js，以 `node_modules/electron` 執行打包出的 `dist/linux-unpacked/resources/app.asar/out/main/index.js`。wrapper 要做三件事：

- 隱藏視窗。
- stub `dialog.showOpenDialog`，回傳家目錄下 test-vault 的副本（不能放 `/tmp`）。
- 開 `--remote-debugging-port`。

用 CDP 開 vault，然後確認：

- `window.api.llm.status()` 沒有 `sqlite-vec failed to load` 錯誤。
- Ollama 在跑時，embedding 跑完後 `sqlite3 <vault>/.knowmon/index.db "select count(*) from vec_chunks"` 大於 0。
- Hybrid 搜尋 `培養好習慣的方法` 回傳 `vector: true`，結果帶有 meaning 標籤。
- 圖片協定 `knowmon-asset://` 能讀到 `attachments/` 裡的圖片。
- userData 落在 `~/.config/knowmon`（wrapper 用獨立的 `--user-data-dir` 時，改成檢查 `app.getPath('appData')` 拼出的路徑邏輯）。

這一步只驗證 asar／unpacked 的結構與路徑轉換；真正的安裝流程由下一步手動測試。

### 6. 使用者手動測試（需要 sudo，由使用者執行）

1. `! sudo apt install ./dist/knowmon_1.0.0_amd64.deb`
2. 從應用程式選單開啟 Knowmon，確認不需要 `--no-sandbox` 就能啟動。
3. 開啟 vault 後，以下項目都要正常：
   - 側欄出現 AI ready。
   - Hybrid 搜尋有 meaning 結果。
   - 圖譜的 Semantic 邊、問答、Agent。
   - 圖片貼上與顯示。
   - 刪除筆記會進垃圾桶。
4. 確認上次的 vault 位置、主題與分頁都沿用開發版的設定（因為 userData 相同）。
5. `chmod +x dist/knowmon-1.0.0.AppImage && ./dist/knowmon-1.0.0.AppImage`：記錄是否被 sandbox 擋住，再試 `--no-sandbox`。
6. `sudo apt remove knowmon` 能乾淨移除。

### 7. 文件

- `docs/plans/phase8-packaging.md`：記錄發現、安裝檔大小、AppImage 的實際行為。
- `docs/architecture.md` 的「開發環境注意事項」：把「打包時要確認 sqlite-vec 沒被包進 asar」改寫成目前的做法（`asarUnpack` ＋ `unpackedPath`），並補上 userData 固定為 `knowmon`。
- 使用說明 `installation.md`（中英文）的「自行打包安裝檔」：更新為 deb 與 AppImage、拿掉 snap、拿掉「向量搜尋可能失效」的警告（Linux 已驗證；Windows 和 macOS 仍標示未驗證），並加上 AppImage 在 Ubuntu 24+ 需要 `--no-sandbox` 的說明（依第 6 步的結果）。README 的「建置安裝檔」同步更新。
- roadmap 的「產出安裝檔」**先不勾**，等最後的正式打包任務（三個平台、圖示、版本）完成再勾。

## 不在這次範圍

- 正式圖示、版本號、程式碼簽章、Windows 與 macOS 打包（需要各自的作業系統或 CI），留到最後的正式打包任務。
- 只帶目標平台的 better-sqlite3 prebuild（瘦身）。
- 設定頁、效能優化。

## 驗證

- `npx vitest run`、`npm run typecheck`、`npm run lint` 全部通過（含新的 `unpackedPath` 測試，以及原本的 `vectors.test.ts`）。
- `npm run dev` 仍正常啟動，並讀到 `~/.config/knowmon` 的設定。
- 第 4 步的 asar 內容檢查、第 5 步的自動驗證通過。
- 使用者完成第 6 步的手動測試清單。

## 結果（2026-10-20）

### 與計畫不同之處

- macOS 的 `NSDocumentsFolderUsageDescription`、`NSDownloadsFolderUsageDescription` **保留**並改寫說明：vault 常放在這兩個資料夾，macOS 存取時會要求權限說明。只刪除相機與麥克風。
- 第一次建置時 electron-builder 從 git remote 自動推得 GitHub，產生了 `app-update.yml` 與 `latest-linux.yml`，所以明確設定 `publish: null`。
- 建置時警告沒有 `desktopName`（Wayland 下視窗無法對應到 `.desktop`，Dock 顯示通用圖示），加上 `package.json` 的 `"desktopName": "knowmon.desktop"` 與 `linux.syncDesktopName: true`。

### 建置

`npm run build:linux`（electron-builder 26.15.3、Electron 39.8.10）：

| 檔案                           | 大小                    |
| ------------------------------ | ----------------------- |
| `dist/knowmon-1.0.0.AppImage`  | 131 MB                  |
| `dist/knowmon_1.0.0_amd64.deb` | 103 MB（安裝後 328 MB） |

- asar 內沒有 `docs`、`test-vault`、`scripts`、`src`。
- `app.asar.unpacked/` 有 `node_modules/sqlite-vec-linux-x64/vec0.so`。better-sqlite3 由 smartUnpack 整包解出，包含 8 個平台的 prebuild（17 MB）與 C 原始碼，之後可瘦身。
- deb 的 `postinst` 會設定 chrome-sandbox，並在 Ubuntu 24+ 安裝 AppArmor profile。
- renderer 的主要 bundle 約 3 MB（效能任務可再看）。

### 自動驗證（第 5 步）

以 `node_modules/electron` 執行 wrapper，載入 `dist/linux-unpacked/resources/app.asar/out/main/index.js`（`XDG_CONFIG_HOME` 指到 scratchpad，不碰真正的設定），用 CDP 開啟 test-vault 的副本：

| 檢查                                                    | 結果                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| userData                                                | `<XDG_CONFIG_HOME>/knowmon` ✓                                     |
| `llm.status()`                                          | online、沒有錯誤、9/9 篇完成 embedding ✓                          |
| Hybrid 檢索「培養好習慣的方法」                         | `vector: true`，前三名「原子習慣」「深度工作」「歡迎」帶 vector ✓ |
| 圖譜 Semantic 邊                                        | 9 條 ✓                                                            |
| `<img src="knowmon-asset://vault/attachments/pic.png">` | 載入 512×512 ✓                                                    |

（renderer 以 `fetch` 讀 `knowmon-asset:` 會被 CSP 擋下，這是預期行為：CSP 只在 `img-src` 開放這個協定。）

### AppImage 與 FUSE

使用者執行 AppImage 時出現 `dlopen(): error loading libfuse.so.2 … AppImages require FUSE to run`：electron-builder 預設的舊 AppImage runtime 需要 FUSE 2，而 Ubuntu 22.04 之後預設只有 FUSE 3（這台 Ubuntu 26.04 也是）。

- 改用 `toolsets.appimage: '1.0.3'`（static runtime 20251108，electron-builder 26 的 beta 選項），不需要 libfuse2。AppImage 變成 122 MB（zstd 壓縮）。
- 新 runtime 的 AppRun 以 `unshare -Ur true` 檢查 user namespace，失敗時自動加 `--no-sandbox`。這台 `unshare` 失敗（`apparmor_restrict_unprivileged_userns = 1`），所以 AppImage 在 Ubuntu 24+ 是以沒有 sandbox 的方式執行；舊 runtime 則是一律加 `--no-sandbox`。deb 不受影響（postinst 安裝 AppArmor profile），因此 Debian／Ubuntu 建議用 deb。
- 實測：`timeout 12 ./dist/knowmon-1.0.0.AppImage` 執行到逾時（exit 124），只有無害的 libva 警告。

### 手動測試（第 6 步，使用者 2026-10-20）

- deb：`sudo apt install` 後從應用程式選單開啟，不需要 `--no-sandbox`；AI、Hybrid 搜尋、Semantic 邊、問答、Agent、圖片、垃圾桶、沿用開發版設定都正常。
- AppImage（static runtime）：不需要 libfuse2，可以直接開啟。
- `sudo apt remove knowmon` 正常移除，但會停頓一下。postrm 只移除 `/usr/bin/knowmon` 連結並以 `apparmor_parser --remove` 卸載 profile，停頓推測主要來自刪除約 330 MB 的檔案與 apt 的觸發程序（桌面選單、圖示快取），屬於 Electron App 的正常現象，不處理。
