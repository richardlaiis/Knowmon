import { useState } from 'react'
import { SEMANTIC_LIMITS } from '../../../shared/llm'
import { TIME_LIMITS } from '../../../shared/time'
import type { SemanticSettings, TimeSettings } from '../../../shared/types'

export interface TimeSettingsDialogProps {
  value: TimeSettings
  semantic: SemanticSettings
  /** 回傳的 Promise 完成後關閉；失敗時由呼叫者顯示錯誤 */
  onSave: (time: TimeSettings, semantic: SemanticSettings) => Promise<void>
  onClose: () => void
}

type Key = keyof TimeSettings | keyof SemanticSettings

interface Field {
  key: Key
  label: string
  unit: string
  help: string
  step: number
  limits: [number, number]
}

const TIME_FIELDS: Field[] = [
  {
    key: 'sessionGapMinutes',
    label: 'Session gap',
    unit: 'minutes',
    help: 'A pause longer than this starts a new work session.',
    step: 1,
    limits: TIME_LIMITS.sessionGapMinutes
  },
  {
    key: 'sessionMaxNotes',
    label: 'Max notes per session',
    unit: 'notes',
    help: 'Sessions touching more notes are treated as bulk changes (sync, find & replace) and get no Session edges.',
    step: 1,
    limits: TIME_LIMITS.sessionMaxNotes
  },
  {
    key: 'sameDayWindowDays',
    label: 'Same-day window',
    unit: 'days',
    help: 'Notes whose event dates are at most this many days apart get a Same day edge. 0 = the same day only.',
    step: 1,
    limits: TIME_LIMITS.sameDayWindowDays
  }
]

const SEMANTIC_FIELDS: Field[] = [
  {
    key: 'semanticThreshold',
    label: 'Similarity threshold',
    unit: '',
    help: 'Notes at least this similar (0–1, by local embeddings) get a Semantic edge. Higher = fewer edges.',
    step: 0.01,
    limits: SEMANTIC_LIMITS.semanticThreshold
  },
  {
    key: 'semanticMaxPerNote',
    label: 'Max per note',
    unit: 'notes',
    help: 'Each note links to at most this many of its most similar notes.',
    step: 1,
    limits: SEMANTIC_LIMITS.semanticMaxPerNote
  }
]

/** 時間參數（session 長度等）與 semantic 邊參數，存在 vault 的 .knowmon/settings.json */
export function TimeSettingsDialog({
  value,
  semantic,
  onSave,
  onClose
}: TimeSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<Record<Key, string>>(() => {
    const all = { ...value, ...semantic }
    return Object.fromEntries(
      [...TIME_FIELDS, ...SEMANTIC_FIELDS].map((f) => [f.key, String(all[f.key])])
    ) as Record<Key, string>
  })
  const [saving, setSaving] = useState(false)

  const read = <T extends object>(base: T, fields: Field[]): T => {
    const next = { ...base } as Record<string, number>
    for (const f of fields) {
      const n = Number(draft[f.key])
      if (draft[f.key].trim() !== '' && Number.isFinite(n)) next[f.key] = n
    }
    return next as T
  }

  const save = (e: React.FormEvent): void => {
    e.preventDefault()
    setSaving(true)
    onSave(read(value, TIME_FIELDS), read(semantic, SEMANTIC_FIELDS)).finally(() =>
      setSaving(false)
    )
  }

  const renderField = (f: Field, autoFocus: boolean): React.JSX.Element => {
    const [min, max] = f.limits
    return (
      <label key={f.key} className="field">
        <span className="field-label">{f.label}</span>
        <span className="field-input">
          <input
            type="number"
            autoFocus={autoFocus}
            min={min}
            max={max}
            step={f.step}
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
          />
          {f.unit}
        </span>
        <span className="field-help">
          {f.help} ({min}–{max})
        </span>
      </label>
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
        <h2>Time &amp; link settings</h2>
        <p className="hint">Saved in this vault (.knowmon/settings.json).</p>
        {TIME_FIELDS.map((f, i) => renderField(f, i === 0))}
        <h3>Semantic links</h3>
        {SEMANTIC_FIELDS.map((f) => renderField(f, false))}
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
