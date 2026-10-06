import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode, VaultChange } from '../../shared/types'
import { Editor, createAutosave } from '../editor'
import { FileTree } from './components/FileTree'
import {
  errorMessage,
  isWithin,
  movedInto,
  remapPath,
  renamedPath,
  uniqueFolderPath,
  uniqueNotePath
} from './lib/tree'
import { applyTheme, browserStore, otherTheme, saveTheme, type Theme } from './lib/theme'

interface OpenNote {
  path: string
  doc: string
  /** 每次從磁碟載入都換一個 key，讓編輯器重設內容 */
  key: string
}

let loadCounter = 0

const PREVIEW_KEY = 'knowmon.livePreview'

function loadPreviewSetting(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== 'false'
  } catch {
    return true
  }
}

function App(): React.JSX.Element {
  const [vault, setVault] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [note, setNote] = useState<OpenNote | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [externalChange, setExternalChange] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(loadPreviewSetting)
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = otherTheme(current)
      applyTheme(document.documentElement, next)
      saveTheme(browserStore(), next)
      return next
    })
  }, [])

  const togglePreview = useCallback(() => {
    setPreview((on) => {
      try {
        localStorage.setItem(PREVIEW_KEY, String(!on))
      } catch {
        // 無法儲存偏好時仍可切換
      }
      return !on
    })
  }, [])

  // Ctrl/Cmd+E 切換即時渲染與原始碼模式（同 Obsidian）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        togglePreview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePreview])

  // 編輯器目前的內容（不放 state，避免每次打字都 re-render）
  const currentDoc = useRef('')
  const notePath = useRef<string | null>(null)
  // App 自己發起的新增/改名/刪除進行中，忽略 watcher 對開著的筆記的通知
  const localOps = useRef(0)

  const showError = useCallback((e: unknown) => setMessage(errorMessage(e)), [])
  const autosave = useMemo(
    () => createAutosave((p, c) => window.api.notes.write(p, c), 500, showError),
    [showError]
  )

  const refreshTree = useCallback(async () => {
    try {
      setTree(await window.api.vault.tree())
    } catch (e) {
      showError(e)
    }
  }, [showError])

  const load = useCallback(async (path: string) => {
    const doc = await window.api.notes.read(path)
    currentDoc.current = doc
    notePath.current = path
    setExternalChange(false)
    setNote({ path, doc, key: `${path}#${++loadCounter}` })
  }, [])

  const close = useCallback(() => {
    notePath.current = null
    setExternalChange(false)
    setNote(null)
  }, [])

  // 啟動：還原上次的 vault
  useEffect(() => {
    window.api.vault
      .getCurrent()
      .then(async (root) => {
        setVault(root)
        if (root) setTree(await window.api.vault.tree())
      })
      .catch(showError)
      .finally(() => setReady(true))
  }, [showError])

  // 外部修改
  useEffect(() => {
    if (!vault) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.vault.onChange(async (c: VaultChange) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refreshTree(), 100)

      const open = notePath.current
      if (!open || localOps.current > 0) return
      if (c.type === 'unlink' && isWithin(open, c.path)) {
        autosave.cancel()
        close()
        setMessage(`"${open}" was deleted or moved outside the app`)
      } else if (c.type === 'change' && c.path === open) {
        if (autosave.isDirty(open)) {
          setExternalChange(true)
          return
        }
        const disk = await window.api.notes.read(open).catch(() => null)
        if (disk !== null && disk !== currentDoc.current && notePath.current === open) {
          await load(open)
        }
      }
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [vault, refreshTree, autosave, close, load])

  // 關閉視窗前寫出未儲存的內容
  useEffect(() => {
    const onUnload = (): void => void autosave.flush()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [autosave])

  const runLocal = async (fn: () => Promise<void>): Promise<void> => {
    localOps.current++
    try {
      await autosave.flush()
      await fn()
    } catch (e) {
      showError(e)
    } finally {
      // 讓 watcher 對這次操作的回音先過去
      setTimeout(() => localOps.current--, 500)
      await refreshTree()
    }
  }

  const pickVault = async (): Promise<void> => {
    try {
      await autosave.flush()
      const root = await window.api.vault.pick()
      if (!root) return
      close()
      setVault(root)
      await refreshTree()
    } catch (e) {
      showError(e)
    }
  }

  const openNote = async (path: string): Promise<void> => {
    if (path === notePath.current) return
    try {
      await autosave.flush()
      await load(path)
    } catch (e) {
      showError(e)
    }
  }

  const createNote = (folder: string): Promise<void> =>
    runLocal(async () => {
      if (!tree) return
      const path = uniqueNotePath(tree, folder)
      await window.api.notes.create(path)
      await load(path)
      setRenaming(path)
    })

  const createFolder = (parent: string): Promise<void> =>
    runLocal(async () => {
      if (!tree) return
      const path = uniqueFolderPath(tree, parent)
      await window.api.notes.createFolder(path)
      setRenaming(path)
    })

  /** 改名或搬移後，若開著的筆記受影響就跟著更新路徑 */
  const followMove = (from: string, to: string): void => {
    const open = notePath.current
    if (!open || !isWithin(open, from)) return
    const moved = remapPath(open, from, to)
    notePath.current = moved
    setNote((n) => (n ? { ...n, path: moved } : n))
  }

  const renameNode = (node: TreeNode, newName: string): Promise<void> =>
    runLocal(async () => {
      setRenaming(null)
      const to = renamedPath(node, newName)
      if (to === node.path) return
      await window.api.notes.rename(node.path, to)
      followMove(node.path, to)
    })

  const moveNode = (from: string, folder: string): Promise<void> =>
    runLocal(async () => {
      const to = movedInto(from, folder)
      if (!to) return
      await window.api.notes.rename(from, to)
      followMove(from, to)
    })

  const removeNode = (node: TreeNode): Promise<void> => {
    const what =
      node.kind === 'folder' ? `the folder "${node.name}" and all notes in it` : `"${node.name}"`
    if (!window.confirm(`Move ${what} to the trash?`)) return Promise.resolve()
    return runLocal(async () => {
      await window.api.notes.remove(node.path)
      if (notePath.current && isWithin(notePath.current, node.path)) close()
    })
  }

  if (!ready) return <div className="empty" />

  if (!vault) {
    return (
      <div className="empty">
        <div className="corner">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <h1>Knowmon</h1>
        <p>Choose a folder as your vault. Notes are stored in it as Markdown files.</p>
        <button className="primary" onClick={pickVault}>
          Open folder
        </button>
        {message && <p className="error">{message}</p>}
      </div>
    )
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <button
            className="vault-name"
            onClick={pickVault}
            title={`${vault}\nClick to switch vault`}
          >
            {tree?.name ?? vault}
          </button>
          <button className="icon" onClick={() => createNote('')} title="New note">
            <NewNoteIcon />
          </button>
          <button className="icon" onClick={() => createFolder('')} title="New folder">
            <NewFolderIcon />
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        {tree && (
          <FileTree
            root={tree}
            selected={note?.path ?? null}
            renaming={renaming}
            onOpen={openNote}
            onCreate={createNote}
            onCreateFolder={createFolder}
            onStartRename={setRenaming}
            onRename={renameNode}
            onMove={moveNode}
            onRemove={removeNode}
          />
        )}
      </aside>
      <main className="main">
        {message && (
          <div className="banner error" onClick={() => setMessage(null)}>
            {message} (click to dismiss)
          </div>
        )}
        {externalChange && note && (
          <div className="banner">
            This note was changed outside the app.
            <button
              onClick={() => {
                autosave.cancel()
                load(note.path).catch(showError)
              }}
            >
              Load external version
            </button>
            <button
              onClick={() => {
                setExternalChange(false)
                autosave.schedule(note.path, currentDoc.current)
                void autosave.flush()
              }}
            >
              Keep my version
            </button>
          </div>
        )}
        {note ? (
          <>
            <div className="note-title">
              <span className="note-path">{note.path.replace(/\.md$/i, '')}</span>
              <button
                className="mode-toggle"
                onClick={togglePreview}
                title="Toggle live preview / source mode (Ctrl+E)"
              >
                {preview ? 'Live preview' : 'Source'}
              </button>
            </div>
            <Editor
              docKey={note.key}
              doc={note.doc}
              onChange={(doc) => {
                currentDoc.current = doc
                if (notePath.current) autosave.schedule(notePath.current, doc)
              }}
              onSave={() => void autosave.flush()}
              livePreview={preview}
            />
          </>
        ) : (
          <div className="empty">
            <p>Select a note on the left, or right-click to create one.</p>
          </div>
        )}
      </main>
    </div>
  )
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

function NewNoteIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </svg>
  )
}

function NewFolderIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10v6M9 13h6" />
    </svg>
  )
}

function ThemeToggle({
  theme,
  onToggle
}: {
  theme: Theme
  onToggle: () => void
}): React.JSX.Element {
  const dark = theme === 'dark'
  return (
    <button
      className="icon"
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  )
}

function SunIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export default App
