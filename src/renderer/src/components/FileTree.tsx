import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName, movedInto, parentOf } from '../lib/tree'

/** 檔案樹內部拖曳用的 MIME type，和外部拖進來的檔案區分 */
const DRAG_TYPE = 'application/x-knowmon-path'
/** 拖曳時停在收合的資料夾上多久會自動展開 */
const EXPAND_DELAY_MS = 600

export interface FileTreeProps {
  root: TreeNode
  selected: string | null
  /** 正在改名的節點路徑（新增筆記或資料夾後會直接進入改名狀態） */
  renaming: string | null
  onOpen: (path: string) => void
  onCreate: (folder: string) => void
  onCreateFolder: (parent: string) => void
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

  // 新增的項目在收合的資料夾裡時，展開它的上層，讓改名輸入框看得到
  const [shownRenaming, setShownRenaming] = useState<string | null>(null)
  if (props.renaming !== shownRenaming) {
    setShownRenaming(props.renaming)
    if (props.renaming) {
      const ancestors: string[] = []
      for (let p = parentOf(props.renaming); p; p = parentOf(p)) ancestors.push(p)
      if (ancestors.some((a) => collapsed.has(a))) {
        setCollapsed((prev) => new Set([...prev].filter((p) => !ancestors.includes(p))))
      }
    }
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
          onClick={() => (isFolder ? toggle(node.path) : props.onOpen(node.path))}
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
        {isFolder && open && node.children && node.children.length > 0 && (
          <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
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
      <ul>{(props.root.children ?? []).map((c) => renderNode(c, 0))}</ul>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() =>
              props.onCreate(
                menu.node.kind === 'folder' ? menu.node.path : parentOf(menu.node.path)
              )
            }
          >
            New note
          </button>
          <button
            onClick={() =>
              props.onCreateFolder(
                menu.node.kind === 'folder' ? menu.node.path : parentOf(menu.node.path)
              )
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
  onDone
}: {
  initial: string
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
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
    />
  )
}
