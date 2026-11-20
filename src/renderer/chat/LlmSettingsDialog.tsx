import { useState } from 'react'
import { CLOUD_PROVIDERS, PROVIDER_LABELS, isCloudProvider, sameModel } from '../../shared/llm'
import type { ChatProvider, CloudProvider, LlmSettings, LlmStatus } from '../../shared/types'

/** 要儲存的 API key 變更：字串 = 新的 key，null = 刪除 */
export type ApiKeyChanges = Partial<Record<CloudProvider, string | null>>

export interface LlmSettingsDialogProps {
  status: LlmStatus
  /**
   * 回傳的 Promise 完成後，keepOpen 為 false 時由呼叫者關閉；失敗時由呼叫者顯示錯誤。
   * keepOpen：剛輸入雲端服務的 key、還沒選模型，存檔後留在對話框裡從模型清單挑選
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

/** 已下載的模型加上目前設定的模型（可能尚未下載） */
function options(models: string[], current: string): string[] {
  return models.some((m) => sameModel(m, current)) ? models : [current, ...models]
}

/** 對話服務、Ollama 位址與模型，存在 App 的設定（所有 vault 共用） */
export function LlmSettingsDialog({
  status,
  onSave,
  onClose
}: LlmSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<LlmSettings>(status.settings)
  const [keys, setKeys] = useState<ApiKeyChanges>({})
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (change: Partial<LlmSettings>): void => setDraft((d) => ({ ...d, ...change }))
  const pick = (m: string): string => status.models.find((x) => sameModel(x, m)) ?? m

  const provider = draft.provider
  const cloud = isCloudProvider(provider) ? provider : null
  const label = PROVIDER_LABELS[provider]
  const keyChange = cloud ? keys[cloud] : undefined
  // 空字串 = 沒有變更（輸入後又清掉）
  const hasKey = cloud
    ? keyChange === undefined || keyChange === ''
      ? status.apiKeys[cloud]
      : keyChange !== null
    : false
  const model = cloud ? (draft.cloudModels[cloud] ?? '') : draft.chatModel
  // 模型清單屬於已儲存的服務
  const cloudModels = cloud && cloud === status.settings.provider ? status.cloudModels : []
  const needsConsent = !!cloud && cloud !== status.settings.provider
  const missingAddress = cloud === 'custom' && !draft.customBaseUrl.trim()

  const save = (e: React.FormEvent): void => {
    e.preventDefault()
    if (needsConsent && !consent) return
    setSaving(true)
    const keepOpen = !!cloud && !model && hasKey
    // 只送出有內容的 key 與刪除
    const changes = Object.fromEntries(
      Object.entries(keys).filter(([, v]) => v === null || (typeof v === 'string' && v.trim()))
    ) as ApiKeyChanges
    onSave(draft, changes, keepOpen)
      .then(() => setKeys({}))
      .finally(() => setSaving(false))
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
