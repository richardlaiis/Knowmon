import { useState } from 'react'
import {
  CHAT_LIMITS,
  CLOUD_PROVIDERS,
  PROVIDER_LABELS,
  isCloudProvider,
  sameModel
} from '../../shared/llm'
import type { ChatProvider, CloudProvider, LlmSettings, LlmStatus } from '../../shared/types'
import { draftToLimits, limitsToDraft, type ChatLimitsDraft } from './chatLimits'

/** API key changes to save: a string = a new key, null = delete */
export type ApiKeyChanges = Partial<Record<CloudProvider, string | null>>

export interface LlmSettingsDialogProps {
  status: LlmStatus
  /**
   * Once the returned Promise resolves, the caller closes the dialog when keepOpen is false; on failure the caller shows the error.
   * keepOpen: a cloud provider key was just entered without choosing a model, so the dialog stays open after saving to pick from the model list
   */
  onSave: (next: LlmSettings, keys: ApiKeyChanges, keepOpen: boolean) => Promise<void>
  onClose: () => void
}

const PROVIDERS: ChatProvider[] = ['ollama', ...CLOUD_PROVIDERS]

const PROVIDER_OPTIONS: Record<ChatProvider, string> = {
  ollama: 'Ollama (local)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  custom: 'Custom (OpenAI-compatible)'
}

type LimitsKey = 'ollamaLimits' | 'cloudLimits'

const LIMIT_HELP: Record<LimitsKey, string> = {
  ollamaLimits:
    'Memory Ollama sets aside for each chat; changing it reloads the model once. Also scales how much note text is sent: 32768 sends about 4× more sources and tool results than 8192, and is slower on a CPU.',
  cloudLimits:
    "Your model's context window. Scales how much note text is sent: 32768 sends about 4× more sources and tool results than 8192, which costs more."
}

/** Downloaded models plus the configured model (which may not be downloaded yet) */
function options(models: string[], current: string): string[] {
  return models.some((m) => sameModel(m, current)) ? models : [current, ...models]
}

/** Chat provider, Ollama address and models, stored in the app's settings (shared by all vaults) */
export function LlmSettingsDialog({
  status,
  onSave,
  onClose
}: LlmSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<LlmSettings>(status.settings)
  const [keys, setKeys] = useState<ApiKeyChanges>({})
  const [limits, setLimits] = useState<Record<LimitsKey, ChatLimitsDraft>>(() => ({
    ollamaLimits: limitsToDraft(status.settings.ollamaLimits),
    cloudLimits: limitsToDraft(status.settings.cloudLimits)
  }))
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (change: Partial<LlmSettings>): void => setDraft((d) => ({ ...d, ...change }))
  const pick = (m: string): string => status.models.find((x) => sameModel(x, m)) ?? m

  const provider = draft.provider
  const cloud = isCloudProvider(provider) ? provider : null
  const label = PROVIDER_LABELS[provider]
  const keyChange = cloud ? keys[cloud] : undefined
  // An empty string = no change (typed and then cleared)
  const hasKey = cloud
    ? keyChange === undefined || keyChange === ''
      ? status.apiKeys[cloud]
      : keyChange !== null
    : false
  const model = cloud ? (draft.cloudModels[cloud] ?? '') : draft.chatModel
  // The model list belongs to the saved provider
  const cloudModels = cloud && cloud === status.settings.provider ? status.cloudModels : []
  const needsConsent = !!cloud && cloud !== status.settings.provider
  const missingAddress = cloud === 'custom' && !draft.customBaseUrl.trim()

  const save = (e: React.FormEvent): void => {
    e.preventDefault()
    if (needsConsent && !consent) return
    setSaving(true)
    const keepOpen = !!cloud && !model && hasKey
    // Send only keys with content, and deletions
    const changes = Object.fromEntries(
      Object.entries(keys).filter(([, v]) => v === null || (typeof v === 'string' && v.trim()))
    ) as ApiKeyChanges
    const next: LlmSettings = {
      ...draft,
      ollamaLimits: draftToLimits(limits.ollamaLimits, draft.ollamaLimits),
      cloudLimits: draftToLimits(limits.cloudLimits, draft.cloudLimits)
    }
    onSave(next, changes, keepOpen)
      .then(() => setKeys({}))
      .finally(() => setSaving(false))
  }

  /** Context length and output limit; the browser blocks submitting out-of-range values (min/max) */
  const renderLimits = (key: LimitsKey): React.JSX.Element => {
    const d = limits[key]
    const edit = (change: Partial<ChatLimitsDraft>): void =>
      setLimits((l) => ({ ...l, [key]: { ...l[key], ...change } }))
    const [ctxMin, ctxMax] = CHAT_LIMITS.contextTokens
    const [outMin, outMax] = CHAT_LIMITS.maxOutputTokens
    // Ollama's output also uses context
    const context = Number(d.contextTokens)
    const outLimit =
      key === 'ollamaLimits' && Number.isFinite(context) && context >= outMin
        ? Math.min(outMax, context)
        : outMax
    return (
      <>
        <label className="field">
          <span className="field-label">Context length</span>
          <span className="field-input">
            <input
              type="number"
              required
              min={ctxMin}
              max={ctxMax}
              step={1}
              value={d.contextTokens}
              onChange={(e) => edit({ contextTokens: e.target.value })}
            />
            tokens
          </span>
          <span className="field-help">
            {LIMIT_HELP[key]} ({ctxMin}–{ctxMax}; default 8192)
          </span>
        </label>
        <label className="field">
          <span className="field-label">Max output</span>
          <span className="field-input">
            <input
              type="number"
              min={outMin}
              max={outLimit}
              step={1}
              placeholder="Model default"
              value={d.maxOutputTokens}
              onChange={(e) => edit({ maxOutputTokens: e.target.value })}
            />
            tokens
          </span>
          <span className="field-help">
            Longest reply the model may write; blank = the model&apos;s default. Replies that hit it
            end with a note.
            {key === 'cloudLimits' &&
              ' For reasoning models this includes thinking, so a small limit can leave the answer empty.'}{' '}
            ({outMin}–{outLimit})
          </span>
        </label>
      </>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={save}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>AI settings</h2>
        <p className="hint">
          {cloud
            ? `Summaries, chat and the agent use ${label}: note content is sent to ${label}. Embeddings stay on Ollama. Shared by all vaults.`
            : 'Knowmon uses a local Ollama server; notes never leave this computer. Shared by all vaults.'}
        </p>
        <label className="field wide">
          <span className="field-label">Chat provider</span>
          <span className="field-input">
            <select
              autoFocus
              value={provider}
              onChange={(e) => {
                set({ provider: e.target.value as ChatProvider })
                setConsent(false)
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_OPTIONS[p]}
                </option>
              ))}
            </select>
          </span>
        </label>

        {cloud === 'custom' && (
          <label className="field wide">
            <span className="field-label">API address</span>
            <span className="field-input">
              <input
                type="url"
                placeholder="https://openrouter.ai/api/v1"
                value={draft.customBaseUrl}
                onChange={(e) => set({ customBaseUrl: e.target.value })}
              />
            </span>
            <span className="field-help">
              The OpenAI-compatible base URL (ending before /chat/completions). Must be https, or
              http to this computer (localhost).
            </span>
          </label>
        )}

        {cloud && (
          <label className="field wide">
            <span className="field-label">API key</span>
            <span className="field-input">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status.apiKeys[cloud] && !keyChange ? 'Saved' : ''}
                value={typeof keyChange === 'string' ? keyChange : ''}
                onChange={(e) => setKeys((k) => ({ ...k, [cloud]: e.target.value }))}
              />
              {status.apiKeys[cloud] && keyChange !== null && (
                <button type="button" onClick={() => setKeys((k) => ({ ...k, [cloud]: null }))}>
                  Remove
                </button>
              )}
            </span>
            <span className="field-help">
              {keyChange === null
                ? 'The saved key will be removed when you save.'
                : status.apiKeys[cloud]
                  ? 'A key is saved. Type a new one to replace it.'
                  : 'Stored encrypted on this computer and only sent to this provider.'}
              {!status.keyEncrypted &&
                ' No system keyring is available, so the key is not strongly protected.'}
            </span>
          </label>
        )}

        {cloud && (
          <label className="field wide">
            <span className="field-label">Model</span>
            <span className="field-input">
              <input
                list="knowmon-cloud-models"
                spellCheck={false}
                value={model}
                onChange={(e) =>
                  set({ cloudModels: { ...draft.cloudModels, [cloud]: e.target.value } })
                }
              />
              <datalist id="knowmon-cloud-models">
                {cloudModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </span>
            <span className="field-help">
              {cloudModels.length > 0
                ? 'Pick from the list or type a model id. Used for summaries, chat and the agent (the agent needs tool calling).'
                : 'Type a model id, or save with the API key first to load the model list.'}
            </span>
          </label>
        )}

        {cloud && renderLimits('cloudLimits')}

        {needsConsent && (
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I understand that note content (notes being summarized, retrieved passages for
              questions, and agent tool results) will be sent to {label}, and that {label} may
              charge for usage.
            </span>
          </label>
        )}

        <h3>Ollama</h3>
        <p className="hint">
          {cloud
            ? 'Optional: used for embeddings (semantic search and Semantic links). Without it, search falls back to keywords.'
            : 'Used for summaries, chat, the agent and embeddings.'}
        </p>
        <label className="field wide">
          <span className="field-label">Ollama address</span>
          <span className="field-input">
            <input
              type="url"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </span>
        </label>
        {!cloud && (
          <label className="field wide">
            <span className="field-label">Chat model</span>
            <span className="field-input">
              <select
                value={pick(draft.chatModel)}
                onChange={(e) => set({ chatModel: e.target.value })}
              >
                {options(status.models, pick(draft.chatModel)).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </span>
            <span className="field-help">Used for summaries, chat and the agent.</span>
          </label>
        )}
        {!cloud && renderLimits('ollamaLimits')}
        <label className="field wide">
          <span className="field-label">Embedding model</span>
          <span className="field-input">
            <select
              value={pick(draft.embedModel)}
              onChange={(e) => set({ embedModel: e.target.value })}
            >
              {options(status.models, pick(draft.embedModel)).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </span>
          <span className="field-help">
            Used for semantic search and Semantic links. Changing it re-indexes every note.
          </span>
        </label>
        {!status.ollamaOnline && (
          <p className="field-help">Ollama is offline, so installed models cannot be listed.</p>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={saving || (needsConsent && !consent) || missingAddress}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
