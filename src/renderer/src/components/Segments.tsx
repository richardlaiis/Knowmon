import type { TextSegment } from '../../../shared/types'

/** 顯示搜尋摘要或連結上下文，命中的部分以 <mark> 標示 */
export function Segments({ segments }: { segments: TextSegment[] }): React.JSX.Element {
  return (
    <>
      {segments.map((s, i) =>
        s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
      )}
    </>
  )
}
