# 發布新版本

給維護者：用 GitHub Actions 打包四個平台的安裝檔並建立 Release。計畫與決定的由來見 [`plans/release-ci.md`](plans/release-ci.md)。

## 工作流程

| 檔案                            | 觸發                      | 做什麼                                                                 |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | push 到 `main`、PR        | Linux 跑 typecheck 與 lint；Linux、Windows、macOS 各跑一次 vitest      |
| `.github/workflows/release.yml` | 推 `v*` tag               | 四個平台各自測試並打包，全部成功後建立**草稿** Release，附上六個安裝檔 |
| `.github/workflows/release.yml` | 手動（workflow_dispatch） | 只打包，安裝檔上傳成 workflow artifacts，不建立 Release                |

打包的平台：

| Runner           | 產出                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `ubuntu-22.04`   | `knowmon-X.Y.Z.AppImage`、`knowmon_X.Y.Z_amd64.deb`、`knowmon-X.Y.Z.x86_64.rpm` |
| `windows-latest` | `knowmon-X.Y.Z-setup.exe`                                                       |
| `macos-latest`   | `knowmon-X.Y.Z-arm64.dmg`                                                       |
| `macos-15-intel` | `knowmon-X.Y.Z-x64.dmg`                                                         |

安裝檔必須在各自的作業系統上建置：sqlite-vec 只會安裝建置機器所在平台的版本。沒有自動更新（`publish: null`），也沒有程式碼簽章：macOS 是 ad-hoc 簽章，Windows 沒有簽章。

## 發版步驟

1. 確認 main 上的 CI 全部通過，並照 [`testing.md`](testing.md#發版前檢查) 的「發版前檢查」試打包與手動測試。
2. 改 `package.json` 的 `version`（例如 `0.2.0`），執行 `npm install --package-lock-only` 同步 `package-lock.json`，commit 並 push。
3. 推 tag，版本號要和 `package.json` 一致（前面加 `v`）：

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   tag 與 `package.json` 的版本不一致時，`release.yml` 會在打包前失敗。

4. 等 Actions 的 `Release` 跑完，到 GitHub 的 Releases 頁面打開草稿：
   - 確認六個檔案都在、大小合理（每個約 100–130 MB）。
   - 編輯自動產生的 release notes，需要時補上升級注意事項。
   - 按 **Publish release**。

## 發版前試打包

到 GitHub 的 **Actions → Release → Run workflow**，選要打包的分支。完成後在該次執行的頁面下方 **Artifacts** 下載 `knowmon-linux`、`knowmon-windows`、`knowmon-mac-arm64`、`knowmon-mac-x64`。不會建立 Release，也不檢查版本號。

macOS 的兩個 job 有「Show macOS code signature」步驟，應顯示 `Signature=adhoc`；如果顯示 `code object is not signed at all`，Apple Silicon 上會無法執行，要先修好再發版。

## 失敗時

某個平台打包失敗時（`fail-fast: false`，其他平台會繼續跑，但不會建立 Release）：

1. 修正問題，commit 並 push 到 main。
2. 刪掉舊的 tag，在修正後的 commit 上重打：

   ```bash
   git push --delete origin v0.2.0
   git tag -d v0.2.0
   git tag v0.2.0
   git push origin v0.2.0
   ```

如果草稿 Release 已經建立但內容有問題：在 Releases 頁面刪掉草稿，再照上面的方式刪 tag、重打。草稿沒有 Publish 前，一般使用者看不到。

## 注意事項

- **從 1.0.0 降版**：第一次發布前，自行打包的安裝檔版本是 1.0.0。裝過的人 apt／dnf 會把 0.1.0 視為降級，要先 `sudo apt remove knowmon`（或 `sudo dnf remove knowmon`）再安裝。0.1.0 的 release notes 要寫上這點。
- **Intel Mac runner**：`macos-15-intel` 預計 2027 年 8 月停用。屆時改成在 arm64 runner 上交叉建置 x64（`--mac --x64`；sqlite-vec 要另外安裝 `sqlite-vec-darwin-x64`），或停止支援 Intel Mac。
- **AppImage static runtime**：`toolsets.appimage: '1.0.3'` 仍是 electron-builder 的 beta 選項，升級 electron-builder 後確認 AppImage 還能建置與執行。
- **actions 版本**：workflow 裡的 actions 固定到 major 版號，GitHub 停用舊版 Node runtime 時要一起升級。
