import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName, movedInto, parentOf, type NewItem } from '../lib/tree'
import { ChevronIcon, FolderIcon, FolderOpenIcon, NoteIcon } from './icons'
import { wantsNewTab } from '../workspace/tabs'

/** MIME type for drags inside the file tree, distinct from files dragged in from outside */
const DRAG_TYPE = 'application/x-knowmon-path'
/** How long hovering over a collapsed folder while dragging takes to expand it */
const EXPAND_DELAY_MS = 600

export interface FileTreeProps {
  root: TreeNode
  selected: string | null
  /** Path of the node being renamed */
  renaming: string | null
  /** The new item whose name is being entered; created only once the name is submitted */
  creating: NewItem | null
  /** newTab: Ctrl/Cmd+click or middle click */
  onOpen: (path: string, newTab: boolean) => void
  /** Shows the name field for a new item; null cancels */
  onStartCreate: (item: NewItem | null) => void
  onCreate: (item: NewItem, name: string) => void
  onStartRename: (path: string | null) => void
  onRename: (node: TreeNode, newName: string) => void
  onRemove: (node: TreeNode) => void
  /** Moves from into folder ('' is the vault root) */
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

  // The path being dragged, and the folder it would drop into ('' is the root)
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

  /** When dragging over the target folder: mark it and allow the drop if possible */
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

  // When the name field is inside a collapsed folder, expand its parents so the field is visible
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

  /** The name field row for a new item, placed first in the folder's contents */
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
          <TreeIcon folder={item.kind === 'folder'} open={false} />
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
            // Don't let middle click trigger autoscroll
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
          <TreeIcon folder={isFolder} open={open} />
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
  // The input disappears after Enter and fires blur again, so submit only once
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
        // Enter during IME composition doesn't submit
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
    />
  )
}

/** Folder: a rotatable chevron + folder icon; note: space for the chevron + note icon */
function TreeIcon({ folder, open }: { folder: boolean; open: boolean }): React.JSX.Element {
  return (
    <span className="tree-icon">
      {folder ? (
        <ChevronIcon size={14} className={open ? 'chevron open' : 'chevron'} />
      ) : (
        <span className="chevron-space" />
      )}
      {folder ? (
        open ? (
          <FolderOpenIcon size={16} />
        ) : (
          <FolderIcon size={16} />
        )
      ) : (
        <NoteIcon size={16} />
      )}
    </span>
  )
}
