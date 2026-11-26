import type { TextSegment } from '../../../shared/types'

/** Shows a search snippet or link context, marking matches with <mark> */
export function Segments({ segments }: { segments: TextSegment[] }): React.JSX.Element {
  return (
    <>
      {segments.map((s, i) =>
        s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>
      )}
    </>
  )
}
