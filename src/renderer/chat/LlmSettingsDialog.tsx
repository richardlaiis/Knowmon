import { useState } from 'react'
import { sameModel } from '../../shared/llm'
import type { LlmSettings, LlmStatus } from '../../shared/types'

export interface LlmSettingsDialogProps {
  status: LlmStatus
  /** 回傳的 Promise 完成後關閉；失敗時由呼叫者顯示錯誤 */
  onSave: (next: LlmSettings) => Promise<void>
  onClose: () => void
}

/** 已下載的模型加上目前設定的模型（可能尚未下載） */
function options(models: string[], current: string): string[] {
  return models.some((m) => sameModel(m, current)) ? models : [current, ...models]
}

/** Ollama 位址與模型，存在 App 的設定（所有 vault 共用） */
export function LlmSettingsDialog({
  status,
  onSave,
  onClose
}: LlmSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<LlmSettings>(status.settings)
  const [saving, setSaving] = useState(false)
  const set = (change: Partial<LlmSettings>): void => setDraft((d) => ({ ...d, ...change }))
  const pick = (m: string): string => status.models.find((x) => sameModel(x, m)) ?? m

  const save = (e: React.FormEvent): void => {
    e.preventDefault()
    setSaving(true)
    onSave(draft).finally(() => setSaving(false))
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
          Knowmon uses a local Ollama server; notes never leave this computer. Shared by all vaults.
        </p>
        <label className="field wide">
          <span className="field-label">Ollama address</span>
          <span className="field-input">
            <input
              type="url"
              autoFocus
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </span>
        </label>
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
          <span className="field-help">Used for summaries.</span>
        </label>
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
        {!status.online && (
          <p className="field-help">Ollama is offline, so installed models cannot be listed.</p>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
