# Knowmon

類 Obsidian 的本地 Markdown 筆記軟體，多了兩個特色：

- **時間脈絡連結**：除了 `[[wikilink]]`，也會依「同一段時間寫的」「同一天的事」「同資料夾的前後篇」自動連結筆記。
- **本地 AI**：透過 [Ollama](https://ollama.com) 總結筆記、向筆記提問、交給 Agent 整理。內容不離開你的電腦；沒有 Ollama 時其他功能照常。

**使用說明**：[繁體中文](docs/user-guide/zh-TW/README.md) · [English](docs/user-guide/en/README.md)

## 快速開始

需要 Node.js 22 以上。AI 功能另需 Ollama 與 `ollama pull bge-m3`、`ollama pull qwen3:8b`。

```bash
npm install
npm run dev
```

**Linux 第一次執行前**要設定 Electron sandbox，否則 App 會閃退（重新安裝 `node_modules` 後要再做一次）：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

啟動後按「Open folder」選一個資料夾作為 vault，可以先用 `cp -r test-vault ~/knowmon-test-vault` 試用。其他安裝問題（`Electron failed to install correctly`、終端機警告訊息等）見[安裝說明](docs/user-guide/zh-TW/installation.md#安裝時的常見問題)。

## 常用指令

| 指令                  | 用途                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `npm run dev`         | 開發模式（renderer 熱更新）                                       |
| `npm start`           | 建置後執行正式版本（加 `-- --skipBuild` 直接執行上次建置的 out/） |
| `npx vitest run`      | 單元與整合測試                                                    |
| `npm run typecheck`   | 型別檢查（不要用 `npx tsc --noEmit`，它不會檢查任何檔案）         |
| `npm run lint`        | ESLint + Prettier                                                 |
| `npm run build:linux` | 產生 `dist/` 下的 AppImage 與 deb（Windows / macOS 需在各自平台） |

## 文件

| 想知道…                              | 看這裡                                          |
| ------------------------------------ | ----------------------------------------------- |
| 怎麼使用（功能、快捷鍵、資料存哪裡） | [`docs/user-guide/`](docs/user-guide/README.md) |
| 怎麼測試（自動測試、手動測試清單）   | [`docs/testing.md`](docs/testing.md)            |
| 專案目標、技術選型、進度與下一步     | [`docs/roadmap.md`](docs/roadmap.md)            |
| 已做出的設計決定與實作細節           | [`docs/architecture.md`](docs/architecture.md)  |
| 時間層的概念與規則                   | [`docs/time-layer.md`](docs/time-layer.md)      |
| 各階段的實作計畫與實測紀錄           | [`docs/plans/`](docs/plans/)                    |
