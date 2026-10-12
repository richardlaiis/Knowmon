import { useEffect, useRef, useState } from 'react'
import type { RetrieveResult, SearchHit, TextSegment } from '../../../shared/types'
import { errorMessage } from '../lib/tree'
import { wantsNewTab } from '../workspace/tabs'
import { Segments } from './Segments'

const DEBOUNCE_MS = 200
const MODE_KEY = 'knowmon.search.mode'

type Mode = 'keyword' | 'hybrid'

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'hybrid' ? 'hybrid' : 'keyword'
  } catch {
    return 'keyword'
  }
}

export interface SearchPanelProps {
  /** 改變時把焦點移到搜尋框（Ctrl/Cmd+Shift+F） */
  focusKey: number
  /** 索引有變動時遞增，重新查詢 */
  version: number
  selected: string | null
  /** newTab：Ctrl/Cmd+點擊或中鍵；line：混合檢索命中的段落 */
  onOpen: (path: string, newTab: boolean, line?: number) => void
}

interface Row {
  path: string
  title: string
  snippet: TextSegment[]
  line?: number
  via?: string[]
}

const VIA_LABEL: Record<string, string> = { fulltext: 'text', vector: 'meaning', graph: 'linked' }

export function SearchPanel({
  focusKey,
  version,
  selected,
  onOpen
}: SearchPanelProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(loadMode)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[] | null>(null)
  /** key：查詢與日期篩選，改變後按 Enter 才重新查詢 */
  const [hybrid, setHybrid] = useState<{ key: string; result: RetrieveResult } | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef(0)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  // 關鍵字模式：邊打邊查
  useEffect(() => {
    if (mode !== 'keyword' || !query.trim()) return
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
  }, [query, version, mode])

  // 混合模式：需要呼叫 Ollama，按 Enter 才查
  const hybridKey = `${query.trim()}|${from}|${to}`
  const runHybrid = (): void => {
    const q = query.trim()
    const key = hybridKey
    if (!q) return
    const n = ++request.current
    setLoading(true)
    window.api.llm
      .retrieve(q, { ...(from ? { from } : {}), ...(to ? { to } : {}) })
      .then((result) => {
        if (n !== request.current) return
        setHybrid({ key, result })
        setError(null)
      })
      .catch((e) => n === request.current && setError(errorMessage(e)))
      .finally(() => n === request.current && setLoading(false))
  }

  const chooseMode = (m: Mode): void => {
    setMode(m)
    setError(null)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // 無法儲存偏好時仍可切換
    }
    input.current?.focus()
  }

  const rows: Row[] | null = !query.trim()
    ? null
    : mode === 'keyword'
      ? results
      : (hybrid?.result.hits ?? null)

  return (
    <div className="search-panel">
      <input
        ref={input}
        className="search-input"
        type="search"
        placeholder={mode === 'keyword' ? 'Search notes…' : 'Search by meaning… (Enter)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && mode === 'hybrid' && hybrid?.key !== hybridKey) {
            runHybrid()
          } else if (e.key === 'Enter' && rows?.length) {
            onOpen(rows[0].path, e.ctrlKey || e.metaKey, rows[0].line)
          }
          if (e.key === 'Escape') setQuery('')
        }}
      />
      <div className="search-options">
        <div className="segmented" role="group" aria-label="Search mode">
          <button
            className={mode === 'keyword' ? 'on' : ''}
            aria-pressed={mode === 'keyword'}
            onClick={() => chooseMode('keyword')}
            title="Full-text search as you type"
          >
            Keyword
          </button>
          <button
            className={mode === 'hybrid' ? 'on' : ''}
            aria-pressed={mode === 'hybrid'}
            onClick={() => chooseMode('hybrid')}
            title="Full text + meaning (local embeddings) + linked notes"
          >
            Hybrid
          </button>
        </div>
        {mode === 'hybrid' && (
          <div className="date-range" title="Filter by event date (or last modified)">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>–</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}
      </div>
      {error && <p className="panel-note error">{error}</p>}
      {mode === 'hybrid' && loading && <p className="panel-note">Searching…</p>}
      {mode === 'hybrid' && hybrid && !hybrid.result.vector && query.trim() && (
        <p className="panel-note">
          Semantic search is unavailable right now; showing keyword matches.
        </p>
      )}
      {rows && rows.length === 0 && <p className="panel-note">No matches</p>}
      {rows && rows.length > 0 && (
        <ul className="result-list">
          {rows.map((h) => (
            <li key={h.path}>
              <button
                className={`result${h.path === selected ? ' selected' : ''}`}
                onClick={(e) => onOpen(h.path, wantsNewTab(e), h.line)}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => e.button === 1 && onOpen(h.path, true, h.line)}
                title={h.line ? `${h.path}:${h.line}` : h.path}
              >
                <span className="result-title">
                  <span className="result-name">{h.title}</span>
                  {h.via?.map((v) => (
                    <span key={v} className={`via via-${v}`}>
                      {VIA_LABEL[v] ?? v}
                    </span>
                  ))}
                </span>
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
