// 一個筆記分頁：自己的編輯器、外部修改提示。第一次切到這個分頁時才讀檔，之後保持掛載（隱藏）。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteSummary, VaultChange } from '../../../shared/types'
import { Editor, type Autosave } from '../../editor'

export interface NotePaneProps {
  path: string
  active: boolean
  preview: boolean
  autosave: Autosave
  /** App 內的新增/改名/刪除進行中，忽略 watcher 的回音 */
  isLocalOp: () => boolean
  getNotes: () => Promise<NoteSummary[]>
  onTogglePreview: () => void
  onOpenLink: (target: string, newTab: boolean) => void
  onError: (e: unknown) => void
}

interface Loaded {
  doc: string
  /** 每次從磁碟載入都換一個 key，讓編輯器重設內容 */
  key: number
}

export function NotePane(props: NotePaneProps): React.JSX.Element {
  const { path, active, preview, autosave, isLocalOp, onError } = props
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [externalChange, setExternalChange] = useState(false)
  // 編輯器目前的內容（不放 state，避免每次打字都 re-render）
  const currentDoc = useRef('')
  // 改名時 path 會變，但分頁與編輯器不重建
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  })

  const apply = useCallback((doc: string): void => {
    currentDoc.current = doc
    setExternalChange(false)
    setLoaded((prev) => ({ doc, key: (prev?.key ?? 0) + 1 }))
  }, [])

  const load = useCallback(
    async (): Promise<void> => apply(await window.api.notes.read(pathRef.current)),
    [apply]
  )

  // 第一次切到這個分頁時讀檔
  const wanted = active && !loaded
  useEffect(() => {
    if (!wanted) return
    let stale = false
    window.api.notes
      .read(pathRef.current)
      .then((doc) => !stale && apply(doc))
      .catch(onError)
    return () => {
      stale = true
    }
  }, [wanted, apply, onError])

  // 外部修改這篇筆記：沒有未儲存內容就重新載入，否則顯示提示列
  const isLoaded = loaded !== null
  useEffect(() => {
    if (!isLoaded) return
    return window.api.vault.onChange(async (c: VaultChange) => {
      const p = pathRef.current
      if (c.type !== 'change' || c.path !== p || isLocalOp()) return
      if (autosave.isDirty(p)) {
        setExternalChange(true)
        return
      }
      const disk = await window.api.notes.read(p).catch(() => null)
      if (disk !== null && disk !== currentDoc.current && pathRef.current === p) await load()
    })
  }, [isLoaded, autosave, isLocalOp, load])

  return (
    <div className="note-pane" style={active ? undefined : { display: 'none' }}>
      {externalChange && (
        <div className="banner">
          This note was changed outside the app.
          <button
            onClick={() => {
              autosave.cancel()
              load().catch(onError)
            }}
          >
            Load external version
          </button>
          <button
            onClick={() => {
              setExternalChange(false)
              autosave.schedule(pathRef.current, currentDoc.current)
              void autosave.flush()
            }}
          >
            Keep my version
          </button>
        </div>
      )}
      <div className="note-title">
        <span className="note-path">{path.replace(/\.md$/i, '')}</span>
        <button
          className="mode-toggle"
          onClick={props.onTogglePreview}
          title="Toggle live preview / source mode (Ctrl+E)"
        >
          {preview ? 'Live preview' : 'Source'}
        </button>
      </div>
      {loaded && (
        <Editor
          docKey={String(loaded.key)}
          doc={loaded.doc}
          active={active}
          onChange={(doc) => {
            currentDoc.current = doc
            autosave.schedule(pathRef.current, doc)
          }}
          onSave={() => void autosave.flush()}
          livePreview={preview}
          getNotes={props.getNotes}
          onOpenLink={props.onOpenLink}
        />
      )}
    </div>
  )
}
