import { useEffect, useState } from 'react'
import type { Backlink } from '../../../shared/types'
import { groupBacklinks } from '../lib/backlinks'
import { errorMessage } from '../lib/tree'
import { Segments } from './Segments'

export interface BacklinksPanelProps {
  path: string
  /** 索引有變動時遞增，重新查詢 */
  version: number
  onOpen: (path: string) => void
}

export function BacklinksPanel({ path, version, onOpen }: BacklinksPanelProps): React.JSX.Element {
  const [links, setLinks] = useState<Backlink[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    window.api.links
      .backlinks(path)
      .then((l) => {
        if (stale) return
        setLinks(l)
        setError(null)
      })
      .catch((e) => !stale && setError(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [path, version])

  const groups = links ? groupBacklinks(links) : []
  return (
    <aside className="backlinks">
      <header className="panel-header">
        Backlinks{links && links.length > 0 && <span className="count">{groups.length}</span>}
      </header>
      {error && <p className="panel-note error">{error}</p>}
      {links && links.length === 0 && <p className="panel-note">No notes link here yet.</p>}
      <ul className="result-list">
        {groups.map((g) => (
          <li key={g.path}>
            <button className="result" onClick={() => onOpen(g.path)} title={g.path}>
              <span className="result-title">{g.title}</span>
              {g.path.includes('/') && (
                <span className="result-folder">{g.path.slice(0, g.path.lastIndexOf('/'))}</span>
              )}
              {g.items.map((item) => (
                <span key={item.line} className="result-snippet">
                  <Segments segments={item.context} />
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
