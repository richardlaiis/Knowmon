import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteSummary } from '../../../shared/types'
import { rankNotes } from '../lib/fuzzy'

export interface QuickSwitcherProps {
  notes: NoteSummary[]
  /** Recently opened paths, most recent first */
  recent: string[]
  /** newTab: Ctrl/Cmd+Enter, Ctrl/Cmd+click, or opened in "new tab" mode (Ctrl/Cmd+T) */
  onOpen: (path: string, newTab: boolean) => void
  onClose: () => void
  /** When true, the chosen note always opens in a new tab */
  newTab?: boolean
}

/** Ctrl/Cmd+O: fuzzy-search note names and open one */
export function QuickSwitcher({
  notes,
  recent,
  onOpen,
  onClose,
  newTab = false
}: QuickSwitcherProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => rankNotes(notes, query, recent), [notes, query, recent])

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (i: number, forceNewTab = false): void => {
    const hit = results[i]
    if (hit) onOpen(hit.path, newTab || forceNewTab)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="switcher-input"
          placeholder={newTab ? 'Open a note in a new tab…' : 'Find a note…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(active, e.ctrlKey || e.metaKey)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <ul className="switcher-list" ref={list}>
          {results.map((n, i) => (
            <li
              key={n.path}
              className={i === active ? 'active' : ''}
              onMouseMove={() => setActive(i)}
              onClick={(e) => choose(i, e.ctrlKey || e.metaKey)}
            >
              <span className="result-title">{n.title}</span>
              {n.path.includes('/') && (
                <span className="result-folder">{n.path.slice(0, n.path.lastIndexOf('/'))}</span>
              )}
            </li>
          ))}
          {results.length === 0 && <li className="empty-row">No matching notes</li>}
        </ul>
      </div>
    </div>
  )
}
