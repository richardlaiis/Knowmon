# 檔案與資料

Knowmon 的設計原則是：**你的筆記永遠是你的 Markdown 檔案**。這一頁說明 Knowmon 把什麼存在哪裡、哪些可以刪、哪些要備份。

## vault 的結構

```
我的筆記/                  ← vault（你選的資料夾）
├── 歡迎.md
├── 日記/
│   ├── 2026-10-05.md
│   └── 2026-10-06.md
├── 讀書筆記/
│   └── 原子習慣.md
├── attachments/           ← 貼上或拖進來的圖片
│   └── Pasted image 20261020143015.png
└── .knowmon/              ← Knowmon 的資料（隱藏）
    ├── events.jsonl       ← 編輯歷程
    ├── index.db           ← 索引資料庫
    └── settings.json      ← 這個 vault 的設定
```

## 每個檔案是什麼

| 資料       | 位置                                     | 可以刪嗎？                 |
| ---------- | ---------------------------------------- | -------------------------- |
| 筆記       | vault 中的 `.md` 檔                      | 這是你的資料本身           |
| 圖片       | 通常在 `attachments/`                    | 這是你的資料本身           |
| 編輯歷程   | `.knowmon/events.jsonl`                  | **不可以**，刪了就無法找回 |
| 索引資料庫 | `.knowmon/index.db`                      | 可以，下次開啟時自動重建   |
| vault 設定 | `.knowmon/settings.json`                 | 可以，會恢復預設值         |
| App 設定   | Linux：`~/.config/knowmon/settings.json` | 可以，會恢復預設值         |

### 編輯歷程（events.jsonl）

這個檔案記錄了你何時建立、編輯、開啟了哪些筆記，是 [時間脈絡](time.md) 的基礎（Session 邊、時間軸的 Written 模式、圖譜的寫作時間篩選）。

它**只能在事情發生的當下記錄**，事後無法從筆記檔案推算回來，所以請把它當成和筆記一樣重要的資料。它只會往後追加，不會改寫前面的內容。

### 索引資料庫（index.db）

包含連結、全文索引、語意向量等，全部可以從筆記檔案與編輯歷程重新產生。如果遇到奇怪的問題（例如搜尋結果怪怪的），可以：

1. 關閉 Knowmon。
2. 刪除 `.knowmon/index.db`（以及同名的 `index.db-wal`、`index.db-shm`，如果有的話）。
3. 重新開啟 vault。

Knowmon 會自動重建索引；語意向量會在背景重新計算（需要 Ollama）。

### 設定存在哪

| 設定                                         | 存放位置                 | 範圍                 |
| -------------------------------------------- | ------------------------ | -------------------- |
| 時間參數、Semantic 邊參數                    | `.knowmon/settings.json` | 跟著這個 vault       |
| Ollama 位址、模型、上次開啟的 vault          | App 設定檔               | 這台電腦的所有 vault |
| 主題、面板寬度、圖譜選項、搜尋模式等介面偏好 | App 內部儲存             | 這台電腦             |
| 開著的分頁                                   | App 內部儲存             | 每個 vault 各自一份  |

## 備份與同步

- **備份**：備份整個 vault 資料夾即可，**包含 `.knowmon/events.jsonl`**。`index.db` 可以不備份。
- **git**：建議把 `.knowmon/index.db*` 加進 `.gitignore`，其他都可以提交。
- **雲端同步**（Dropbox、Syncthing 等）：可以，但請避免在兩台電腦上**同時**開啟同一個 vault，否則 `events.jsonl` 可能產生衝突。

```gitignore
.knowmon/index.db*
```

## 搭配其他工具

- **其他編輯器**：可以隨時用 VS Code、Vim、Typora 等編輯筆記。Knowmon 開著時會即時偵測變更；沒開時，下次開啟會補上變更。
- **Obsidian**：Knowmon 與 Obsidian 使用相同的 `[[wikilink]]` 與 frontmatter 格式，同一個資料夾可以兩邊都用。Knowmon 會忽略 `.obsidian` 資料夾。注意 Knowmon 不支援 `![[嵌入]]` 語法顯示圖片。
- **檔案總管**：新增、刪除、搬移筆記都可以直接在檔案總管做，Knowmon 會自動更新。在外部搬移或改名時，只要內容沒變，Knowmon 會認出是同一篇筆記，保留它的編輯歷程。

## 哪些檔案會被忽略

- 名稱以 `.` 開頭的檔案與資料夾（`.knowmon`、`.obsidian`、`.git`、`.trash` 等）不會顯示，也不會被索引。
- 檔案樹只顯示 `.md` 檔。

## 刪除與垃圾桶

在 Knowmon 中刪除筆記會移到**系統垃圾桶**，可以從那裡還原。如果 vault 所在的位置不支援垃圾桶（例如 Linux 的 `/tmp`），刪除會失敗並顯示「Failed to move item to trash」——Knowmon 不會改成永久刪除。
