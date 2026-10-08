import { useState } from 'react'
import { TIME_LIMITS } from '../../../shared/time'
import type { TimeSettings } from '../../../shared/types'

export interface TimeSettingsDialogProps {
  value: TimeSettings
  /** 回傳的 Promise 完成後關閉；失敗時由呼叫者顯示錯誤 */
  onSave: (next: TimeSettings) => Promise<void>
  onClose: () => void
}

const FIELDS: { key: keyof TimeSettings; label: string; unit: string; help: string }[] = [
  {
    key: 'sessionGapMinutes',
    label: 'Session gap',
    unit: 'minutes',
    help: 'A pause longer than this starts a new work session.'
  },
  {
    key: 'sessionMaxNotes',
    label: 'Max notes per session',
    unit: 'notes',
    help: 'Sessions touching more notes are treated as bulk changes (sync, find & replace) and get no Session edges.'
  },
  {
    key: 'sameDayWindowDays',
    label: 'Same-day window',
    unit: 'days',
    help: 'Notes whose event dates are at most this many days apart get a Same day edge. 0 = the same day only.'
  }
]

/** 時間參數（session 長度等），存在 vault 的 .knowmon/settings.json */
export function TimeSettingsDialog({
  value,
  onSave,
  onClose
}: TimeSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<Record<keyof TimeSettings, string>>(() => ({
    sessionGapMinutes: String(value.sessionGapMinutes),
    sessionMaxNotes: String(value.sessionMaxNotes),
    sameDayWindowDays: String(value.sameDayWindowDays)
  }))
  const [saving, setSaving] = useState(false)

  const save = (e: React.FormEvent): void => {
    e.preventDefault()
    const next = { ...value }
    for (const f of FIELDS) {
      const n = Number(draft[f.key])
      if (draft[f.key].trim() !== '' && Number.isFinite(n)) next[f.key] = n
    }
    setSaving(true)
    onSave(next).finally(() => setSaving(false))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={save}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Time settings</h2>
        <p className="hint">Saved in this vault (.knowmon/settings.json).</p>
        {FIELDS.map((f, i) => {
          const [min, max] = TIME_LIMITS[f.key]
          return (
            <label key={f.key} className="field">
              <span className="field-label">{f.label}</span>
              <span className="field-input">
                <input
                  type="number"
                  autoFocus={i === 0}
                  min={min}
                  max={max}
                  step={1}
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
        })}
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
