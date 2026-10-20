# 設定本地 AI

Knowmon 的 AI 功能全部在**你自己的電腦上**執行，透過 [Ollama](https://ollama.com) 呼叫開源模型。筆記內容不會傳到任何雲端服務。

AI 功能是可選的。沒有安裝 Ollama 時，編輯、連結、搜尋（Keyword）、圖譜、時間軸都照常運作。

## 需要 AI 的功能

| 功能                        | 用到的模型                               |
| --------------------------- | ---------------------------------------- |
| Hybrid 搜尋（用意思找筆記） | Embedding 模型                           |
| 圖譜的 Semantic 邊          | Embedding 模型                           |
| 總結（Summary）             | Chat 模型                                |
| 問答（Chat）                | Embedding ＋ Chat 模型                   |
| Agent                       | Embedding ＋ Chat 模型（需支援工具呼叫） |

## 安裝步驟

### 1. 安裝 Ollama

到 [ollama.com](https://ollama.com) 下載並安裝。Linux 也可以用：

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

安裝後 Ollama 通常會自動在背景執行。若沒有，執行 `ollama serve`。

### 2. 下載模型

```bash
ollama pull bge-m3      # Embedding 模型，約 1.2 GB
ollama pull qwen3:8b    # Chat 模型，約 5 GB
```

這是 Knowmon 的預設組合：`bge-m3` 中英文都表現良好，`qwen3:8b` 支援工具呼叫，可以執行 Agent 任務。

### 3. 打開 Knowmon

開啟 vault 後，左側欄底部會顯示：

1. **Indexing 3/40**：正在背景為每篇筆記建立語意索引。這段期間可以照常使用。
2. **AI ready**：完成，所有 AI 功能都可以使用了。

第一次索引的時間取決於筆記數量與電腦效能，之後只會處理新增或修改過的筆記。

## AI 分頁

右側面板的 **AI** 分頁（或點左側欄底部的狀態）最上方是狀態區：

```
● AI ready                         [Retry] [Settings]
qwen3:8b · bge-m3 · 40/40 notes indexed
[ Chat | Agent | Summary ]
```

- **Retry**：立即重新檢查 Ollama 連線。
- **Settings**：開啟 AI 設定。
- 下方的 **Chat / Agent / Summary** 切換三種功能，見 [總結與問答](summary-and-chat.md) 與 [Agent](agent.md)。

## AI 設定

| 設定            | 預設                     | 說明                                                 |
| --------------- | ------------------------ | ---------------------------------------------------- |
| Ollama address  | `http://127.0.0.1:11434` | Ollama 伺服器位址。可以指向區網中另一台有 GPU 的電腦 |
| Chat model      | `qwen3:8b`               | 用於總結、問答與 Agent                               |
| Embedding model | `bge-m3`                 | 用於 Hybrid 搜尋與 Semantic 邊                       |

- 模型選單會列出 Ollama 中**已下載**的模型。Ollama 離線時無法列出。
- 這些設定**所有 vault 共用**，存在 App 的設定檔中。
- **更換 Embedding 模型會重新索引所有筆記**（不同模型的向量無法互相比較）。

### 選擇模型的建議

- **Chat 模型**要執行 Agent 就必須支援**工具呼叫（tool calling）**。不支援時 Agent 會顯示「does not support tool calling」，總結與問答仍可使用。
- 模型越大品質越好，但也越慢。只用 CPU 時，`qwen3:8b` 總結一篇筆記約 15–30 秒、一個 Agent 任務約 1–4 分鐘；有 GPU 會快很多。
- 電腦資源有限時，可以試試較小的模型（例如 `qwen3:4b`），代價是回答品質。

## 狀態與疑難排解

| 左側欄顯示          | 意思             | 怎麼辦                                               |
| ------------------- | ---------------- | ---------------------------------------------------- |
| AI: checking…       | 正在連線         | 稍等                                                 |
| AI offline          | 連不上 Ollama    | 確認 Ollama 正在執行（`ollama serve`），位址設定正確 |
| Indexing 12/40      | 正在建立索引     | 稍等；此時 Hybrid 搜尋可能只有部分結果               |
| AI: needs attention | 例如模型尚未下載 | 打開 AI 分頁看原因，通常是執行 `ollama pull <模型>`  |
| AI ready            | 一切正常         | —                                                    |

- Ollama 離線時，Knowmon **每 30 秒自動重試**，Ollama 恢復後會自動連上，也可以按 **Retry**。
- Ollama 離線時：Hybrid 搜尋退回關鍵字結果；Chat 與 Agent 的輸入框顯示「Ollama is offline」；其他功能完全不受影響。
