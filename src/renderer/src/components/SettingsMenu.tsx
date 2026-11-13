// 左下角的設定按鈕：齒輪 → 小選單，打開「時間與連結」或「AI」設定對話框
import { useEffect, useRef, useState } from 'react'
import { SettingsIcon } from './icons'

export interface SettingsMenuProps {
  onTimeSettings: () => void
  onAiSettings: () => void
  /** AI 狀態還沒載入時不能打開 AI 設定（對話框需要目前的設定值） */
  aiDisabled: boolean
}

export function SettingsMenu(props: SettingsMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // 點選單外、Esc、視窗失焦時關閉
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const close = (): void => setOpen(false)
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const choose = (action: () => void) => (): void => {
    setOpen(false)
    action()
  }

  return (
    <div className="settings-menu-root" ref={root}>
      <button
        className={`icon settings-button${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SettingsIcon />
      </button>
      {open && (
        <div className="context-menu settings-menu" role="menu">
          <button role="menuitem" onClick={choose(props.onTimeSettings)}>
            Time &amp; links…
          </button>
          <button
            role="menuitem"
            onClick={choose(props.onAiSettings)}
            disabled={props.aiDisabled}
            title={props.aiDisabled ? 'Checking AI status…' : 'Ollama address and models'}
          >
            AI (Ollama)…
          </button>
        </div>
      )}
    </div>
  )
}
