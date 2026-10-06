# Knowmon
類 Obsidian 筆記軟體，特色：時間脈絡連結 + 本地 LLM agent。

## 指令
- 開發：npm run dev
- 測試：npx vitest run
- 型別檢查：npm run typecheck
- 安裝、執行、手動測試步驟與常見訊息見 README.md

## 架構規則
- Markdown 檔是唯一真相，SQLite 只是索引，必須可重建
- 型別與 IPC 介面定義在 src/shared/types.ts，修改前先問我
- 檔案系統與 DB 只能在 main process 存取
- 架構細節見 @docs/architecture.md

## 慣例
- 新功能必須附 vitest 測試，完成前自己跑測試確認通過
- 用 test-vault/ 做手動驗證
