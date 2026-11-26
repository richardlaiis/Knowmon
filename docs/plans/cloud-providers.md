# Plan: cloud chat models (OpenAI, Gemini, custom OpenAI-compatible APIs)

## Context

Besides the local Ollama, the user wants to run summaries, Q&A and the Agent on cloud APIs (ChatGPT, Gemini and so on): either the local machine can't run an 8B model, or they want a stronger model. Today every LLM call goes through `chat` / `chatTools` / `embed` / `models` on `OllamaClient` (`src/main/llm/ollama.ts`), managed by `LlmService` (`service.ts`), so adding more kinds of client behind the same interface leaves the summary, Q&A and Agent logic unchanged.

User decisions (2026-11-20):

- **Ollama stays the default; a cloud provider must be chosen explicitly, with a confirmed warning** (note content is sent to that provider). Settings are shared by all vaults (like the current Ollama settings).
- **The cloud is only for chat** (summaries, Q&A, Agent). Embeddings still use Ollama (optional); without Ollama, retrieval uses the existing "full text + graph" fallback and no semantic edges are produced.
- **First version supports**: OpenAI, Google Gemini (OpenAI-compatible endpoint), custom OpenAI-compatible APIs (OpenRouter, Groq, DeepSeek, LM Studio…). **Not Claude**.
- **No new dependencies**: like `ollama.ts`, only Node's built-in `fetch`; API keys are encrypted with Electron's built-in `safeStorage`.

Against the core design principles: principle 5, "Ollama is optional", isn't violated (if anything, the cloud lets users without Ollama use the chat features). Point 3 of the project overview in `roadmap.md`, "no data ever leaves the user's computer", needs to become "by default"; see step 8.

## Contract changes needing your approval (`src/shared/types.ts`)

```ts
export type CloudProvider = 'openai' | 'gemini' | 'custom'
export type ChatProvider = 'ollama' | CloudProvider

export interface LlmSettings {
  baseUrl: string // Ollama address (embeddings; also chat when provider = ollama)
  chatModel: string // Ollama chat model
  embedModel: string
  /** The provider used for chat, default 'ollama' */
  provider: ChatProvider
  /** The model id chosen for each cloud provider */
  cloudModels: Partial<Record<CloudProvider, string>>
  /** The API address when provider = custom (https, or loopback http such as http://localhost) */
  customBaseUrl: string
}

export interface LlmStatus {
  /** The current chat provider is available (it used to mean "Ollama is online") */
  online: boolean
  /** Ollama is online (embeddings, semantic search, semantic edges) */
  ollamaOnline: boolean
  /** Errors that block chat (offline, bad key, model not downloaded…) */
  error: string | null
  /** Problems affecting only embeddings; in cloud mode, Ollama being offline shows as a notice rather than an error */
  embedError: string | null
  models: string[] // models downloaded in Ollama (unchanged)
  /** Model ids available from the current cloud provider (empty when they can't be listed; manual entry still works) */
  cloudModels: string[]
  /** Which providers have a saved API key (the key itself is never sent to the renderer) */
  apiKeys: Record<CloudProvider, boolean>
  /** false: the OS has no keyring (Linux basic_text), so the key is only obfuscated on disk and the user must be warned */
  keyEncrypted: boolean
  settings: LlmSettings
  embedded: number
  total: number
  busy: boolean
}

// Added to the llm IPC interface:
setApiKey(provider: CloudProvider, key: string | null): Promise<LlmStatus>
```

API keys **are not in `LlmSettings`**: both `setSettings` and `status` send settings to the renderer, and keys must be write-only.

No database schema change.

## Steps

### 1. OpenAI-compatible client: `src/main/llm/openai.ts` (new)

`createOpenAiCompatible(baseUrl, apiKey, fetchImpl = fetch)` implements the same `chat`, `chatTools` and `models` as `OllamaClient` (extract a `ChatClient` interface into `ollama.ts`; `OllamaClient extends ChatClient` and adds `version` and `embed`).

- `POST {base}/chat/completions` with `stream: true` and `Authorization: Bearer <key>`. The tool definition format is the same as Ollama's (`{ type: 'function', function: {...} }`), passed through directly. No `num_ctx` or `think`.
- SSE parsing (`data: ...` lines, `[DONE]`), where chunks may be split anywhere (as in `readNdjson`'s tests). `delta.content` → `onDelta`; `delta.tool_calls[]` accumulates `function.arguments` string fragments by `index`, and `JSON.parse` runs only at the end (falling back to `{}` on failure, like `toToolCall`).
- Message conversion: Ollama-style `tool_calls` (arguments as an object) → OpenAI style (`id`, `arguments` as a JSON string); `role: 'tool'` carries `tool_call_id`.
- **Tool call ids and Gemini's thought signatures**: `ToolCall` gains optional `id` and `extra` (opaque, keeping `extra_content` verbatim). `loop.ts` writes them into the assistant message, and tool messages carry back the matching id; the Ollama client strips both fields before sending (always the same result, so the prompt cache isn't affected). Gemini 3 returns 400 on multi-step tool calls if the thought signature isn't sent back; this is the main integration risk, so the integration test must cover an Agent task with two or more steps.
- `temperature`: reasoning models (OpenAI's o series, gpt-5 and so on) return 400 for non-default values; as with `think`, when the error mentions temperature, resend without it.
- `models()`: `GET {base}/models` → `data[].id`; strip Gemini's `models/` prefix; filter out obvious non-chat models (embedding, tts, whisper, dall-e, moderation, image, audio, realtime, transcribe). Only a suggestion list; the dialog allows manual entry.
- Errors: reuse `OllamaError`'s kinds (renamed `LlmError`, keeping an `OllamaError` export alias to avoid a big change), adding `auth` (401/403: "OpenAI rejected the API key") and `rate` (429: the provider's message plus "try again later"). 404 + model → "Model "x" is not available for this API key". Unreachable → `offline`, with the host name in the message instead of Ollama.

Default addresses per provider (`src/shared/llm.ts`): OpenAI `https://api.openai.com/v1`, Gemini `https://generativelanguage.googleapis.com/v1beta/openai`, custom entered by the user. No built-in default model names (models change too quickly); on first choosing a provider, pick from the `models()` list or type one.

### 2. API key storage: `src/main/llm/secrets.ts` (new)

- `settings.json` gains `llmKeys: Partial<Record<CloudProvider, string>>` (base64 after `safeStorage.encryptString`). `safeStorage` is injected by the caller, with a fake in tests.
- `keyEncrypted = safeStorage.isEncryptionAvailable() && getSelectedStorageBackend?.() !== 'basic_text'`; keys can still be saved without real encryption, and the dialog shows a warning.
- A failed decryption (a different machine, a reset keyring) counts as no key, and the status says "please enter the API key again".
- Keys are used only in main-process memory; never written to logs, error messages or `status()`.

### 3. `LlmService` changes (`service.ts`)

- Two clients: `ollama` (embeddings, and chat when provider = ollama) and `chat: ChatClient` (Ollama or the cloud, depending on the provider). `summarize`/`ask`/`agent` use `this.chat`; `numCtx: CHAT_NUM_CTX` is sent only for Ollama.
- Separate status: `ollamaOnline` (the old `online`, used by embeddings and `queryVector`) and `chatOnline`.
  - provider = ollama: the same as now (`online = ollamaOnline`, a missing chat model → `error`).
  - Cloud: no key → `online = false`, `error = 'Add an API key for OpenAI in AI settings.'`; with a key, check with `models()` (5-second timeout): `auth` isn't retried, `offline`/`timeout` retry every 30 seconds; Ollama being offline only sets `embedError` ("Ollama is offline: semantic search and Semantic links are unavailable") without blocking chat.
  - `offline` during chat still triggers `check()`; `auth` updates the status.
- `setSettings` rebuilds the `chat` client when the provider, cloud model or custom address changes; `setApiKey` saves, rebuilds and checks again.
- Agent error messages: besides `isNoToolsError`, give the same hint when a cloud model doesn't support tools (a 400 mentioning tools / function).
- The Agent's character budgets (`AGENT_CONTEXT_MAX` and so on) were tuned for Ollama on a CPU and stay unchanged in the first version; relaxing them per provider is a separate task.

### 4. Settings and IPC

- `src/shared/llm.ts`: `DEFAULT_LLM_SETTINGS` adds `provider: 'ollama'`, `cloudModels: {}` and `customBaseUrl: ''`; `cleanLlmSettings` validates the provider enum, model strings and `customBaseUrl` (https, or loopback http; trailing `/` removed). Old `settings.json` files without these fields get the defaults, with no migration.
- `src/main/settings.ts`: `Settings` adds `llmKeys`.
- New IPC `llm:setApiKey`: `shared/channels.ts` → `main/ipc.ts` (validates that the provider is one of the three and the key is a string of ≤ 500 characters after trimming; `null` / empty string = delete) → `preload/index.ts` + `index.d.ts`.

### 5. Renderer

- `LlmSettingsDialog.tsx`:
  - "Chat provider" at the top: Ollama (local) / OpenAI / Google Gemini / Custom (OpenAI-compatible).
  - Cloud: API key (`type="password"`; once saved it shows "Saved · Replace · Remove" without the content), model (`<input list>` + `<datalist>`, with options from `status.cloudModels`), and the API address for custom. Show a warning when `keyEncrypted === false`.
  - **Consent warning**: when the chosen provider differs from the saved one and is a cloud provider, show "Note content (summaries, questions, agent tool results) will be sent to OpenAI" with a required checkbox; saving is blocked until it's checked.
  - Label the "Embedding" section as Ollama, explaining that Ollama is optional in cloud mode.
  - The opening description depends on the provider (it currently says "notes never leave this computer" unconditionally).
- `AiPanel.tsx`: the status line shows "OpenAI · gpt-…" or "Ollama · qwen3:8b"; `embedError` uses the normal notice style (not a red error). `ChatPanel`/`AgentPanel` keep using `status.online` (which now means "chat is available"). The Retry title no longer hard-codes Ollama.
- Adjust the status at the bottom of the sidebar to match (check every use of `online` in `App.tsx`).
- No new shortcuts.

### 6. Tests (vitest)

- `openai.test.ts`: SSE split at arbitrary positions, `[DONE]`, tool call arguments accumulated across chunks, multiple tool calls, message conversion (id and `extra_content` sent back verbatim), resending without temperature, error kinds for 401/403/404/429/offline/cancel, `models()` prefix stripping and filtering, the Bearer header.
- `secrets.test.ts`: encryption round trip, failed decryption counts as no key, `keyEncrypted = false` with `basic_text`.
- `shared/llm.test.ts`: defaults and validation of the new fields (provider enum, custom address allowing http only for loopback).
- `service.test.ts`: chat available in cloud mode with Ollama offline, while embeddings still use Ollama; the no-key error; `auth` doesn't schedule a retry; switching providers rebuilds the client; `status()` contains no key; no `numCtx` in cloud mode.
- `loop.test.ts`: tool call `id`/`extra` written into the assistant message, and tool messages carry the matching id.
- `ollama.test.ts`: `id`/`extra` stripped before sending.
- `openai.integration.test.ts` (skipped by default): `OPENAI_IT=1 OPENAI_API_KEY=… OPENAI_MODEL=…` and `GEMINI_IT=1 GEMINI_API_KEY=… GEMINI_MODEL=…`: streaming chat, tool calls with two or more steps, `models()`. Add how to run it to the commands section of CLAUDE.md.

### 7. Manual verification (`~/knowmon-test-vault`)

Needs an OpenAI/Gemini API key from you (or you run the integration and manual tests yourself). Without a key, run through it with LM Studio or Ollama's own OpenAI-compatible endpoint (`http://127.0.0.1:11434/v1`) as custom.

- Switching to the cloud: the warning and checkbox; the key is still there after restarting the app; no plain-text key in `settings.json`.
- With Ollama stopped: summaries, Q&A and the Agent (including confirming writes) all work in cloud mode; the status shows a notice that semantic search is unavailable; Hybrid search falls back to full text.
- A wrong key → a clear error, without retrying every 30 seconds; going offline → offline, retrying automatically and succeeding after reconnecting.
- Switching back to Ollama: behaves as it does now.

### 8. Documentation and wrap-up

- `docs/user-guide/{zh-TW,en}/ai-setup.md`: add a "Cloud providers (OpenAI, Gemini, OpenAI-compatible)" section: getting a key, choosing it in settings, privacy, usage billed by the provider, and that semantic search still needs Ollama for embeddings.
- `docs/user-guide/{zh-TW,en}/faq.md`: add cloud mode to "Are my notes sent over the internet?"; add a link to the AI list in `README.md`.
- The "LLM" section of `docs/architecture.md`: the decisions on the cloud client, separate status, key storage, thought signatures and so on.
- `docs/roadmap.md`: change point 3 of the project overview to "uses a local Ollama by default and no data leaves the computer; users can also opt in to a cloud API"; add a row to the technology table; add and check off a "Cloud chat models (OpenAI, Gemini, OpenAI-compatible)" item under phase 8.
- Add the manual tests from step 7 to `docs/testing.md`.
- `npx vitest run`, `npm run typecheck` and `npm run lint` all pass.

## Verification

- Unit tests cover step 6; with keys, the integration tests pass against OpenAI and Gemini (especially Gemini's multi-step tool calls).
- Go through the manual checklist in step 7; report any provider that wasn't actually tested (for example, for lack of a key).
