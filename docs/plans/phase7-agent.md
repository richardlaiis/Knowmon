# 階段 7 實作計畫：Agent

完成標準：能執行多步驟檢索與整理，所有寫入動作都需確認。

- [x] 唯讀工具：`search_notes`、`get_note`、`get_neighbors`、`list_notes_in_range`
- [x] 多步驟執行與過程顯示
- [x] 寫入工具（建立摘要筆記、加標籤），附使用者確認流程

## 已確認的決定（2026-10-18）

- 同意 `types.ts` 合約變更（下方「IPC 合約變更」）。
- Agent 是 AI 分頁的新模式（Chat / Agent / Summary），Chat 保留。
- 標籤寫在 frontmatter 的 `tags:`。
- 確認卡片可修改提案後再 Apply。

## 實作結果與偏離計畫之處（2026-10-18）

- `Vault` 新增三個方法（不是 IPC 合約）：`create(path, content)`（帶內容建立，`wx` 不覆蓋）、`peek(path)`（讀檔但不記 `open`，agent 讀筆記不是使用者打開的）、`update(path, f)`（在佇列中讀－改－寫，並推送 `change`）。
- `get_note` 每次回傳 2500 字（計畫是 3000），加上標頭後仍在 `TOOL_RESULT_MAX` 內。
- `createLinkFilter` 多了一條規則（總結與問答也適用）：`[[標題 | 資料夾/標題.md]]` 這類顯示文字是路徑、或與目標相同的連結，改成 `[[標題]]`。
- 確認卡片在寫入失敗時（例如等待期間有人建立了同名筆記）保留提案內容並顯示錯誤。
- 側欄底部的狀態在等待確認時顯示「Agent: confirm a change」，點擊直接打開 Agent。

### 實測（qwen3:8b、bge-m3、test-vault，`OLLAMA_IT=1`）

這台機器目前 Ollama 是 **100% CPU**（`ollama ps`），生成約 4 token/s，所以每個任務要 1–4 分鐘；有 GPU 時應快很多。另外 `num_ctx` 改變時 Ollama 會重新載入模型（約 15 秒），所以在 Chat（預設 context）與 Agent（16384）之間切換時第一次呼叫會多等一次載入；步驟之間不會重載。16384 仍然需要：工具定義加上幾次結果就超過預設的 4096，超出時 Ollama 會截掉開頭的系統提示詞。

第一次實測發現三個問題，修正後重測：

| 問題                                                    | 原因                                                             | 修正                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 使用者 Reject 後，模型回答「已建立「整理/比較.md」」    | 工具結果只寫「使用者拒絕了」                                     | 結果改成 `REJECTED: … it was NOT made …`，提示詞也說明 REJECTED 的意思；重測回答「創建筆記的動作被拒絕，因此沒有完成」 |
| 回答裡的連結寫成 `[[深度工作 \| 讀書筆記/深度工作.md]]` | 工具輸出「標題 \| 路徑 \| 日期」，模型照抄成 wikilink 的別名語法 | 輸出改成「標題 (path: …, date: …)」；提示詞要求括號裡只寫標題；連結過濾把路徑別名去掉                                  |
| 使用者沒提時間，模型卻加了 `period: "最近 7 天"`        | —                                                                | 參數說明與提示詞改為「只有使用者提到時間時才用」                                                                       |

修正後的結果（三個任務都通過）：

1. 「2026-10-04 到 2026-10-06 之間寫了哪些筆記？它們各自連到哪些筆記？」（246 秒）：`list_notes_in_range` → 三篇各一次 `get_neighbors`，回答的連結都存在。小模型會把時間邊、semantic 邊也說成「從…連接到這篇」，類型的區分不夠精確。
2. 「把「原子習慣」和「深度工作」整理成一篇比較筆記，存在「整理」資料夾」：`search_notes` → 兩次 `get_note` → `create_note` 提案。Reject 時沒有寫入、回答說明沒有完成（168 秒）；Apply 時建立 `整理/比較.md`，內容與提案一致（163 秒）。
3. 「幫 2026-10-04 這篇日記加上「回顧」標籤」（74 秒）：第一次用了不存在的路徑「2026-10-04 日記」→ 錯誤回給模型 → 自己用 `search_notes` 找到正確路徑 → `add_tags` → Apply 後 frontmatter 正確。

## 環境實測（2026-10-18）

- Ollama 0.35.1 的 `qwen3:8b` capabilities 含 `tools`。`/api/chat` 帶 `tools`、`think: false`、`stream: true` 時，工具呼叫在串流的 `message.tool_calls` 中一次給出（`arguments` 已是物件）。
- 實測「找出上週關於深度工作的筆記，然後看它連到哪些筆記」：模型正確呼叫 `search_notes({ query: "深度工作", from: "2026-10-11" })`，但只給了 `from`、沒有 `to`，日期也算錯一天（上週一是 10-12）。**日期不交給模型計算**：工具接受自然語言的時間片語，由 `parseTimeRange` 解析（見第 2 節）。

## 原則對照

- **Agent 預設唯讀**：四個唯讀工具直接執行；寫入工具只產生「提案」，在 renderer 顯示預覽，使用者按「Apply」後才由 main 寫入。拒絕、取消、逾時都不寫。
- **Markdown 是唯一真相**：寫入一律走 `Vault.write`（記 `edit` 事件、更新索引），跟使用者在編輯器裡存檔相同；對話與執行過程只在記憶體。
- **檔案系統與 DB 只在 main**：工具在 main 執行，renderer 只送任務、收事件、回覆確認。
- **Ollama 是可選的**：離線時 Agent 分頁停用送出，其他功能照常。

## 1. 架構

```
renderer                              main (src/main/llm/agent/)
  llm.agent({ task, history }) ──────▶ runAgent()：迴圈
                                         chat(messages, tools) ── Ollama
                                         ├ 有 tool_calls → 執行唯讀工具 → 結果加入 messages
                                         │                └ 寫入工具 → 產生提案，等待確認
  onAgent(chunk) ◀──── step / confirm / delta / done
  llm.confirm(id, step, approved, edited?) ─▶ 套用或拒絕，結果回給模型，繼續迴圈
```

- `src/main/llm/agent/loop.ts`：`runAgent(chat, tools, messages, emit, confirm, signal)`，純邏輯，chat、工具、確認都可注入，方便測試。
- `src/main/llm/agent/tools.ts`：工具定義（JSON schema、說明）與實作，輸入是 `Vault`，回傳給模型的文字＋給 UI 的摘要。
- `src/main/llm/agent/tags.ts`：`addTags(content, tags)` 純函式（第 4 節）。
- `ollama.ts`：`chat` 加上 `tools` 選項，回傳 `{ content, toolCalls }`；`ChatMessage` 加上 `tool` 角色與 `tool_calls`（client 內部型別，不在 `types.ts`）。模型不支援工具時（Ollama 回 `does not support tools`）回報清楚的錯誤：「目前的對話模型不支援工具呼叫，請在 Settings 換成 qwen3 等模型」。
- `LlmService.agent(req)` / `confirm(...)`，request id 與取消沿用 `requests` / `cancel`。

### 迴圈規則

- 每一步：送出 messages＋工具清單 → 模型回覆文字（串流給 UI）或工具呼叫 → 執行 → 結果以 `role: 'tool'` 加回 → 下一步。
- 最多 `AGENT_MAX_STEPS = 8` 次工具呼叫；達到上限時最後一次呼叫不帶 `tools`，要求模型根據目前的結果作答。
- 一次回覆有多個工具呼叫時依序執行（寫入工具一次只處理一個確認）。
- 同一工具＋相同參數重複呼叫時直接回傳「已經查過，結果同上」，避免小模型原地打轉。
- 參數不合法、筆記不存在時，錯誤訊息當作工具結果回給模型（讓它修正），不中止整個任務。
- Context：每個工具結果截到 `TOOL_RESULT_MAX = 3000` 字；所有工具結果加起來超過 `AGENT_CONTEXT_MAX = 16000` 字時，較早的結果換成一行摘要。agent 的請求帶 `options.num_ctx = 16384`（qwen3:8b 支援 40K；預設值太小，多步驟後會被截斷）。
- 系統提示詞：今天的日期與星期、工具使用原則（先搜尋再讀全文、引用筆記時用 `[[標題]]`、寫入前先確定內容）、語言依任務（沿用 `detectLanguage`）。不寫 `[[...]]` 範例（同總結的經驗）。
- 最終回答經 `createLinkFilter` 過濾：只保留工具結果中出現過的筆記標題與連結。

## 2. 工具

回傳給模型的是精簡的純文字（不是 JSON，小模型讀起來比較穩定），每篇筆記一行「標題 | 路徑 | 日期」開頭。路徑參數同時接受路徑或標題（用 `src/shared/links.ts` 的解析規則，和 wikilink 一樣）。

| 工具                  | 參數                                                                                 | 實作                                                                                           | 回傳                                                                           |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `search_notes`        | `query`、`period?`（時間片語，例如「上週」「2026-09」）、`limit?`（預設 8，最多 20） | `retrieve`（關鍵字 OR＋向量＋圖譜鄰居），`period` 經 `parseTimeRange`                          | 每篇：標題、路徑、日期、最相關的段落（約 200 字）                              |
| `get_note`            | `path`                                                                               | `getNoteBody` ＋ frontmatter 的 `tags`                                                         | 標題、路徑、日期、標籤、內文（超過 3000 字時截斷並註明，可帶 `offset` 讀後面） |
| `get_neighbors`       | `path`、`types?`（預設全部）                                                         | `Vault.graph()`（確保時間／semantic 邊是最新的）後取該篇的邊；外連的 wikilink 含尚未建立的目標 | 依類型分組：連出、反向連結、同一 session、同日、前後篇、語意相近（附權重）     |
| `list_notes_in_range` | `period` 或 `from`＋`to`                                                             | 沿用 `ask.ts` 的 `notesInRange`，上限 30 篇                                                    | 新 → 舊，每篇標題、路徑、日期、開頭一行                                        |
| `create_note` ✎       | `path`、`content`                                                                    | 提案 → 確認 → `Vault.write`                                                                    | 「已建立 / 使用者拒絕」                                                        |
| `add_tags` ✎          | `path`、`tags[]`                                                                     | 提案 → 確認 → `addTags` → `Vault.write`                                                        | 「已加上 / 已經有了 / 使用者拒絕」                                             |

- `period` 解析不出來時回傳錯誤並說明可用的寫法，讓模型改用 `from`／`to`。
- ✎ = 寫入工具。

## 3. 確認流程

1. 模型呼叫寫入工具 → main 檢查參數並產生提案：
   - `create_note`：路徑正規化（補 `.md`、拒絕 `.` 開頭的資料夾與 `..`）；**已存在就不覆蓋**，回錯誤讓模型換名稱。內容中指向不存在筆記的 `[[x]]` 在預覽中標示出來（不自動改）。
   - `add_tags`：讀目前的檔案、計算加上標籤後的內容；全部已經存在時直接回「已經有了」，不詢問。
2. main 推送 `confirm` 事件（提案內容），迴圈暫停等待。UI 在該步驟顯示確認卡片：
   - `create_note`：路徑（可修改）與內容（可編輯的文字框，Markdown 原文）。
   - `add_tags`：筆記標題、要加的標籤（可刪掉個別標籤）、frontmatter 的前後對照。
   - 按鈕：**Apply**／**Reject**。
3. 使用者回覆 → `llm.confirm(id, step, approved, edited?)`：
   - Apply：main 依（可能被修改過的）提案寫入。`add_tags` 在寫入當下重新讀檔再套用 `addTags`，不使用提案時的舊內容，所以使用者在等待期間編輯過筆記也不會被蓋掉。寫入後推送 `vault:changed`，開著該筆記的分頁沿用既有的外部修改處理（沒有未儲存內容就重新載入，有的話顯示提示列）。
   - Reject：工具結果回「使用者拒絕了這個動作」，模型繼續（通常會直接結束或改提案）。
   - 停止任務、換 vault、關閉 App：等待中的提案視為拒絕，什麼都不寫。
4. 確認卡片在完成後保留結果（已套用：可點擊開啟筆記；已拒絕：灰色）。

## 4. 標籤格式（`addTags`，純函式）

標籤寫在 frontmatter 的 `tags:`（test-vault 的寫法）：

- 沒有 frontmatter：在檔案開頭加上 `---\ntags: [a, b]\n---\n`。
- `tags: [a, b]`（flow）：在 `]` 前加上新的，保留原本的順序與格式。
- `tags:` 下接 `- a` 的區塊清單：在最後一項後面加上同樣縮排的新行。
- `tags: a`（單一字串）：改寫成 `tags: [a, b]`。
- 有 frontmatter 但沒有 `tags`：在結尾的 `---` 前加一行。
- 只改 `tags` 那幾行，其他 frontmatter 一字不動（不用 gray-matter 重新輸出，避免改掉使用者的格式與註解）。
- 標籤正規化：去掉開頭的 `#`、前後空白；比對已有標籤時不分大小寫（NFC）。含 YAML 特殊字元（`,` `[` `]` `:` `#` 等）時加引號。
- frontmatter 損毀（YAML 解析失敗）時拒絕修改，回錯誤。

## 5. UI

右側 AI 分頁上方改為三段：**Chat / Agent / Summary**（`knowmon.ai.mode` 新增 `agent`）。Chat（RAG）仍保留：一次模型呼叫、比 agent 快很多，一般問答用 Chat 就好。

- 任務輸入框（`Enter` 送出、`Shift+Enter` 換行、輸入法選字時的 Enter 不送出），執行中可停止，「New task」清空。
- 每個任務顯示步驟列表：工具圖示＋一行說明（例如「搜尋：深度工作（2026-10-12 – 2026-10-18）→ 5 篇」），點開看參數與結果摘要；結果中的筆記可點擊開啟（`Ctrl/Cmd+點擊`開新分頁）。執行中的步驟有轉圈。
- 模型在工具呼叫之間的文字（「我先搜尋…」）以淡色顯示在步驟之間；最終回答以 `Markdown` 元件渲染，wikilink 可點擊。
- 確認卡片見第 3 節；等待確認時任務輸入框停用，分頁標題旁顯示提醒點（右側面板關著時也看得到：側欄底部的 AI 狀態顯示「等待確認」）。
- 多輪：同一個任務串可以接著下指令（「把剛剛找到的整理成一篇筆記」），附上最近 3 輪的任務與最終回答（不含工具過程），同 Chat。
- 狀態是純函式 `renderer/chat/agentRun.ts`（同 `conversation.ts` 的模式），只存在記憶體，換 vault 時清空。
- 快捷鍵：`Ctrl/Cmd+Shift+G` 打開 Agent 並聚焦輸入框（同步更新 README「快捷鍵」）。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export type AgentToolName =
  | 'search_notes'
  | 'get_note'
  | 'get_neighbors'
  | 'list_notes_in_range'
  | 'create_note'
  | 'add_tags'

export interface AgentRequest {
  task: string
  /** 之前的任務與最終回答（舊 → 新），只作為脈絡 */
  history?: ChatTurn[]
}

/** 寫入工具的提案，等待使用者確認 */
export type AgentProposal =
  | { kind: 'create_note'; path: string; content: string; missingLinks: string[] }
  | { kind: 'add_tags'; path: string; title: string; tags: string[]; before: string; after: string }

export interface AgentStep {
  /** 第幾步（0-based），confirm 時用 */
  index: number
  tool: AgentToolName
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'confirm' | 'applied' | 'rejected'
  /** 給使用者看的一行說明 */
  label: string
  /** 結果中的筆記（可點擊） */
  notes: { path: string; title: string }[]
  error?: string
  /** status = 'confirm' 時帶上 */
  proposal?: AgentProposal
}

export interface AgentChunk {
  id: string
  /** 模型輸出的文字（工具呼叫之間的說明，或最終回答） */
  delta: string
  done: boolean
  error?: string
  /** 新增或更新的步驟（同 index 取代） */
  step?: AgentStep
}

export interface AgentDecision {
  approved: boolean
  /** 使用者修改後的提案（只能改 path / content / tags） */
  edited?: AgentProposal
}

// KnowmonAPI.llm 新增：
/** 開始執行任務，回傳 request id；過程經 onAgent 推送。取消沿用 cancel(id) */
agent(req: AgentRequest): Promise<string>
onAgent(cb: (c: AgentChunk) => void): () => void
/** 回覆寫入提案 */
confirm(id: string, step: number, decision: AgentDecision): Promise<void>
```

`IPC` 新增 `llmAgent: 'llm:agent'`、`llmAgentChunk: 'llm:agentChunk'`、`llmConfirm: 'llm:confirm'`。不需要 schema 變更、不需要新增相依套件。

## 測試

- `agent/tags.test.ts`：第 4 節每種 frontmatter 寫法、CRLF、重複標籤（大小寫、`#` 前綴）、特殊字元加引號、損毀的 YAML 拒絕、只改 tags 行。
- `agent/tools.test.ts`（用 test-vault 複本）：每個工具的輸出格式、標題／路徑解析、`period` 解析與錯誤、截斷與 `offset`、`get_neighbors` 各類型、`create_note` 路徑檢查（`.md`、dot 資料夾、`..`、已存在）。
- `agent/loop.test.ts`（假 chat 依序回傳工具呼叫）：多步驟、步數上限後強制作答、重複呼叫、工具錯誤回給模型、確認 Apply／Reject／取消時不寫入、Apply 時重新讀檔（等待期間檔案被改過）、使用者修改提案、context 超過上限時舊結果摘要化、最終回答的連結過濾。
- `ollama.test.ts`：`tools` 參數、串流中的 `tool_calls` 解析、不支援工具時的錯誤。
- `service.test.ts`：`agent` / `confirm` / `cancel` 的事件順序，離線錯誤。
- `renderer/chat/agentRun.test.ts`：步驟更新（同 index 取代）、確認狀態、停止、多輪 history。
- `OLLAMA_IT=1` 整合測試（test-vault 複本）：
  1. 「上週寫了哪些跟習慣有關的筆記？各自連到哪些筆記？」→ 至少呼叫 `search_notes`／`list_notes_in_range` 與 `get_neighbors`，回答的連結都存在。
  2. 「把原子習慣和深度工作整理成一篇比較筆記」→ 產生 `create_note` 提案；測試回 Reject 時檔案不存在、回 Apply 時檔案存在且內容是提案內容。
  3. 「幫日記加上 #回顧 標籤」→ `add_tags` 提案，Apply 後 frontmatter 正確。

## 不做（留到之後）

- 刪除、改名、修改既有內文的工具（風險高，確認卡片也難以呈現）。
- 自動執行（跳過確認）的選項。
- 任務紀錄存檔；把 Chat 的回答一鍵存成筆記（可以在 Agent 裡說「把這個存成筆記」達成）。
- 標籤索引（標籤目前只在 frontmatter，搜尋靠全文）。
