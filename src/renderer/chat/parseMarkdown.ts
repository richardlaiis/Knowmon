// Turns Markdown from the model into a simple tree for React to render (no HTML strings).
// Uses the editor's lezer parser (GFM) plus [[wikilink]]; half-finished syntax mid-stream parses too.
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownConfig, MarkdownParser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { wikilinkTarget } from '../../shared/links'
import { isOpenableUrl } from '../editor/livePreview'
import { mathMarkdown, mathSource } from '../editor/mathSyntax'

export type MdInline =
  | { t: 'text'; text: string }
  | { t: 'strong' | 'em' | 'del'; children: MdInline[] }
  | { t: 'code'; text: string }
  | { t: 'wikilink'; target: string; label: string }
  | { t: 'link'; href: string; children: MdInline[] }
  /** A Q&A citation number [n] (when parseMarkdown's citations option is on) */
  | { t: 'cite'; n: number }
  /** $…$, \(…\); display for $$…$$ or \[…\] */
  | { t: 'math'; tex: string; display: boolean }

export type MdBlock =
  | { t: 'p'; children: MdInline[] }
  | { t: 'h'; level: number; children: MdInline[] }
  | { t: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
  | { t: 'code'; text: string }
  | { t: 'quote'; children: MdBlock[] }
  | { t: 'hr' }
  /** A $$ … $$ or \[ … \] block */
  | { t: 'math'; tex: string }

const WikiLink: MarkdownConfig = {
  defineNodes: ['WikiLink'],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1
        const m = /^\[\[[^[\]\n]+?\]\]/.exec(cx.slice(pos, cx.end))
        return m ? cx.addElement(cx.elt('WikiLink', pos, pos + m[0].length)) : -1
      }
    }
  ]
}

/** [1], [12]: source numbers in Q&A answers. Parsed before Link, so [1][2] isn't taken as a reference link */
const Citation: MarkdownConfig = {
  defineNodes: ['Citation'],
  parseInline: [
    {
      name: 'Citation',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) === 91) return -1
        const m = /^\[\d{1,3}\]/.exec(cx.slice(pos, Math.min(cx.end, pos + 6)))
        return m ? cx.addElement(cx.elt('Citation', pos, pos + m[0].length)) : -1
      }
    }
  ]
}

const base = markdownLanguage.parser as MarkdownParser
// Models often write \( \) and \[ \], so answers accept them too (notes only have $ and $$)
const math = mathMarkdown({ brackets: true })
const parser = base.configure([WikiLink, math])
const citationParser = base.configure([WikiLink, Citation, math])

/** Syntax marks that output no content */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'StrikethroughMark',
  'URL',
  'LinkTitle',
  'LinkLabel',
  'CodeInfo'
])

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

export interface ParseOptions {
  /** Parse [n] as citation numbers */
  citations?: boolean
}

export function parseMarkdown(text: string, opts: ParseOptions = {}): MdBlock[] {
  const src = text
  const slice = (from: number, to: number): string => src.slice(from, to)

  /** The inline content between from and to; anything outside child nodes is plain text */
  function inlines(node: SyntaxNode, from: number, to: number): MdInline[] {
    const out: MdInline[] = []
    const push = (s: string): void => {
      // Line breaks and continuation indentation inside a paragraph count as spaces
      const t = s.replace(/\n[ \t>]*/g, ' ')
      if (!t) return
      const last = out[out.length - 1]
      if (last?.t === 'text') last.text += t
      else out.push({ t: 'text', text: t })
    }
    let pos = from
    for (const c of children(node)) {
      if (c.to <= from || c.from >= to) continue
      if (c.from > pos) push(slice(pos, c.from))
      pos = c.to
      if (MARKS.has(c.name)) continue
      switch (c.name) {
        case 'StrongEmphasis':
          out.push({ t: 'strong', children: inlines(c, c.from, c.to) })
          break
        case 'Emphasis':
          out.push({ t: 'em', children: inlines(c, c.from, c.to) })
          break
        case 'Strikethrough':
          out.push({ t: 'del', children: inlines(c, c.from, c.to) })
          break
        case 'InlineCode': {
          const marks = children(c).filter((m) => m.name === 'CodeMark')
          const a = marks[0]?.to ?? c.from
          const b = marks.length > 1 ? marks[marks.length - 1].from : c.to
          out.push({ t: 'code', text: slice(a, b).trim() || slice(a, b) })
          break
        }
        case 'WikiLink': {
          const inner = slice(c.from + 2, c.to - 2)
          const target = wikilinkTarget(inner)
          const label = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : inner
          if (target) out.push({ t: 'wikilink', target, label })
          else push(slice(c.from, c.to))
          break
        }
        case 'Link': {
          const marks = children(c).filter((m) => m.name === 'LinkMark')
          const url = c.getChild('URL')
          const labelEnd = marks.length > 1 ? marks[1].from : c.to
          const label = inlines(c, marks[0]?.to ?? c.from, labelEnd)
          const href = url ? slice(url.from, url.to) : ''
          if (href && isOpenableUrl(href)) out.push({ t: 'link', href, children: label })
          else
            for (const n of label) {
              if (n.t === 'text') push(n.text)
              else out.push(n)
            }
          break
        }
        case 'Citation':
          out.push({ t: 'cite', n: Number(slice(c.from + 1, c.to - 1)) })
          break
        case 'InlineMath': {
          const m = mathSource(c, slice)
          if (m.tex) out.push({ t: 'math', tex: m.tex, display: m.display })
          else push(slice(c.from, c.to))
          break
        }
        case 'Escape':
          push(slice(c.from + 1, c.to))
          break
        case 'HardBreak':
          push(' ')
          break
        default:
          push(slice(c.from, c.to))
      }
    }
    if (pos < to) push(slice(pos, to))
    // Trim surrounding whitespace (after a heading's #, indentation at the start of a paragraph)
    const first = out[0]
    if (first?.t === 'text') first.text = first.text.trimStart()
    const last = out[out.length - 1]
    if (last?.t === 'text') last.text = last.text.trimEnd()
    return out.filter((n) => n.t !== 'text' || n.text)
  }

  function blocks(node: SyntaxNode): MdBlock[] {
    const out: MdBlock[] = []
    for (const c of children(node)) {
      if (MARKS.has(c.name)) continue
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(c.name)
      if (heading) {
        out.push({ t: 'h', level: Number(heading[1]), children: inlines(c, c.from, c.to) })
        continue
      }
      switch (c.name) {
        case 'Paragraph':
          out.push({ t: 'p', children: inlines(c, c.from, c.to) })
          break
        case 'BulletList':
        case 'OrderedList': {
          const items = children(c).filter((i) => i.name === 'ListItem')
          const mark = items[0]?.getChild('ListMark')
          const start = mark ? parseInt(slice(mark.from, mark.to), 10) : 1
          out.push({
            t: 'list',
            ordered: c.name === 'OrderedList',
            start: Number.isFinite(start) ? start : 1,
            items: items.map(blocks)
          })
          break
        }
        case 'FencedCode':
        case 'CodeBlock': {
          const code = children(c).filter((x) => x.name === 'CodeText')
          out.push({ t: 'code', text: code.map((x) => slice(x.from, x.to)).join('\n') })
          break
        }
        case 'Blockquote':
          out.push({ t: 'quote', children: blocks(c) })
          break
        case 'HorizontalRule':
          out.push({ t: 'hr' })
          break
        case 'BlockMath': {
          // Not closed yet (streaming) or empty blocks show the source
          const m = mathSource(c, slice)
          if (m.closed && m.tex) out.push({ t: 'math', tex: m.tex })
          else {
            const raw = slice(c.from, c.to).trim()
            if (raw) out.push({ t: 'p', children: [{ t: 'text', text: raw }] })
          }
          break
        }
        default: {
          // Tables, HTML and so on: show the source
          const raw = slice(c.from, c.to).trim()
          if (raw) out.push({ t: 'p', children: [{ t: 'text', text: raw }] })
        }
      }
    }
    return out
  }

  return blocks((opts.citations ? citationParser : parser).parse(src).topNode)
}
