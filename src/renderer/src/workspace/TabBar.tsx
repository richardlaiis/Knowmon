// 分頁列：切換、關閉（含中鍵）、拖曳排序、右鍵選單、新分頁，以及左右面板的開關
import { useEffect, useState } from 'react'
import {
  CloseIcon,
  GraphIcon,
  NoteIcon,
  PlusIcon,
  SidebarIcon,
  TimelineIcon
} from '../components/icons'
import { tabTitle, type Tab } from './tabs'

/** 分頁拖曳用的 MIME type，和檔案樹的拖曳區分 */
const DRAG_TYPE = 'application/x-knowmon-tab'

export interface TabBarProps {
  tabs: Tab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  /** 把 id 移到 toIndex（以移除前的位置計算） */
  onMove: (id: string, toIndex: number) => void
  onNewTab: () => void
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function TabBar(props: TabBarProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 拖曳時會放在第幾個分頁之前 */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

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

  const indexAt = (e: React.DragEvent<HTMLElement>, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? i : i + 1
  }

  return (
    <div className="tab-bar">
      <button
        className={`icon pane-toggle${props.leftOpen ? ' on' : ''}`}
        onClick={props.onToggleLeft}
        title="Toggle sidebar (Ctrl+B)"
      >
        <SidebarIcon side="left" />
      </button>
      <div
        className="tabs"
        role="tablist"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null)
        }}
      >
        {props.tabs.map((tab, i) => {
          const active = tab.id === props.activeId
          const classes = ['tab']
          if (active) classes.push('active')
          if (dropIndex === i) classes.push('drop-before')
          if (dropIndex === i + 1 && i === props.tabs.length - 1) classes.push('drop-after')
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={classes.join(' ')}
              title={
                tab.kind === 'note' ? tab.path : tab.kind === 'graph' ? 'Graph view' : 'Timeline'
              }
              draggable
              onClick={() => props.onActivate(tab.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button === 1) props.onClose(tab.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: tab.id })
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setDropIndex(indexAt(e, i))
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_TYPE)
                setDropIndex(null)
                if (id) props.onMove(id, indexAt(e, i))
              }}
              onDragEnd={() => setDropIndex(null)}
            >
              <TabIcon kind={tab.kind} />
              <span className="tab-title">{tabTitle(tab)}</span>
              <button
                className="tab-close"
                title="Close (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onClose(tab.id)
                }}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )
        })}
        <button
          className="tab-new"
          onClick={props.onNewTab}
          title="Open a note in a new tab (Ctrl+T)"
        >
          <PlusIcon size={16} />
        </button>
      </div>
      <button
        className={`icon pane-toggle${props.rightOpen ? ' on' : ''}`}
        onClick={props.onToggleRight}
        title="Toggle backlinks / local graph panel (Ctrl+Alt+B)"
      >
        <SidebarIcon side="right" />
      </button>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => props.onClose(menu.id)}>Close</button>
          <button onClick={() => props.onCloseOthers(menu.id)}>Close others</button>
        </div>
      )}
    </div>
  )
}

function TabIcon({ kind }: { kind: Tab['kind'] }): React.JSX.Element {
  const C = kind === 'graph' ? GraphIcon : kind === 'timeline' ? TimelineIcon : NoteIcon
  return <C size={14} className="tab-icon" />
}
