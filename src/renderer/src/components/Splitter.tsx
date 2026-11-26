import { useRef } from 'react'

export interface SplitterProps {
  /** The panel's new width while dragging; side decides which drag direction widens it */
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
  /** Double-click restores the default width */
  onReset: () => void
}

/** A draggable divider between panels */
export function Splitter({ side, width, onResize, onReset }: SplitterProps): React.JSX.Element {
  const drag = useRef<{ x: number; width: number } | null>(null)

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, width }
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        onResize(side === 'left' ? d.width + dx : d.width - dx)
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing')
      }}
      onDoubleClick={onReset}
    />
  )
}
