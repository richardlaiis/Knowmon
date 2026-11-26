// One note tab: its own editor and the external-change notice. The file is read the first time the tab is shown, after which it stays mounted (hidden).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteSummary, VaultChange } from '../../../shared/types'
import { Editor, type Autosave } from '../../editor'

export interface NotePaneProps {
  path: string
  active: boolean
  preview: boolean
  autosave: Autosave
  /** While an in-app create/rename/delete is in progress, ignore the watcher's echo */
  isLocalOp: () => boolean
  getNotes: () => Promise<NoteSummary[]>
  onTogglePreview: () => void
  onOpenLink: (target: string, newTab: boolean) => void
  onError: (e: unknown) => void
  /** Summarizes this note (only the selection when there is one) */
  onSummarize: () => void
  onSelectionChange: (path: string, text: string) => void
  /** Scrolls to this line (search results); jumps again when n changes */
  reveal: { line: number; n: number } | null
}

interface Loaded {
  doc: string
  /** A new key on every load from disk, so the editor resets its content */
  key: number
}

export function NotePane(props: NotePaneProps): React.JSX.Element {
  const { path, active, preview, autosave, isLocalOp, onError } = props
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [externalChange, setExternalChange] = useState(false)
  // The editor's current content (not in state, to avoid re-rendering on every keystroke)
  const currentDoc = useRef('')
  // On rename the path changes, but the tab and editor aren't rebuilt
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

  // Read the file the first time this tab is shown
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

  // External change to this note: reload if there's no unsaved content, otherwise show the notice bar
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
          onClick={props.onSummarize}
          title="Summarize this note, or the selected text (Ctrl+Shift+S)"
        >
          Summarize
        </button>
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
          path={path}
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
          onSelectionChange={(text) => props.onSelectionChange(pathRef.current, text)}
          reveal={props.reveal}
          saveAttachment={window.api.notes.saveAttachment}
          onError={onError}
        />
      )}
    </div>
  )
}
