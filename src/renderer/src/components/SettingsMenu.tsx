// The settings button at the bottom left: gear → small menu opening the "Time & links" or "AI" settings dialog
import { useEffect, useRef, useState } from 'react'
import { SettingsIcon } from './icons'

export interface SettingsMenuProps {
  onTimeSettings: () => void
  onAiSettings: () => void
  /** AI settings can't open until the AI status has loaded (the dialog needs the current settings) */
  aiDisabled: boolean
}

export function SettingsMenu(props: SettingsMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close on a click outside the menu, Esc, or the window losing focus
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
            title={
              props.aiDisabled ? 'Checking AI status…' : 'Chat provider, Ollama address and models'
            }
          >
            AI…
          </button>
        </div>
      )}
    </div>
  )
}
