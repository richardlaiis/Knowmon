# 計畫：雲端對話模型（OpenAI、Gemini、自訂 OpenAI 相容 API）

## Context

使用者希望除了本機 Ollama，也能用雲端 API（ChatGPT、Gemini 等）跑總結、問答與 Agent：本機跑不動 8B 模型、或想要更強的模型。目前所有 LLM 呼叫都經過 `OllamaClient`（`src/main/llm/ollama.ts`）的 `chat` / `chatTools` / `embed` / `models`，由 `LlmService`（`service.ts`）統一管理，所以只要在同一個介面後面多接幾種 client，總結、問答、Agent 的邏輯都不用改。

使用者決定（2026-11-20）：

- **Ollama 仍是預設；雲端需主動選擇並確認警告**（筆記內容會送到該服務商）。設定所有 vault 共用（與現在的 Ollama 設定相同）。
- **雲端只負責對話**（總結、問答、Agent）。Embedding 仍走 Ollama（可選）；沒有 Ollama 時檢索沿用現有的「全文＋圖譜」退路，semantic 邊不產生。
- **第一版支援**：OpenAI、Google Gemini（OpenAI 相容端點）、自訂 OpenAI 相容 API（OpenRouter、Groq、DeepSeek、LM Studio…）。**不含 Claude**。
- **不新增相依套件**：比照 `ollama.ts` 只用 Node 內建 `fetch`；API key 用 Electron 內建 `safeStorage` 加密。

與核心設計原則：第 5 條「Ollama 是可選的」不衝突（雲端反而讓沒有 Ollama 的使用者也能用對話功能）。`roadmap.md` 專案概述第 3 點「所有資料都不離開使用者的電腦」的描述需改成「預設」不離開，見步驟 8。

## 需要你同意的合約變更（`src/shared/types.ts`）

```ts
export type CloudProvider = 'openai' | 'gemini' | 'custom'
export type ChatProvider = 'ollama' | CloudProvider

export interface LlmSettings {
  baseUrl: string // Ollama 位址（embedding；provider = ollama 時也用於對話）
  chatModel: string // Ollama 對話模型
  embedModel: string
  /** 對話使用的服務，預設 'ollama' */
  provider: ChatProvider
  /** 各雲端服務選用的模型 id */
  cloudModels: Partial<Record<CloudProvider, string>>
  /** provider = custom 時的 API 位址（https，或 http://localhost 之類的 loopback） */
  customBaseUrl: string
}

export interface LlmStatus {
  /** 目前的對話服務可用（原本的意義是「Ollama 在線」） */
  online: boolean
  /** Ollama 在線（embedding、語意搜尋、semantic 邊） */
  ollamaOnline: boolean
  /** 會擋住對話的錯誤（離線、key 錯誤、模型未下載…） */
  error: string | null
  /** 只影響 embedding 的問題；雲端模式下 Ollama 離線時顯示為提示而非錯誤 */
  embedError: string | null
  models: string[] // Ollama 已下載的模型（不變）
  /** 目前雲端服務可用的模型 id（列不出來時為空，仍可手動輸入） */
  cloudModels: string[]
  /** 哪些服務已存 API key（key 本身永遠不傳到 renderer） */
  apiKeys: Record<CloudProvider, boolean>
  /** false：OS 沒有 keyring（Linux basic_text），key 只是混淆後存檔，需提醒使用者 */
  keyEncrypted: boolean
  settings: LlmSettings
  embedded: number
  total: number
  busy: boolean
}

// IPC 介面 llm 新增：
setApiKey(provider: CloudProvider, key: string | null): Promise<LlmStatus>
```

API key **不放在 `LlmSettings`**：`setSettings`／`status` 都會把設定送到 renderer，key 只能寫入、不能讀回。

不動資料庫 schema。

## 要做的事

### 1. OpenAI 相容 client：`src/main/llm/openai.ts`（新檔）

`createOpenAiCompatible(baseUrl, apiKey, fetchImpl = fetch)`，實作與 `OllamaClient` 相同的 `chat`、`chatTools`、`models`（抽出 `ChatClient` 介面放在 `ollama.ts`，`OllamaClient extends ChatClient` 再加 `version`、`embed`）。

- `POST {base}/chat/completions`，`stream: true`、`Authorization: Bearer <key>`。工具定義格式與 Ollama 相同（`{ type: 'function', function: {...} }`），直接傳。不帶 `num_ctx`、`think`。
- SSE 解析（`data: ...` 行、`[DONE]`），片段可能切在任何位置（比照 `readNdjson` 的測試）。`delta.content` → `onDelta`；`delta.tool_calls[]` 依 `index` 累積 `function.arguments` 字串片段，結束時才 `JSON.parse`（失敗給 `{}`，與 `toToolCall` 相同）。
- 訊息轉換：Ollama 格式的 `tool_calls`（arguments 是物件）→ OpenAI 格式（`id`、`arguments` 是 JSON 字串）；`role: 'tool'` 帶 `tool_call_id`。
- **工具呼叫 id 與 Gemini 的 thought signature**：`ToolCall` 新增可選的 `id` 與 `extra`（不透明，原樣保存 `extra_content`）。`loop.ts` 把它們寫進 assistant 訊息、tool 訊息帶回對應 id；Ollama client 送出前去掉這兩個欄位（每次都相同，不影響 prompt 快取）。Gemini 3 的多步工具呼叫若沒有回傳 thought signature 會回 400，這是主要的整合風險，整合測試一定要測兩步以上的 Agent 任務。
- `temperature`：推理模型（OpenAI o 系列、gpt-5 等）不接受非預設值時回 400；比照 `think` 的做法，錯誤訊息提到 temperature 時不帶參數重送。
- `models()`：`GET {base}/models` → `data[].id`；去掉 Gemini 的 `models/` 前綴；過濾明顯不是對話用的（embedding、tts、whisper、dall-e、moderation、image、audio、realtime、transcribe）。只當作建議清單，對話框可手動輸入。
- 錯誤：沿用 `OllamaError` 的 kind（改名 `LlmError`，保留 `OllamaError` 匯出別名以免大改），新增 `auth`（401/403：「OpenAI rejected the API key」）與 `rate`（429：顯示服務商訊息與「稍後再試」）。404 + model →「Model "x" is not available for this API key」。連不上 → `offline`，訊息寫主機名稱而不是 Ollama。

各服務的預設位址（`src/shared/llm.ts`）：OpenAI `https://api.openai.com/v1`、Gemini `https://generativelanguage.googleapis.com/v1beta/openai`、custom 由使用者填。不內建預設模型名稱（模型更新太快），第一次選服務時從 `models()` 清單選，或手動輸入。

### 2. API key 儲存：`src/main/llm/secrets.ts`（新檔）

- `settings.json` 新增 `llmKeys: Partial<Record<CloudProvider, string>>`（`safeStorage.encryptString` 後 base64）。`safeStorage` 由呼叫者注入，測試用假物件。
- `keyEncrypted = safeStorage.isEncryptionAvailable() && getSelectedStorageBackend?.() !== 'basic_text'`；不是真加密時仍可儲存，對話框顯示提醒。
- 解密失敗（換機器、keyring 重設）視為沒有 key，狀態顯示「請重新輸入 API key」。
- key 只在 main process 記憶體中使用；不寫入 log、錯誤訊息、`status()`。

### 3. `LlmService` 調整（`service.ts`）

- 兩個 client：`ollama`（embedding，及 provider = ollama 時的對話）與 `chat: ChatClient`（依 provider 是 ollama 或雲端）。`summarize`／`ask`／`agent` 改用 `this.chat`；`numCtx: CHAT_NUM_CTX` 只在 Ollama 時帶。
- 狀態分開：`ollamaOnline`（原本的 `online`，embedding 與 `queryVector` 用）與 `chatOnline`。
  - provider = ollama：與現在相同（`online = ollamaOnline`，缺對話模型 → `error`）。
  - 雲端：沒有 key → `online = false`、`error = 'Add an API key for OpenAI in AI settings.'`；有 key 時以 `models()`（逾時 5 秒）檢查：`auth` 不重試、`offline`／`timeout` 每 30 秒重試；Ollama 離線只設 `embedError`（「Ollama is offline: semantic search and Semantic links are unavailable」），不擋對話。
  - 對話中遇到 `offline` 照舊觸發 `check()`；遇到 `auth` 更新狀態。
- `setSettings` 換 provider、雲端模型或 custom 位址時重建 `chat` client；`setApiKey` 存檔後重建並重新檢查。
- Agent 錯誤訊息：`isNoToolsError` 之外，雲端模型不支援工具時（400 提到 tools / function）給相同的提示。
- Agent 的字數預算（`AGENT_CONTEXT_MAX` 等）是為 CPU 上的 Ollama 調的，第一版不改；之後若要依 provider 放寬另開任務。

### 4. 設定與 IPC

- `src/shared/llm.ts`：`DEFAULT_LLM_SETTINGS` 加 `provider: 'ollama'`、`cloudModels: {}`、`customBaseUrl: ''`；`cleanLlmSettings` 驗證 provider 列舉、模型字串、`customBaseUrl`（https，或 loopback 的 http；去掉結尾 `/`）。舊的 `settings.json` 沒有這些欄位時用預設值，不需遷移。
- `src/main/settings.ts`：`Settings` 加 `llmKeys`。
- 新增 IPC `llm:setApiKey`：`shared/channels.ts` → `main/ipc.ts`（驗證 provider 是三者之一、key 是字串且去掉空白後 ≤ 500 字，`null` / 空字串 = 刪除）→ `preload/index.ts` + `index.d.ts`。

### 5. Renderer

- `LlmSettingsDialog.tsx`：
  - 最上面「Chat provider」：Ollama (local) / OpenAI / Google Gemini / Custom (OpenAI-compatible)。
  - 雲端：API key（`type="password"`；已存時顯示「Saved · Replace · Remove」，不顯示內容）、模型（`<input list>` + `<datalist>`，選項來自 `status.cloudModels`）、custom 時的 API address。`keyEncrypted === false` 時顯示提醒。
  - **確認警告**：選擇的 provider 與已存的不同且是雲端時，顯示「Note content (summaries, questions, agent tool results) will be sent to OpenAI」與必勾的 checkbox，沒勾不能存。
  - 「Embedding」區塊標示為 Ollama，說明雲端模式下 Ollama 可選。
  - 開頭說明改為依 provider 顯示（現在寫死「notes never leave this computer」）。
- `AiPanel.tsx`：狀態列顯示「OpenAI · gpt-…」或「Ollama · qwen3:8b」；`embedError` 以一般提示樣式顯示（不是紅色錯誤）。`ChatPanel`／`AgentPanel` 的 `online` 沿用 `status.online`（現在意義是「對話可用」）。Retry 的 title 改成不寫死 Ollama。
- 側欄底部狀態同步調整（`App.tsx` 中用到 `online` 的地方逐一確認）。
- 不新增快捷鍵。

### 6. 測試（vitest）

- `openai.test.ts`：SSE 在任意位置切開、`[DONE]`、工具呼叫參數分段累積、多個工具呼叫、訊息轉換（id、`extra_content` 原樣帶回）、temperature 重送、401/403/404/429/離線/取消的錯誤種類、`models()` 前綴與過濾、Bearer header。
- `secrets.test.ts`：加解密來回、解密失敗視為沒有 key、`basic_text` 時 `keyEncrypted = false`。
- `shared/llm.test.ts`：新欄位的預設值與驗證（provider 列舉、custom 位址 http 只允許 loopback）。
- `service.test.ts`：雲端 + Ollama 離線時對話可用、embedding 仍走 Ollama；沒有 key 的錯誤；`auth` 不排程重試；切換 provider 重建 client；`status()` 不含 key；雲端時不帶 `numCtx`。
- `loop.test.ts`：工具呼叫的 `id`／`extra` 寫入 assistant 訊息、tool 訊息帶對應 id。
- `ollama.test.ts`：送出前去掉 `id`／`extra`。
- `openai.integration.test.ts`（預設跳過）：`OPENAI_IT=1 OPENAI_API_KEY=… OPENAI_MODEL=…`、`GEMINI_IT=1 GEMINI_API_KEY=… GEMINI_MODEL=…`：串流對話、兩步以上的工具呼叫、`models()`。在 CLAUDE.md 指令區補上執行方式。

### 7. 手動驗證（`~/knowmon-test-vault`）

需要你提供 OpenAI／Gemini 的 API key（或你自己跑整合測試與手動測試）。沒有 key 時用 LM Studio 或 Ollama 本身的 OpenAI 相容端點（`http://127.0.0.1:11434/v1`）當 custom 測一遍。

- 切到雲端：警告與 checkbox、key 存檔後重開 App 仍在、`settings.json` 裡看不到明文 key。
- 停掉 Ollama：總結、問答、Agent（含確認寫入）在雲端模式下都能用；狀態顯示 semantic search 不可用的提示；Hybrid 搜尋退回全文。
- 錯誤的 key → 清楚的錯誤、不會每 30 秒重試；斷網 → offline、恢復後自動重試成功。
- 切回 Ollama：行為與現在相同。

### 8. 文件與收尾

- `docs/user-guide/{zh-TW,en}/ai-setup.md`：新增「雲端服務（OpenAI、Gemini、OpenAI 相容）」一節：取得 key、在設定中選擇、隱私說明、費用由服務商計算、embedding 仍需 Ollama 才有語意搜尋。
- `docs/user-guide/{zh-TW,en}/faq.md`：「筆記會被傳到網路上嗎？」補上雲端模式；`README.md` 的 AI 清單加連結。
- `docs/architecture.md`「LLM」章節加雲端 client、狀態分離、key 儲存、thought signature 等決定。
- `docs/roadmap.md`：專案概述第 3 點改成「預設使用本地 Ollama，資料不離開電腦；也可主動選用雲端 API」；技術選型表加一列；階段 8 加一個「雲端對話模型（OpenAI、Gemini、OpenAI 相容）」項目並勾選。
- `docs/testing.md` 加上第 7 點的手動測試項目。
- `npx vitest run`、`npm run typecheck`、`npm run lint` 全部通過。

## 驗證

- 單元測試涵蓋第 6 點；整合測試在有 key 時跑過 OpenAI 與 Gemini（尤其 Gemini 的多步工具呼叫）。
- 第 7 點手動清單逐項確認；沒有實測到的服務（例如沒有 key）在回報中說明。
