# 階段 8：CI 測試與三平台安裝檔發布

## Context

現在要用 Knowmon 得先裝 Node.js 和 Git、clone、`npm install`，Linux 還要用 sudo 設定 chrome-sandbox，對一般使用者門檻太高。目標是讓使用者從 GitHub Releases 下載安裝檔直接安裝。

卡關的原因：sqlite-vec 只會裝建置機器所在平台的版本，所以安裝檔必須在各自的作業系統上建置（`docs/architecture.md`「開發環境注意事項」）。之前只在 Ubuntu 26.04 驗證過 deb 與 AppImage（`docs/plans/phase8-packaging.md`），使用者現在用的 Fedora 44 沒有測過，也沒有 rpm。

這次分三步：

1. Fedora 驗證，並加上 rpm。
2. GitHub Actions：每次 push 在三個平台跑測試；推 tag 時打包四種安裝檔，上傳成草稿 Release。
3. Windows 與 macOS 先以「實驗性」發布，並寫好使用說明。

使用者決定（2026-11-15）：

- 授權用 **MIT**。
- 第一個版本是 **0.1.0**。
- repo **公開**。
- macOS 支援 **Apple Silicon 與 Intel**。
- 沿用之前的討論：發布時機由使用者控制，推 `v*` tag 才打包，結果是**草稿** Release，使用者檢查後手動按 Publish。沒有自動更新（`publish: null` 不變）。

## 步驟

### 0. 存檔

把這份計畫存成 `docs/plans/release-ci.md`，之後的發現與結果都記錄在這份文件。

### 1. 打包設定與 Fedora 驗證

`electron-builder.yml`：

- `linux.target` 加入 `rpm`。electron-builder 預設的 after-install 腳本 deb 和 rpm 共用，會設定 chrome-sandbox 的 SUID。
- `dmg.artifactName` 改為 `${name}-${version}-${arch}.${ext}`。不改的話，arm64 與 x64 兩個 dmg 會同名，在 Release 裡互相覆蓋。
- `mac.target` 明確設為 `dmg`，不另外產 zip。

`package.json`：`version` 改為 `0.1.0`。

新增 `LICENSE`（MIT，`Copyright (c) 2026 Richard Lai`），並在 `package.json` 加 `"license": "MIT"`。

Fedora 本機驗證（需要 sudo，由使用者執行）：

1. `! sudo dnf install rpm-build`（fpm 打包 rpm 需要 `rpmbuild`）。
2. 執行 `npx electron-vite build && npx electron-builder --linux AppImage rpm`。本機不打 deb，因為 Fedora 不一定有對應的打包工具，deb 交給 CI。
3. 先由我做自動驗證：沿用 phase8 第 5 步的 wrapper 和 CDP 做法，對 `dist/linux-unpacked/` 跑一次。`XDG_CONFIG_HOME` 指到 scratchpad，用 `~/knowmon-test-vault` 副本確認：
   - userData 位置正確
   - `llm.status()` 沒有 sqlite-vec 錯誤
   - Hybrid 搜尋帶 `vector: true`
   - Semantic 邊存在
   - 圖片協定能讀到圖片
4. 使用者手動測試：
   - `! sudo dnf install ./dist/knowmon-0.1.0.x86_64.rpm`，從選單開啟，確認不需要 `--no-sandbox`。
   - 照 phase8 第 6 步的清單測：AI ready、Hybrid、Semantic 邊、問答、Agent、圖片、刪除進垃圾桶、設定沿用。
   - AppImage：直接執行，記錄 sandbox 是否開啟。Fedora 沒有 AppArmor 限制，預期 `unshare` 成功、不會自動加 `--no-sandbox`。
   - `! sudo dnf remove knowmon` 能乾淨移除。
5. 如果 rpm 預設相依（例如 `libXScrnSaver`）在 Fedora 44 不存在、導致安裝失敗，就在 `rpm.depends` 覆寫，並記錄原因。

### 2. CI：三平台測試（`.github/workflows/ci.yml`）

- 觸發條件：push 到 `main`，以及 pull request。
- 權限：`permissions: contents: read`。設定 `concurrency`，同一分支的新 push 會取消舊的執行。
- job `check`（`ubuntu-latest`）：`npm ci` → `npm run typecheck` → `npm run lint`。這兩項與平台無關，只在 Linux 跑。
- job `test`，matrix 為 `ubuntu-latest`、`windows-latest`、`macos-latest`：`npm ci` → `npx vitest run`。`ollama.integration.test.ts` 已經用 `skipIf` 預設跳過。
- 共用設定：`actions/setup-node`，Node 24，`cache: npm`。actions 版本固定到 major 版號。

新增 `.gitattributes`，內容為 `* text=auto eol=lf`，二進位檔（png、ico、icns）另外標 `binary`。原因是 Windows runner 的 git 預設會把換行轉成 CRLF，Prettier（`endOfLine` 預設 `lf`）與讀取檔案內容的測試都會受影響；之後 Windows 上的貢獻者也一樣。

第一次在 Windows 和 macOS 跑測試時，可能會出現從沒見過的失敗，例如路徑分隔字元、大小寫不分的檔案系統、暫存目錄刪除時檔案被鎖住：

- **測試寫法的問題，或很小的 bug**：在這次一併修正，並補上測試。
- **需要改 `types.ts`、DB schema，或要改變 App 行為**（例如 Windows 不允許的檔名字元）：先記錄下來，問使用者要不要拆成另一個任務。

### 3. 發布：推 tag 時打包（`.github/workflows/release.yml`）

觸發條件：

- `push: tags: ['v*']`：正式發版。
- `workflow_dispatch`：手動試跑。只把安裝檔上傳成 workflow artifacts，**不建立 Release**，用來在發版前試打 Windows 和 macOS 版。

job `build`，matrix 共四個（`fail-fast: false`，一個平台失敗不影響其他平台）：

| runner           | 指令                                           | 產出               |
| ---------------- | ---------------------------------------------- | ------------------ |
| `ubuntu-22.04`   | 先 `sudo apt-get install -y rpm`，再 `--linux` | AppImage、deb、rpm |
| `windows-latest` | `--win`                                        | NSIS `-setup.exe`  |
| `macos-latest`   | `--mac`                                        | `-arm64.dmg`       |
| `macos-15-intel` | `--mac`                                        | `-x64.dmg`         |

- Linux 用較舊的 22.04 打包，產出的程式在舊發行版上比較不會因為 glibc 版本太新而跑不起來。
- 每個 job 的步驟：`npm ci` → `npx vitest run`（測試沒過就不打包）→ `npx electron-vite build` → `npx electron-builder <平台> --publish never`。
- 上傳 `dist/` 裡的安裝檔，用 `actions/upload-artifact`。
- 推 tag 時，先檢查 `${GITHUB_REF_NAME#v}` 是否等於 `package.json` 的 `version`，不一致就失敗，避免打出版本號錯誤的檔案。
- macOS 設定 `CSC_IDENTITY_AUTO_DISCOVERY=false`，不嘗試用 keychain 簽章。Apple Silicon 的 App 至少要有 ad-hoc 簽章才能執行，所以要用 log 裡的 `codesign -dv` 確認結果。沒有簽章的話，在 `mac` 設定 `identity: '-'`。

job `release`，只在推 tag 時執行，需要等四個 build 都完成：

- 權限：`permissions: contents: write`。
- 用 `actions/download-artifact` 收集所有安裝檔。
- 執行 `gh release create "$GITHUB_REF_NAME" --draft --generate-notes <檔案>`。用 runner 內建的 `gh` 和 `GITHUB_TOKEN`，不需要新增 secrets。

這次**不用** electron-builder 的 `--publish`，因為它需要 `publish` 設定，還會產生 `latest*.yml` 這類自動更新的描述檔，跟 `publish: null` 的決定衝突。

### 4. 文件

- 新增 `docs/releasing.md`，寫給維護者：
  - 發版流程：改版本號 → commit → `git tag vX.Y.Z && git push origin vX.Y.Z` → 檢查草稿 → Publish。
  - 用 `workflow_dispatch` 試打包的方法。
  - 失敗時怎麼處理：刪掉草稿與 tag，修正後重打。
- `installation.md`（中英文）：
  - 最前面新增「下載安裝檔」：從 Releases 下載，依平台挑選格式。
    - Linux：Debian／Ubuntu 用 deb，Fedora／RHEL／openSUSE 用 rpm，其他發行版用 AppImage。
    - Windows：SmartScreen 會警告，按「其他資訊 → 仍要執行」。標示為實驗性。
    - macOS：依晶片選 arm64 或 x64。沒有公證的 App 會顯示「已損毀」或被 Gatekeeper 擋下，用 `xattr -cr /Applications/Knowmon.app` 解除。標示為實驗性。
  - 「從原始碼執行」改成第二種方式，給開發者用。
  - 「自行打包安裝檔」加入 rpm。
  - 「更新到最新版」加上安裝檔的更新方式：下載新版覆蓋安裝。
  - 版本改成 0.1.0 後，文件中的 `knowmon_1.0.0_amd64.deb` 這類檔名一併更新。
- `README.md`：
  - 「快速開始」第一行改成「從 Releases 下載安裝檔」，原本的原始碼步驟留給開發者。
  - 「文件」表格加入 `docs/releasing.md`。
  - 加上 MIT 授權說明。
- `docs/architecture.md`「開發環境注意事項」：
  - Linux 改為 AppImage、deb、rpm 三種格式。
  - 安裝檔由 CI 在各平台建置。
  - dmg 檔名帶 arch。
  - `.gitattributes` 固定 LF。
- `docs/testing.md`：加上「發版前檢查」，包含 Fedora 和 Ubuntu 的手動測試清單（從 phase8 第 6 步整理），以及 CI 全部通過。
- `docs/roadmap.md`：
  - 在「產出安裝檔」底下記錄進度：CI、rpm、LICENSE、版本號已完成。
  - Windows 與 macOS 尚未在實機上驗證，所以這一項**先不勾**，等有人實測完再勾。
  - 「下一步」的「正式打包」改寫成剩下的工作：實機驗證、程式碼簽章與否。

### 5. 推上 GitHub 並試跑（需要使用者同意才 push）

1. 本機的 vitest、typecheck、lint 全部通過後 commit。由使用者決定何時 push 到 `main`，觸發 `ci.yml`。
2. 在 Actions 頁面手動觸發 `release.yml`（`workflow_dispatch`），確認四個平台都打包成功、檔名正確、macOS 有 ad-hoc 簽章，下載 artifacts 看檔案大小。
3. 都沒問題之後，由使用者推 `v0.1.0` tag，到 Releases 檢查草稿後 Publish。

## 不在這次範圍

- 程式碼簽章與公證：Apple Developer Program、Windows 憑證。
- 自動更新，或 App 內的新版提醒。之後要做的話會新增 IPC，要動到 `types.ts`。
- Windows 檔名非法字元（`: * ? " < > |`、`CON` 這類保留名稱）的處理，以及大小寫不分檔案系統上的改名：CI 測出問題的話，另開任務。
- Linux arm64、Flathub 或 apt repository。
- better-sqlite3 只保留目標平台的 prebuild（瘦身）。
- 首次使用引導（App 內下載模型、開啟範例 vault）。

## 已知風險

- 使用者之前在 Ubuntu 上裝過 1.0.0 的 deb，改成 0.1.0 後 apt 會視為降級。要先 `sudo apt remove knowmon` 再裝，寫進 release notes 和 `docs/releasing.md`。
- `macos-15-intel` runner 預計 2027 年 8 月停用，屆時 Intel 版要改成在 arm64 runner 上交叉建置，或停止支援。記錄在 `docs/releasing.md`。
- `toolsets.appimage` 仍是 electron-builder 的 beta 選項，CI 建置時確認還能用。

## 驗證

- 本機：`npx vitest run`、`npm run typecheck`、`npm run lint` 全部通過。
- Fedora：第 1 步的自動驗證，以及使用者手動測試 rpm 和 AppImage 都通過。
- GitHub：
  - `ci.yml` 在三個平台都是綠燈。
  - `release.yml` 的 `workflow_dispatch` 產出 AppImage、deb、rpm、`-setup.exe`、`-arm64.dmg`、`-x64.dmg` 共六個檔案。
  - 推 `v0.1.0` 後建立的是草稿 Release，而且附上這六個檔案。
  - 故意用不一致的 tag（例如在 fork 或測試分支上推 `v9.9.9`）時，版本檢查會讓工作流程失敗。

## 結果（2026-11-17）

### 與計畫不同之處

- macOS 簽章不等 CI log 再決定，直接設 `mac.identity: '-'`：查 electron-builder 26.15.3 原始碼（`MacTargetHelper.findSigningIdentity`），找不到憑證時只會略過簽章，不會自動 ad-hoc；只有 identity 明確是 `'-'` 才做 ad-hoc。同時設 `hardenedRuntime: false`：ad-hoc 簽章加 hardened runtime 時，library validation 會擋下沒有 Team ID 的 dylib（sqlite-vec 以 `dlopen` 載入），electron-builder 也會為此警告。hardened runtime 只有公證時才需要。CI 的「Show macOS code signature」步驟仍保留，用來確認 `Signature=adhoc`。
- `.gitattributes` 另把 `*.docx`、`*.pdf`、`*.jpg`、`*.gif`、`*.webp` 標成 `binary`（`Reports/` 有 docx）。`.editorconfig` 原本在 repo 裡是 CRLF，一併改成 LF。
- actions 版本：最後是 `checkout@v7`、`setup-node@v7`、`upload-artifact@v7`、`download-artifact@v8`（一開始寫的是舊一版的 major，第一次 Release 出現 `upload-artifact@v5` 使用 Node 20 的淘汰警告後升級；新版的變更是改用 ESM、新增選項，對這裡的用法沒有影響）。`merge-multiple: true` 把四個 artifact 合併到同一個資料夾。
- 安裝說明的 rpm 只列 Fedora／RHEL 系，openSUSE 改用 AppImage（使用者同意，2026-11-17）：electron-builder 的 rpm 相依套件用 Fedora 的名稱（例如 `libXScrnSaver`，openSUSE 叫 `libXss1`），在 openSUSE 上可能無法解析，而且沒有驗證過。
- `gh release create` 加上 `--repo "$GITHUB_REPOSITORY"`：release job 沒有 checkout，`gh` 無法從 git remote 推得 repo。

### Fedora 44 本機

- `npx vitest run`（55 個檔案、489 個測試通過，4 個跳過）、`npm run typecheck`、`npm run lint` 通過。
- rpm 預設相依（`gtk3`、`libnotify`、`nss`、`libXScrnSaver`、`libXtst`、`xdg-utils`、`at-spi2-core`、`libuuid`）在 Fedora 44 都有，而且這台都已安裝，不需要覆寫 `rpm.depends`。
- `npx electron-builder --linux AppImage` 成功：`dist/knowmon-0.1.0.AppImage` 122 MB。
- 自動驗證（`dist/linux-unpacked/` 的 asar，wrapper + CDP，`XDG_CONFIG_HOME` 指到 scratchpad，`~/knowmon-test-vault` 副本，embedModel `bge-m3`、chatModel 改成這台有的 `qwen3.5:2b`）：

| 檢查                                        | 結果                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| userData                                    | `<XDG_CONFIG_HOME>/knowmon` ✓                           |
| `llm.status()`                              | online、沒有 sqlite-vec 錯誤、9/9 篇完成 embedding ✓    |
| Hybrid 檢索「培養好習慣的方法」             | `vector: true`，前三名「原子習慣」「深度工作」「歡迎」✓ |
| 圖譜邊                                      | wikilink 15、semantic 9、sequence 4 ✓                   |
| `knowmon-asset://vault/attachments/pic.png` | 載入 1024×1024 ✓                                        |

- rpm 打包（2026-11-17）：
  - 只裝 `rpm-build` 時失敗：electron-builder 下載的 fpm 內附 Ruby，需要 `libcrypt.so.1`，Fedora 預設只有 `libcrypt.so.2`（exit 127）。裝 `libxcrypt-compat` 後成功，已寫進安裝說明的「自行打包安裝檔」。CI 在 Ubuntu 打包，不受影響。
  - `dist/knowmon-0.1.0.x86_64.rpm` 90 MB（安裝後 344 MB），License MIT，相依套件即上面的預設清單。
  - 內含 `app.asar.unpacked/node_modules/sqlite-vec-linux-x64/vec0.so`；`.desktop` 的 `Exec=/opt/Knowmon/knowmon %U`（絕對路徑）。
  - after-install 腳本：user namespace 可用時 chrome-sandbox 設為 `0755`（用 namespace sandbox），不可用時才設 SUID `4755`。計畫寫的「會設定 SUID」不精確，Fedora 上預期是前者。
  - 可能的問題（尚未驗證）：after-remove 腳本沒有判斷 rpm 的 `$1`，升級時舊版的 postun 在新版安裝後執行，可能把 `update-alternatives` 的 `/usr/bin/knowmon` 移除。選單用絕對路徑不受影響，只影響終端機的 `knowmon` 指令。之後第一次升級（0.1.0 → 下一版）時確認。
- 使用者手動測試（2026-11-17）：`sudo dnf install` 安裝 rpm 後照第 1 步第 4 點測試，回報通過。
  - Fedora 44 沒有 AppArmor，`unshare -Ur true` 成功，所以 AppImage 的 AppRun 不會加 `--no-sandbox`，以 sandbox 執行（符合預期）。
  - `sudo dnf remove knowmon`：`/usr/bin/knowmon`、`/etc/alternatives/knowmon`、`.desktop` 都移除，`~/.config/knowmon` 保留 ✓。但 `/opt/Knowmon` 留下一串**空資料夾**（0 個檔案）：fpm 打包 rpm 時只把檔案列進 `%files`、不擁有資料夾，所以 rpm 移除時不會刪資料夾。不影響使用與重新安裝；可以用 `rpm.fpm: ['--directories', '/opt/Knowmon']` 讓套件擁有整個資料夾，尚未決定要不要改。

### GitHub

- 第一次 push（`4db342c`，2026-11-17）：`ci.yml` 四個 job 全部通過，約 3 分鐘（check 1:23、Ubuntu 1:07、macOS 2:02、Windows 2:55）。Windows 與 macOS 第一次跑 vitest 就沒有失敗，不需要修測試。
- 第一次手動觸發 `release.yml`：`macos-latest` 在 `electron-vite build` 失敗，`"Markdown" is not exported by "src/renderer/chat/markdown.ts"`。`src/renderer/chat/` 同時有元件 `Markdown.tsx` 與解析器 `markdown.ts`，macOS 預設不分大小寫，`import './Markdown'` 解析到了 `markdown.ts`（Windows 也會）。CI 沒抓到，因為 vitest 只 import 解析器、不經過 vite 建置。使用者中止了這次執行。修正：
  - 解析器改名為 `parseMarkdown.ts`（測試一併改名）。
  - 新增 `scripts/case-collisions.test.mjs`：遞迴檢查 repo（略過 dot 開頭、`node_modules`、`out`、`dist`），同一資料夾裡去掉副檔名後只差大小寫的名稱就失敗，在 Linux 上也能抓到。
  - `ci.yml` 的三平台 test job 加上 `npx electron-vite build`（與計畫不同：原本只跑 vitest）。
- 同一次執行裡 `windows-latest` 與 `macos-15-intel` 在 vitest 失敗，都是效能測試的時間上限：Intel Mac 上 `vectors.test.ts` 4835ms（上限 1500）、`time.test.ts` 3063ms（500）、`graph.test.ts` 387ms（200）；Windows 上 `time.test.ts` 579ms（500）。CI 的 `windows-latest` 同一個測試剛好通過，共用機器的速度不穩定。修正：新增 `perfBudget`（`src/main/db/test-utils.ts`），本機照原本的設計目標，`CI` 環境變數有值時放寬 10 倍（Intel Mac 最多慢約 6 倍）；仍能抓到數量級的退化。`forceLayout.test.ts` 的 8 秒上限本來就寬，沒有改。
- 第三次 Release（`8c54dea`）：Windows、Ubuntu、macOS arm64 成功；`macos-15-intel` 的 `vectors.test.ts`、`time.test.ts` 撞上 vitest 預設的單一測試逾時 5 秒（包含準備 1000 篇資料的時間，不只是量測的部分）。`vitest.config.ts` 的 `testTimeout` 在 `CI` 有值時改成 60 秒。
- 第四次 Release（`19d0395`，workflow_dispatch）：四個平台全部成功，約 6 分 20 秒（Intel Mac 最慢）。artifacts：`knowmon-linux` 314 MB、`knowmon-windows` 106 MB、`knowmon-mac-arm64` 124 MB、`knowmon-mac-x64` 133 MB。待使用者確認：artifacts 內的檔名、兩個 macOS job 的 `Signature=adhoc`。
- 推 `v0.1.0` tag（2026-11-17）：版本檢查通過，四個 build 與 release job 全部成功（約 5 分鐘），建立了草稿 Release（未登入的 API 看不到草稿，由使用者在 Releases 頁面檢查後 Publish）。
