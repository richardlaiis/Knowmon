# Plan: configurable context length and max output tokens

## Context

The user asked whether max output tokens and the context window can be configured. Neither could:

- Ollama always gets `num_ctx = 8192` (`CHAT_NUM_CTX` in `src/main/llm/service.ts`, shared by summaries/Q&A/agent so switching between them doesn't reload the model); cloud providers get no context parameter.
- The note content sent is also limited by hard-coded character budgets: Q&A `ASK_CONTEXT_MAX = 8000` and `ASK_CHUNK_MAX = 2000` (`ask.ts`); summaries `SUMMARY_DIRECT_MAX = 12000` and `SUMMARY_PART_MAX = 6000` (`summarize.ts`); agent `AGENT_CONTEXT_MAX = 6000` and `TOOL_RESULT_MAX = 1500` (`agent/loop.ts`), and `NOTE_CHARS = 1200` (`agent/tools.ts`).
- No request sends an output limit (`num_predict` / `max_tokens` / `max_completion_tokens`), so the length is up to the model.

People with little local memory want a smaller context, GPU or cloud users want a larger context and more sources, and some want to cap reply length (cloud billing, generation time on a CPU).

User decisions (2026-11-26):

- **The context setting controls both Ollama's `num_ctx` and the character budgets**: the budgets scale by `contextTokens / 8192` for every provider (cloud APIs have no context parameter, so for them it only affects the budgets). At 8192 behavior is exactly as it is now.
- **Ollama and the cloud each get their own pair** (shared by the three cloud providers), so switching providers doesn't require retuning.

This doesn't violate the core design principles. Two decisions in `architecture.md`, "the agent's character budgets aren't relaxed per provider in the first version" and "`num_ctx` is fixed at 8192", are updated by this plan (the three features still share one `num_ctx`, so switching features doesn't reload the model). No new dependencies and no database schema change.

## Contract changes needing your approval (`src/shared/types.ts`)

```ts
export interface ChatLimits {
  /** Context length (tokens). Sent to Ollama as num_ctx; also scales the character budgets for note content */
  contextTokens: number
  /** Maximum tokens per reply; null = model default */
  maxOutputTokens: number | null
}

export interface LlmSettings {
  // ...existing fields unchanged
  /** Used when provider = ollama */
  ollamaLimits: ChatLimits
  /** Shared by the cloud providers (OpenAI, Gemini, custom) */
  cloudLimits: ChatLimits
}
```

The IPC interface is unchanged (it reuses `llm.setSettings`).

## Steps

### 1. Defaults and validation (`src/shared/llm.ts`)

- `DEFAULT_CHAT_LIMITS = { contextTokens: 8192, maxOutputTokens: null }`, used for both `ollamaLimits` and `cloudLimits` in `DEFAULT_LLM_SETTINGS`. Old `settings.json` files without these fields get the defaults, with no migration.
- `CHAT_LIMITS`: `contextTokens` [2048, 1_048_576], `maxOutputTokens` [256, 131_072], rounded to integers and clamped to the nearest bound when out of range (like `clampSemanticSettings`). `null` / an empty string for `maxOutputTokens` means the model default.
- `cleanLlmSettings` adds `cleanChatLimits`; Ollama's `maxOutputTokens` may not exceed `contextTokens` (`num_predict` also uses context).
- `activeChatLimits(s)`: returns the pair for the current `provider` (next to `activeChatModel`).

### 2. Character budgets (`src/main/llm/budget.ts`, new)

```ts
export const BASE_CONTEXT_TOKENS = 8192
export interface ChatBudget {
  askContext: number // ASK_CONTEXT_MAX
  askChunk: number // ASK_CHUNK_MAX
  summaryDirect: number // SUMMARY_DIRECT_MAX
  summaryPart: number // SUMMARY_PART_MAX
  agentContext: number // AGENT_CONTEXT_MAX
  toolResult: number // TOOL_RESULT_MAX
  noteChars: number // NOTE_CHARS (get_note page size, still within toolResult)
}
export function chatBudget(contextTokens: number): ChatBudget
```

- Each value = the existing constant × `contextTokens / 8192`, rounded; `toolResult` is at least `TOOL_RESULT_MIN` (300). The existing constants stay as the 8192 baseline; `chatBudget(8192)` must equal the current constants item by item (locked by a test).
- Not scaled: the number of Q&A sources (`ASK_SOURCES = 8`), the number and length of history messages, agent steps, snippet length. Since the number of sources doesn't change, Q&A text is still bounded by "the top 8 notes" even with a very large context.
- Callers take a budget parameter whose default is still the existing constant, so existing tests don't change:
  - `summarize(...)` gains an optional `budget` (`summaryDirect` / `summaryPart`).
  - `gatherSources(db, hits, max)` already has a `max` parameter; `askChunk` is passed too.
  - `runAgent`'s `AgentLoopOptions` gains an optional `budget` (`agentContext` / `toolResult`); `ToolContext` gains an optional `noteChars`.

### 3. Client parameters

- `ChatOptions` (`ollama.ts`) gains `maxTokens?: number` and `onTruncated?: () => void`.
- Ollama (`stream` in `ollama.ts`): `options.num_predict = maxTokens`; call `onTruncated` when the last NDJSON object has `done_reason === 'length'`.
- OpenAI-compatible (`openai.ts`): OpenAI gets `max_completion_tokens` (newer models reject `max_tokens`), Gemini and custom get `max_tokens` (the most widely supported). This is decided by a new `maxTokensParam` in `OpenAiCompatibleOptions`, set by the service per provider. On a 400 whose error mentions either parameter name, resend once with the other name; this is combined with the existing `temperature` resend into one retry of at most 3 attempts (each parameter adjusted once). Call `onTruncated` on `finish_reason === 'length'`.
- `LlmService.chatOptions` (`service.ts`) reads `activeChatLimits(this.settings)`: Ollama gets `numCtx: contextTokens`; `maxTokens` is sent when `maxOutputTokens` isn't `null`. `CHAT_NUM_CTX` becomes the baseline, used only as the default. The three features still use one setting, so switching features doesn't reload the model; the first call after a settings change reloads it once (explained in the setting's help text).
- `summarize`/`ask`/`agent` pass budgets from `chatBudget(activeChatLimits(settings).contextTokens)`.

### 4. Truncation notice

When a final answer (the last call of a summary, a Q&A answer, the agent's final answer) is cut off by the output limit, append an italic notice at the end of the stream: "_(Reply stopped at the max output limit — raise it in AI settings.)_" (in Chinese or English, following the answer's language). It goes through the existing `delta`, **with no contract change**. No notice when intermediate parts of a split summary or agent tool-call steps are truncated (when tool call arguments are incomplete, the existing logic returns the error to the model as the result). When old answers are included in Q&A history, the notice is stripped first.

### 5. Settings dialog (`src/renderer/chat/LlmSettingsDialog.tsx`)

- Show the pair for the currently selected provider (inside the Ollama section or the cloud section), as two number fields:
  - **Context length** (tokens): help "Ollama allocates this much memory per chat (changing it reloads the model once). Also scales how much note text is sent: 8192 = default; 32768 sends about 4× more sources and tool results." Cloud version: "Your model's context window. Scales how much note text is sent; more text costs more."
  - **Max output tokens**: blank = model default. The help text warns that for reasoning models the limit includes thinking tokens, so too small a value can leave the answer empty.
- Out-of-range values show an error and can't be saved (like the field validation in `TimeSettingsDialog`, showing the `CHAT_LIMITS` range).
- No new shortcuts.

### 6. Tests (vitest)

- `shared/llm.test.ts`: defaults, old settings missing the fields, range bounds and rounding, `null` / empty string, Ollama's output limit not exceeding the context, `activeChatLimits`.
- `budget.test.ts`: `chatBudget(8192)` equals the existing constants; proportions at 2048 / 32768; the `toolResult` minimum.
- `ollama.test.ts`: `num_predict` and `num_ctx` sent only when set; `done_reason: 'length'` triggers `onTruncated`.
- `openai.test.ts`: OpenAI sends `max_completion_tokens`, others `max_tokens`; resending with the other name when one is rejected; combined with the temperature resend; `finish_reason: 'length'`.
- `summarize.test.ts` / `ask.test.ts` / `loop.test.ts`: splitting, source length and tool result truncation follow a smaller budget.
- `service.test.ts`: after changing `ollamaLimits.contextTokens`, all three features send the new `num_ctx` (still identical); cloud sends no `num_ctx` but does send `maxTokens`; switching providers uses the matching pair; a truncated answer gets the notice, and Q&A history strips it.

### 7. Manual verification (`~/knowmon-test-vault`)

- Ollama: set the context to 4096 → `ollama ps` shows 4096; after setting it back to 8192, behavior is as before. Set max output to 256 → a long summary is cut off with the notice.
- Context 32768: Q&A sources and the agent's `get_note` pages get longer (check the sources under the answer and the agent steps).
- Cloud (OpenAI/Gemini with a key, otherwise Ollama's `/v1` as custom): max output takes effect and the truncation notice appears; no `num_ctx` is sent.
- Out-of-range values can't be saved; settings are kept after restarting the app; each provider's pair is kept when switching providers.

### 8. Documentation and wrap-up

- First save this plan as `docs/plans/configurable-llm-limits.md`.
- `docs/architecture.md` "LLM" / "Agent" sections: update the descriptions of `num_ctx` and the character budgets (configurable, scaled proportionally, still sharing one `num_ctx`), and add the output limit parameter names and the truncation notice.
- `docs/user-guide/{zh-TW,en}/ai-setup.md`: add a "Context length and max output" section (the trade-offs between memory, speed and cost).
- `docs/roadmap.md`: add and check off an item under phase 8; `docs/testing.md`: add the manual tests from step 7.
- `npx vitest run`, `npm run typecheck` and `npm run lint` all pass.

## Verification

- Unit tests cover step 6, and the `chatBudget(8192)` test ensures default behavior is unchanged.
- Go through the manual checklist in step 7; report any provider that wasn't actually tested (for example, without an OpenAI key).
