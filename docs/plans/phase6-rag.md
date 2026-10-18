# 階段 6 實作計畫：問答（RAG）

完成標準：對話面板能回答問題，並附上可點擊的來源筆記。

- [x] 對話面板 UI
- [x] RAG 回答附來源連結
- [x] 支援時間範圍篩選（例如「上個月的筆記」）

## 已確認的決定（2026-10-12）

- 同意 `types.ts` 合約變更（下方「IPC 合約變更」）。
- 對話面板放在右側 AI 分頁內，以「Chat / Summary」切換。
- 引用格式用編號 `[n]`。

## 實作結果與偏離計畫之處（2026-10-12）

- **全文檢索改用關鍵字 OR**：`searchNotes` 依空白切詞、全部 AND，中文問句（「深度工作的重點是什麼？」）整句是一個詞，幾乎不會命中。問答改由 `keywords()` 去掉標點、疑問詞與虛詞，再以 `retrieve()` 的內部參數 `keywords` 對每個關鍵字各自搜尋（OR），命中越多個關鍵字的排越前面。不影響 IPC（`RetrieveOptions` 不變），側欄搜尋仍是 AND。
- **追問**：計畫是「前一個問題＋目前問題」一起檢索；但關鍵字 OR 時前一題的詞會蓋過新問題。改成：沒有關鍵字、或語氣像追問（「那…」「還有…」「…呢？」「what about…」）時，向量查詢加上前一個問題；自己沒有關鍵字時才沿用前一題的關鍵字。「第二點」這類序數不當作關鍵字。
- 補前後 chunk 時只補與已選段落相鄰的，所以每篇的內文一定連續，不需要「…」分隔。
- 只有時間、沒有可檢索的內容（「上個月寫了什麼？」），或檢索結果為空但有時間範圍時，列出範圍內的筆記（新 → 舊）。完全找不到來源時直接回覆「筆記中找不到相關的內容」，不呼叫模型。
- 回答的語言依問題：漢字數 ≥ 英文單字數時用繁體中文。
- `AnswerChunk` 推送前不檢查是否已取消；取消後 main 仍送出 `done`（不帶 error），renderer 停止後的片段一律忽略（與總結相同）。
- 實測（qwen3:8b、bge-m3、test-vault，`OLLAMA_IT=1`）：
  - 「深度工作的重點是什麼？」約 5 秒，引用 [1] 深度工作。
  - 「2026-10-04 到 2026-10-06 之間做了什麼？」範圍正確，來源只有三篇日記，三篇都有引用（約 28 秒，含模型載入）。
  - 「What are the key ideas of Atomic Habits?」英文回答，引用原子習慣。
  - 「薛丁格方程式怎麼推導？」回答「筆記裡沒有相關內容。」，沒有編造。

## 原則對照

- **Markdown 是唯一真相**：對話紀錄只存在記憶體（和總結一樣），不寫入 vault，也不寫入 DB。
- **Ollama 是可選的**：問答只在 `src/main/llm/` 呼叫 Ollama；離線時 UI 顯示原因、送出按鈕停用，其餘功能照常。向量不可用時檢索退回全文＋圖譜（沿用 `retrieve` 的 `vector: false`），回答下方提示「語意搜尋暫不可用」。
- **只在 main process 存取 DB 與 Ollama**：檢索、組 context、呼叫模型都在 main，renderer 只送問題、收串流片段。
- 本階段沒有寫入筆記的動作（回答只顯示、可複製）。

## 1. 流程（`src/main/llm/ask.ts`）

`LlmService.ask(req)` 回傳 request id，片段經 `llm:answer` 推送（與總結相同的模式）：

1. **時間範圍**：`req.from` / `req.to` 有值時直接使用；否則由 `parseTimeRange(question, now)` 從問題中解析（見第 2 節）。解析出的範圍隨第一個片段推送給 renderer 顯示。
2. **檢索查詢**：問題去掉時間片語（「上個月」不應當成關鍵字），加上前一個使用者問題（追問如「那第二點呢？」本身沒有可檢索的詞）。向量只用目前的問題。
3. **檢索**：沿用 `retrieve()`，`limit = 8`，帶時間範圍。
   - 問題只有時間、沒有可檢索的詞（「上個月寫了什麼？」），或檢索結果為空但有時間範圍：改列出範圍內的筆記（依日期新 → 舊，最多 8 篇），每篇取開頭的 chunk。
4. **Context**：每篇取最相關的 chunk（`RetrieveHit.line` 所在的 chunk）全文，前後各補一塊直到總長約 `ASK_CONTEXT_MAX = 8000` 字；依名次編號 `[1]`…`[n]`，附標題與日期。
5. **提示詞**：只根據來源回答，引用處標 `[n]`；來源不足時直接說不知道，不編造。語言跟著問題（`detectLanguage`：中日韓文字比例），英文時在內容後重申語言（同總結的經驗）。不寫任何 `[n]` 或 `[[...]]` 以外的範例。
6. **多輪**：附上最近 3 輪問答（每則截到 1000 字），只作為對話脈絡；來源每輪重新檢索。
7. **串流與過濾**：`createCitationFilter(n)`，超出範圍的 `[k]` 去掉（同 `createLinkFilter` 的暫存方式，`[` 開頭的片段等到 `]` 才判斷）。結束時回報實際被引用的來源編號。

### 引用格式：`[n]` 而不是 `[[標題]]`

- `[n]` 對應到具體段落（路徑＋行號），點擊可直接捲到那一段；`[[標題]]` 只能開啟筆記。
- 小模型抄寫 `[1]` 比抄寫完整標題可靠，標題同名或很長時也不會出錯。
- 回答內文中的 `[[wikilink]]`（模型引用筆記原文時）仍以既有的 `createLinkFilter` 過濾，只保留來源中出現過的連結。

## 2. 時間範圍解析（`src/shared/timeRange.ts`，純函式）

`parseTimeRange(text, now): { from, to, label, match: [start, end] } | null`，main 與 renderer 共用（renderer 在輸入時即時顯示偵測到的範圍）。日期一律本地時區、含兩端，回傳 `YYYY-MM-DD`。

| 寫法                                                           | 範圍                |
| -------------------------------------------------------------- | ------------------- |
| 今天、昨天、前天 / today、yesterday                            | 該日                |
| 這週、本週、上週、上上週 / this week、last week                | 週一 – 週日         |
| 這個月、本月、上個月 / this month、last month                  | 整月                |
| 今年、去年 / this year、last year                              | 整年                |
| 最近／過去 N 天、週、個月（N 可為中文數字）/ past/last N days… | 往前 N 天（含今天） |
| `2026-09`、2026 年 9 月、9 月（未寫年份時取最近一次的 9 月）   | 整月                |
| `2026-09-01` 到／至／~ `2026-09-15`、單一日期                  | 該範圍／該日        |
| 2026 年、2026（年份單獨出現且前後有「年」字或在 in/during 後） | 整年                |

- 只取第一個符合的片語。週從週一開始。
- 「最近」單獨出現（沒有數字）不算時間範圍，以免誤判。
- 面板上以 chip 顯示「2026-09-01 – 2026-09-30 ×」，可點 × 取消（之後送出時帶 `range: null` 表示不篩選）或手動改日期。

## 3. 對話面板 UI

位置：右側面板 **AI** 分頁內，上方加「Chat / Summary」切換（偏好存 localStorage `knowmon.ai.mode`）。狀態列（連線、embedding 進度）兩者共用。

- 訊息列表：使用者問題、回答（沿用 `Markdown` 元件，新增 `citation` inline 節點：`[n]` 渲染成上標按鈕，hover 顯示來源標題與段落）。
- 每則回答下方列出來源：編號、標題、日期、段落摘要（`TextSegment[]`）；被引用的來源排前面，未被引用的收合在「其他參考」中。點擊開啟筆記並捲到該行（沿用搜尋 Hybrid 結果的跳轉），`Ctrl/Cmd+點擊` 開新分頁。
- 輸入框：`Enter` 送出、`Shift+Enter` 換行；生成中可停止。上方顯示時間範圍 chip。
- 「New chat」清空對話。對話只存在記憶體，切換 vault 時清空。
- 回答可複製（複製時 `[n]` 換成 `[[標題]]`，貼進筆記仍是有效連結）。
- 快捷鍵：`Ctrl/Cmd+Shift+A` 打開右側 AI 分頁的 Chat 並聚焦輸入框（同步更新 README「快捷鍵」）。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  question: string
  /** 之前的問答（舊 → 新），只作為對話脈絡 */
  history?: ChatTurn[]
  /**
   * 時間範圍（YYYY-MM-DD，含兩端）。
   * undefined = 從問題中解析；null = 使用者取消了範圍，不篩選。
   */
  range?: DateRange | null
}

export interface DateRange {
  from: string
  to: string
}

export interface AskSource {
  /** 回答中的引用編號 [n]（1-based） */
  n: number
  path: string
  title: string
  /** 段落起始行（1-based） */
  line: number
  snippet: TextSegment[]
  /** event_date，沒有的話用最後修改日 */
  date: string
}

export interface AnswerChunk {
  id: string
  delta: string
  done: boolean
  error?: string
  /** 檢索完成時推送一次（第一個片段之前） */
  sources?: AskSource[]
  /** 實際套用的時間範圍，與 sources 一起推送；null = 未篩選 */
  range?: DateRange | null
  /** false = 這次沒有用到向量，與 sources 一起推送 */
  vector?: boolean
  /** done 時帶上：回答中實際引用的編號 */
  cited?: number[]
}

// KnowmonAPI.llm 新增：
/** 開始串流回答，回傳 request id；片段經 onAnswer 推送。取消沿用 cancel(id) */
ask(req: AskRequest): Promise<string>
onAnswer(cb: (c: AnswerChunk) => void): () => void
```

`IPC` 新增 `llmAsk: 'llm:ask'`、`llmAnswer: 'llm:answer'`。不需要 schema 變更。

## 測試

- `shared/timeRange.test.ts`：表格中每種寫法（中英文、跨年的上個月、週一邊界、中文數字）、不該命中的句子（「最近在想」）、`match` 位置。
- `llm/ask.test.ts`：context 組裝（名次、字數上限、補前後 chunk）、時間片語從查詢中移除、只有時間時列出範圍內筆記、多輪 history 截斷、語言偵測；以假的 chat 測串流、取消、離線錯誤。
- `createCitationFilter`：超出範圍的 `[k]`、跨片段的 `[1` + `2]`、`[1, 2]` / `[1][2]` 寫法、一般的 `[x]` 文字不受影響、回報 cited。
- `renderer/chat/conversation.test.ts`：對話狀態純函式（送出、套用片段、停止、錯誤、New chat）。
- `renderer/chat/markdown.test.ts`：`[n]` 解析成 citation，程式碼內不解析。
- `OLLAMA_IT=1` 的整合測試：test-vault 上問 3 個問題（一般、時間範圍、無相關筆記），檢查有引用、引用編號有效、無相關時不編造。

## 不做（留到之後）

- 對話紀錄存檔、把回答存成筆記（寫入動作留到階段 7 附確認流程）。
- 以 LLM 改寫追問（query rewriting）：先用「前一個問題＋目前問題」的簡單做法，實測不夠再評估。
