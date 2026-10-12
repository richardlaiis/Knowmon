// 以 React 元素渲染 parseMarkdown 的結果；wikilink 可點擊開啟筆記
import { useMemo } from 'react'
import { parseMarkdown, type MdBlock, type MdInline } from './markdown'

export interface MarkdownProps {
  text: string
  className?: string
  onOpenLink: (target: string, newTab: boolean) => void
}

export function Markdown({ text, className, onOpenLink }: MarkdownProps): React.JSX.Element {
  const tree = useMemo(() => parseMarkdown(text), [text])

  const inline = (nodes: MdInline[]): React.ReactNode[] =>
    nodes.map((n, i) => {
      switch (n.t) {
        case 'text':
          return n.text
        case 'strong':
          return <strong key={i}>{inline(n.children)}</strong>
        case 'em':
          return <em key={i}>{inline(n.children)}</em>
        case 'del':
          return <del key={i}>{inline(n.children)}</del>
        case 'code':
          return <code key={i}>{n.text}</code>
        case 'link':
          return (
            <a key={i} href={n.href} target="_blank" rel="noreferrer" title={n.href}>
              {inline(n.children)}
            </a>
          )
        case 'wikilink':
          return (
            <a
              key={i}
              className="wikilink"
              href="#"
              title={`${n.target} (Ctrl+click opens a new tab)`}
              onClick={(e) => {
                e.preventDefault()
                onOpenLink(n.target, e.ctrlKey || e.metaKey)
              }}
            >
              {n.label}
            </a>
          )
      }
    })

  const blocks = (nodes: MdBlock[]): React.ReactNode[] =>
    nodes.map((b, i) => {
      switch (b.t) {
        case 'p':
          return <p key={i}>{inline(b.children)}</p>
        case 'h': {
          const H = `h${Math.min(6, b.level + 2)}` as 'h3' | 'h4' | 'h5' | 'h6'
          return <H key={i}>{inline(b.children)}</H>
        }
        case 'list': {
          const items = b.items.map((item, j) => <li key={j}>{blocks(item)}</li>)
          return b.ordered ? (
            <ol key={i} start={b.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          )
        }
        case 'code':
          return (
            <pre key={i}>
              <code>{b.text}</code>
            </pre>
          )
        case 'quote':
          return <blockquote key={i}>{blocks(b.children)}</blockquote>
        case 'hr':
          return <hr key={i} />
      }
    })

  return <div className={className}>{blocks(tree)}</div>
}
