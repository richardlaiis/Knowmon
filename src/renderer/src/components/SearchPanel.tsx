import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../../../shared/types'
import { errorMessage } from '../lib/tree'
import { Segments } from './Segments'

const DEBOUNCE_MS = 200

export interface SearchPanelProps {
  /** 改變時把焦點移到搜尋框（Ctrl/Cmd+Shift+F） */
  focusKey: number
  /** 索引有變動時遞增，重新查詢 */
  version: number
  selected: string | null
  onOpen: (path: string) => void
}

export function SearchPanel({
  focusKey,
  version,
  selected,
  onOpen
}: SearchPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  useEffect(() => {
    if (!query.trim()) return
    let stale = false
    const timer = setTimeout(() => {
      window.api.search
        .query(query)
        .then((h) => {
          if (stale) return
          setResults(h)
          setError(null)
        })
        .catch((e) => !stale && setError(errorMessage(e)))
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, version])

  const hits = query.trim() ? results : null

  return (
    <div className="search-panel">
      <input
        ref={input}
        className="search-input"
        type="search"
        placeholder="Search notes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits?.length) onOpen(hits[0].path)
          if (e.key === 'Escape') setQuery('')
        }}
      />
      {error && <p className="panel-note error">{error}</p>}
      {hits && hits.length === 0 && <p className="panel-note">No matches</p>}
      {hits && hits.length > 0 && (
        <ul className="result-list">
          {hits.map((h) => (
            <li key={h.path}>
              <button
                className={`result${h.path === selected ? ' selected' : ''}`}
                onClick={() => onOpen(h.path)}
                title={h.path}
              >
                <span className="result-title">{h.title}</span>
                {h.path.includes('/') && (
                  <span className="result-folder">{h.path.slice(0, h.path.lastIndexOf('/'))}</span>
                )}
                <span className="result-snippet">
                  <Segments segments={h.snippet} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
