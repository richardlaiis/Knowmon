import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName, movedInto, parentOf, type NewItem } from '../lib/tree'
import { wantsNewTab } from '../workspace/tabs'

/** 檔案樹內部拖曳用的 MIME type，和外部拖進來的檔案區分 */
const DRAG_TYPE = 'application/x-knowmon-path'
/** 拖曳時停在收合的資料夾上多久會自動展開 */
const EXPAND_DELAY_MS = 600

export interface FileTreeProps {
  root: TreeNode
  selected: string | null
  /** 正在改名的節點路徑 */
  renaming: string | null
  /** 正在輸入名稱的新項目；送出名稱後才建立 */
  creating: NewItem | null
  /** newTab：Ctrl/Cmd+點擊或中鍵 */
  onOpen: (path: string, newTab: boolean) => void
  /** 顯示新項目的名稱輸入框；null 為取消 */
  onStartCreate: (item: NewItem | null) => void
  onCreate: (item: NewItem, name: string) => void
  onStartRename: (path: string | null) => void
  onRename: (node: TreeNode, newName: string) => void
  onRemove: (node: TreeNode) => void
  /** 把 from 移進 folder（'' 為 vault 根目錄） */
  onMove: (from: string, folder: string) => void
}

interface Menu {
  x: number
  y: number
  node: TreeNode
}

export function FileTree(props: FileTreeProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<Menu | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // 拖曳中的路徑，以及目前會放進去的資料夾（'' 為根目錄）
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [hoverFolder, setHoverFolder] = useState<string | null>(null)

  useEffect(() => {
    if (!hoverFolder || !collapsed.has(hoverFolder)) return
    const timer = setTimeout(() => {
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(hoverFolder)
        return next
      })
    }, EXPAND_DELAY_MS)
    return () => clearTimeout(timer)
  }, [hoverFolder, collapsed])

  const endDrag = (): void => {
    setDragging(null)
    setDropTarget(null)
    setHoverFolder(null)
  }

  /** 拖到 target 資料夾上時：可以放就標示並允許 drop */
  const dragOverFolder = (e: React.DragEvent, target: string, hovered: string | null): void => {
    if (!dragging) return
    e.stopPropagation()
    setHoverFolder(hovered)
    if (movedInto(dragging, target) === null) {
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }

  const dropOnFolder = (e: React.DragEvent, target: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const from = e.dataTransfer.getData(DRAG_TYPE)
    endDrag()
    if (from && movedInto(from, target) !== null) props.onMove(from, target)
  }

  // 名稱輸入框在收合的資料夾裡時，展開它的上層，讓輸入框看得到
  const editing = props.creating?.folder ?? props.renaming
  const [shownEditing, setShownEditing] = useState<string | null>(null)
  if (editing !== shownEditing) {
    setShownEditing(editing)
    if (editing) {
      const ancestors: string[] = props.creating ? [editing] : []
      for (let p = parentOf(editing); p; p = parentOf(p)) ancestors.push(p)
      if (ancestors.some((a) => collapsed.has(a))) {
        setCollapsed((prev) => new Set([...prev].filter((p) => !ancestors.includes(p))))
      }
    }
  }

  /** 新項目的名稱輸入列，放在資料夾內容的最前面 */
  const renderCreating = (folder: string, depth: number): React.JSX.Element | null => {
    const item = props.creating
    if (!item || item.folder !== folder) return null
    return (
      <li key="/new">
        <div
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 14 }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <span className="tree-icon">{item.kind === 'folder' ? '▸' : ''}</span>
          <RenameInput
            initial=""
            placeholder={item.kind === 'folder' ? 'Folder name' : 'Note name'}
            onDone={(name) =>
              name === null || !name.trim() ? props.onStartCreate(null) : props.onCreate(item, name)
            }
          />
        </div>
      </li>
    )
  }

  const toggle = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderNode = (node: TreeNode, depth: number): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const open = !collapsed.has(node.path)
    const target = isFolder ? node.path : parentOf(node.path)
    const classes = ['tree-row']
    if (props.selected === node.path) classes.push('selected')
    if (dragging === node.path) classes.push('dragging')
    return (
      <li key={node.path} className={isFolder && dropTarget === node.path ? 'drop-target' : ''}>
        <div
          className={classes.join(' ')}
          draggable={props.renaming !== node.path}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, node.path)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(node.path)
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => dragOverFolder(e, target, isFolder ? node.path : null)}
          onDrop={(e) => dropOnFolder(e, target)}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(e) => (isFolder ? toggle(node.path) : props.onOpen(node.path, wantsNewTab(e)))}
          onMouseDown={(e) => {
            // 中鍵不要觸發自動捲動
            if (e.button === 1) e.preventDefault()
          }}
          onAuxClick={(e) => {
            if (e.button === 1 && !isFolder) props.onOpen(node.path, true)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, node })
          }}
          title={node.path}
        >
          <span className="tree-icon">{isFolder ? (open ? '▾' : '▸') : ''}</span>
          {props.renaming === node.path ? (
            <RenameInput
              initial={displayName(node)}
              onDone={(name) =>
                name === null ? props.onStartRename(null) : props.onRename(node, name)
              }
            />
          ) : (
            <span className="tree-name">{displayName(node)}</span>
          )}
        </div>
        {isFolder &&
          open &&
          ((node.children?.length ?? 0) > 0 || props.creating?.folder === node.path) && (
            <ul>
              {renderCreating(node.path, depth + 1)}
              {(node.children ?? []).map((c) => renderNode(c, depth + 1))}
            </ul>
          )}
      </li>
    )
  }

  return (
    <div
      className={`file-tree${dropTarget === '' ? ' drop-target' : ''}`}
      onDragOver={(e) => dragOverFolder(e, '', null)}
      onDrop={(e) => dropOnFolder(e, '')}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, node: props.root })
      }}
    >
      <ul>
        {renderCreating('', 0)}
        {(props.root.children ?? []).map((c) => renderNode(c, 0))}
      </ul>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() =>
              props.onStartCreate({
                folder: menu.node.kind === 'folder' ? menu.node.path : parentOf(menu.node.path),
                kind: 'file'
              })
            }
          >
            New note
          </button>
          <button
            onClick={() =>
              props.onStartCreate({
                folder: menu.node.kind === 'folder' ? menu.node.path : parentOf(menu.node.path),
                kind: 'folder'
              })
            }
          >
            New folder
          </button>
          {menu.node.path !== '' && (
            <>
              <button onClick={() => props.onStartRename(menu.node.path)}>Rename</button>
              <button className="danger" onClick={() => props.onRemove(menu.node)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function RenameInput({
  initial,
  placeholder,
  onDone
}: {
  initial: string
  placeholder?: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  // Enter 之後 input 消失會再觸發 blur，只送出一次
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name === initial ? null : name)
  }
  return (
    <input
      className="rename-input"
      autoFocus
      value={value}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        // 輸入法選字時的 Enter 不送出
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
    />
  )
}
