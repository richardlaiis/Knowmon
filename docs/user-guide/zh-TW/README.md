# Knowmon 使用說明

> [English version](../en/README.md)

Knowmon 是一個本地優先的 Markdown 筆記軟體。你的筆記就是電腦裡的一般 `.md` 檔案，Knowmon 幫你在它們之間建立連結、搜尋、畫出關係圖，並且多了兩個特色：

- **時間脈絡**：除了你手寫的 `[[連結]]`，Knowmon 也會依「同一段時間寫的」「講的是同一天的事」「同一個資料夾裡的前後篇」自動把筆記連起來。
- **本地 AI**：透過 [Ollama](https://ollama.com) 在你自己的電腦上執行語言模型，可以總結筆記、問你的筆記問題、或交給 Agent 幫你整理。筆記內容不會離開你的電腦。

## 從這裡開始

| 如果你想…                  | 請看                      |
| -------------------------- | ------------------------- |
| 在電腦上安裝並啟動 Knowmon | [安裝](installation.md)   |
| 五分鐘內開始寫第一篇筆記   | [快速開始](quickstart.md) |
| 認識畫面上每個區域         | [介面導覽](interface.md)  |

## 基本功能

- [筆記與編輯](notes-and-editing.md)：建立、整理筆記，Markdown 語法、即時渲染、圖片
- [連結與反向連結](links.md)：`[[wikilink]]` 的寫法與規則、Backlinks 面板
- [屬性（Frontmatter）](properties.md)：`date`、`tags` 等屬性，以及 Knowmon 怎麼使用它們
- [搜尋與快速切換](search.md)：全文搜尋、Hybrid 語意搜尋、Quick switcher

## 看見筆記之間的關係

- [圖譜](graph.md)：全域圖、局部圖、篩選
- [時間脈絡](time.md)：兩種時間、時間邊、時間軸視圖、相關設定

## AI 功能（可選）

- [設定本地 AI](ai-setup.md)：安裝 Ollama、下載模型、狀態說明
- [總結與問答](summary-and-chat.md)：總結一篇筆記、向筆記提問
- [Agent](agent.md)：交給 AI 多步驟的任務，例如整理、建立筆記、加標籤

## 參考

- [快捷鍵](shortcuts.md)
- [檔案與資料](files-and-data.md)：資料存在哪裡、備份、搭配其他工具
- [常見問題](faq.md)

## 幾個核心原則

1. **筆記就是 Markdown 檔。** 不需要匯出，換別的編輯器（甚至 Obsidian）也能直接打開。
2. **資料夾就是 vault。** 你選擇的那個資料夾就是一個 vault（筆記庫）；Knowmon 在裡面建立一個隱藏的 `.knowmon` 資料夾存放索引與編輯歷程。
3. **AI 是可選的。** 沒有 Ollama 時，除了 AI 分頁以外的功能都照常運作。
