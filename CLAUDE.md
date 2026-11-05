# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Knowmon
類 Obsidian 筆記軟體（Electron + React + CodeMirror 6 + SQLite），特色：時間脈絡連結 + 本地 LLM agent（Ollama，可選）。

## 指令
- 開發：npm run dev
- 測試：npx vitest run
- 真的 Ollama 整合測試（預設跳過）：`OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts`
- 型別檢查：npm run typecheck（不要用 `npx tsc --noEmit`，它不會檢查任何檔案）
- 完成前 vitest、typecheck、`npm run lint` 都要通過
- 安裝與執行見 README.md，手動測試清單見 docs/testing.md

## 架構規則
- Markdown 檔與 `.knowmon/events.jsonl` 是唯一真相，SQLite 只是索引，必須可重建；schema 版本不符時直接刪 DB 重建，不寫 migration
- 修改合約前先問我：`src/shared/types.ts`（型別與 IPC 介面）、資料庫 schema、新增相依套件
- 檔案系統與 DB 只能在 main process 存取，所有操作經過 `Vault`（`src/main/vault/index.ts`）的佇列依序執行
- dot 開頭的檔案/資料夾（`.knowmon`、`.obsidian`、`.git`）不屬於 vault：不顯示、不監聽，IPC 拒絕存取
- Renderer 不插入 HTML（搜尋摘要、總結、回答都轉成 React 元素）
- 新增 IPC：`shared/channels.ts` → `main/ipc.ts` → `preload/index.ts`（+ `index.d.ts`）→ renderer
- 設計決定與實作細節在 `docs/architecture.md`（不會自動載入）：動到某個模組前先讀對應章節（同步、索引、圖譜、時間層、LLM、問答、Agent、工作區、圖片、Renderer、開發環境）。標註「使用者決定」的項目不要自行推翻

## 協作流程
- 每個任務先在 plan mode 寫計畫並存到 `docs/plans/`，經我同意後才實作
- 完成後在 `docs/roadmap.md` 勾選進度；新的設計決定記錄到 `docs/architecture.md`
- 新增或修改快捷鍵時，同步更新 `docs/user-guide/*/shortcuts.md`（中英文）
- 與 `docs/roadmap.md`「核心設計原則」衝突時，停下來詢問

## 慣例
- 新功能必須附 vitest 測試，完成前自己跑測試確認通過
- 用 test-vault/ 做手動驗證：先 `cp -r test-vault ~/knowmon-test-vault`，不要放 `/tmp`（不支援系統垃圾桶，刪除會失敗），也不要直接改 repo 裡的 test-vault/
- 大型 vault 效能測試：`node scripts/gen-vault.mjs ~/knowmon-1000 1000`（輸出放在 repo 以外）
