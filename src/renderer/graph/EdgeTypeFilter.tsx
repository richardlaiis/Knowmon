import type { LinkType } from '../../shared/types'
import { EDGE_TYPES } from './edgeTypes'

export interface EdgeTypeFilterProps {
  value: ReadonlySet<LinkType>
  onChange: (next: Set<LinkType>) => void
}

/** 邊類型的開關：每種類型一個帶顏色的按鈕 */
export function EdgeTypeFilter({ value, onChange }: EdgeTypeFilterProps): React.JSX.Element {
  return (
    <div className="edge-types" role="group" aria-label="Edge types">
      {EDGE_TYPES.map((t) => {
        const on = value.has(t.type)
        return (
          <button
            key={t.type}
            className={`edge-type${on ? ' on' : ''}`}
            aria-pressed={on}
            title={t.title}
            onClick={() => {
              const next = new Set(value)
              if (on) next.delete(t.type)
              else next.add(t.type)
              onChange(next)
            }}
          >
            <span className={`swatch swatch-${t.type}`} aria-hidden="true" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
