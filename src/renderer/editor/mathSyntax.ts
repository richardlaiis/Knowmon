// LaTeX math syntax for the lezer Markdown parser (shared by the editor and the AI reply renderer).
//
// - Inline `$...$`: the opening `$` is not followed by whitespace or `$`; the first unescaped `$`
//   after it is the only candidate closer, and it must not be preceded by whitespace nor followed
//   by a digit, so `$5 and $10` and `$5 and $10, $x$` stay text. One line only.
// - Inline `$$...$$` on one line (display style, kept inline).
// - Block: a line starting with `$$`. `$$ x $$` alone on a line is a one-line block; `$$` without
//   another `$$` on the line opens a block that closes at the first line ending with `$$`.
//   A blank line or the end of the enclosing quote/list ends an unclosed block (never rendered).
// - With `brackets` (AI replies only): `\(...\)` inline, `\[...\]` inline or as a block.
//
// Node names: InlineMath / BlockMath, with MathMark children for the delimiters. Quote markers
// inside a block stay child nodes; `mathSource` removes them from the TeX.
// See docs/plans/latex-rendering.md.
import type { SyntaxNode } from '@lezer/common'
import { styleTags, tags as t } from '@lezer/highlight'
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'

const DOLLAR = 36 // $
const BACKSLASH = 92 // \
const NEWLINE = 10

function isSpace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === NEWLINE || ch === 13 || /\s/.test(String.fromCharCode(ch))
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57
}

export interface InlineMathMatch {
  /** Length of the whole match, delimiters included */
  length: number
  /** Length of the opening / closing delimiter */
  open: number
  close: number
}

/**
 * Inline math starting at `pos` (`charAt(i)` returns -1 past `end`), or null.
 * Never crosses a line break.
 */
export function scanInlineMath(
  charAt: (i: number) => number,
  pos: number,
  end: number,
  brackets = false
): InlineMathMatch | null {
  const c0 = charAt(pos)
  const c1 = pos + 1 < end ? charAt(pos + 1) : -1

  if (c0 === BACKSLASH) {
    if (!brackets || (c1 !== 40 /* ( */ && c1 !== 91) /* [ */) return null
    const closer = c1 === 40 ? 41 /* ) */ : 93 /* ] */
    for (let i = pos + 2; i < end; i++) {
      const ch = charAt(i)
      if (ch === NEWLINE) return null
      if (ch !== BACKSLASH) continue
      if (i + 1 < end && charAt(i + 1) === closer) {
        return i > pos + 2 && !blank(charAt, pos + 2, i)
          ? { length: i + 2 - pos, open: 2, close: 2 }
          : null
      }
      i++ // skip the escaped character
    }
    return null
  }

  if (c0 !== DOLLAR) return null

  if (c1 === DOLLAR) {
    // $$...$$ on one line
    for (let i = pos + 2; i < end; i++) {
      const ch = charAt(i)
      if (ch === NEWLINE) return null
      if (ch === BACKSLASH) {
        i++
        continue
      }
      if (ch === DOLLAR && i + 1 < end && charAt(i + 1) === DOLLAR) {
        return blank(charAt, pos + 2, i) ? null : { length: i + 2 - pos, open: 2, close: 2 }
      }
    }
    return null
  }

  if (c1 < 0 || isSpace(c1)) return null
  for (let i = pos + 1; i < end; i++) {
    const ch = charAt(i)
    if (ch === NEWLINE) return null
    if (ch === BACKSLASH) {
      i++
      continue
    }
    if (ch !== DOLLAR) continue
    // Only the first unescaped $ can close (TeX math never contains one)
    if (isSpace(charAt(i - 1)) || (i + 1 < end && isDigit(charAt(i + 1)))) return null
    return { length: i + 1 - pos, open: 1, close: 1 }
  }
  return null
}

function blank(charAt: (i: number) => number, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (!isSpace(charAt(i))) return false
  return true
}

/** Inline math at the start of `text` (for tests and simple callers) */
export function inlineMathAt(text: string, pos = 0, brackets = false): InlineMathMatch | null {
  return scanInlineMath((i) => text.charCodeAt(i), pos, text.length, brackets)
}

export interface BlockMathOpen {
  /** Opening / closing delimiter */
  open: string
  close: string
  /** The block ends on this line (`$$ x $$`) */
  oneLine: boolean
}

/**
 * Whether `text` (a line, from the first non-space character after container markers)
 * opens a math block.
 */
export function blockMathOpen(text: string, brackets = false): BlockMathOpen | null {
  let open: string
  let close: string
  if (text.startsWith('$$')) {
    open = '$$'
    close = '$$'
  } else if (brackets && text.startsWith('\\[')) {
    open = '\\['
    close = '\\]'
  } else {
    return null
  }
  const rest = text.slice(open.length).trimEnd()
  const at = rest.indexOf(close)
  if (at < 0) return { open, close, oneLine: false }
  // The only closer must end the line and the content must not be empty
  if (at !== rest.length - close.length || rest.slice(0, at).trim() === '') return null
  return { open, close, oneLine: true }
}

/** The line closes a multi-line block */
export function blockMathCloses(text: string, close: string): boolean {
  return text.trimEnd().endsWith(close)
}

// lezer keeps the number of container blocks (quote, list item) matched by the current line in
// `Line.depth`; it isn't in the type definitions. FencedCode uses it the same way.
function lineDepth(line: Line): number {
  return (line as unknown as { depth: number }).depth
}

function canOpenBlock(line: Line, brackets: boolean): BlockMathOpen | null {
  if (line.indent - line.baseIndent >= 4) return null // indented code
  return blockMathOpen(line.text.slice(line.pos), brackets)
}

function parseBlock(cx: BlockContext, line: Line, brackets: boolean): boolean {
  const open = canOpenBlock(line, brackets)
  if (!open) return false
  const from = cx.lineStart + line.pos
  const marks = [cx.elt('MathMark', from, from + open.open.length)]

  if (open.oneLine) {
    const end = cx.lineStart + line.text.trimEnd().length
    marks.push(cx.elt('MathMark', end - open.close.length, end))
    cx.nextLine()
  } else {
    while (cx.nextLine()) {
      // The enclosing quote or list ended, or a blank line: the block stays unclosed
      if (lineDepth(line) < cx.depth || line.pos >= line.text.length) break
      marks.push(...line.markers)
      if (blockMathCloses(line.text, open.close)) {
        const end = cx.lineStart + line.text.trimEnd().length
        marks.push(cx.elt('MathMark', end - open.close.length, end))
        cx.nextLine()
        break
      }
    }
  }
  cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), marks))
  return true
}

/** Markdown extension; `brackets` also accepts `\(...\)` and `\[...\]` */
export function mathMarkdown(opts: { brackets?: boolean } = {}): MarkdownConfig {
  const brackets = !!opts.brackets
  return {
    defineNodes: [{ name: 'InlineMath' }, { name: 'BlockMath', block: true }, { name: 'MathMark' }],
    props: [
      styleTags({
        'InlineMath BlockMath': t.monospace,
        MathMark: t.processingInstruction
      })
    ],
    parseBlock: [
      {
        name: 'BlockMath',
        before: 'FencedCode',
        parse: (cx, line) => parseBlock(cx, line, brackets),
        endLeaf: (_cx, line) => canOpenBlock(line, brackets) !== null
      }
    ],
    parseInline: [
      {
        name: 'InlineMath',
        before: 'Escape',
        parse(cx, next, pos) {
          if (next !== DOLLAR && next !== BACKSLASH) return -1
          const m = scanInlineMath((i) => cx.char(i), pos, cx.end, brackets)
          if (!m) return -1
          const end = pos + m.length
          return cx.addElement(
            cx.elt('InlineMath', pos, end, [
              cx.elt('MathMark', pos, pos + m.open),
              cx.elt('MathMark', end - m.close, end)
            ])
          )
        }
      }
    ]
  }
}

export interface MathSource {
  tex: string
  display: boolean
  /** A block has its closing delimiter (inline math is always closed) */
  closed: boolean
}

/** The TeX inside an InlineMath / BlockMath node, without delimiters and quote markers */
export function mathSource(
  node: SyntaxNode,
  slice: (from: number, to: number) => string
): MathSource {
  const marks: SyntaxNode[] = []
  const others: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'MathMark') marks.push(c)
    else others.push(c)
  }
  const open = marks[0]
  const close = marks.length > 1 ? marks[marks.length - 1] : null
  const from = open ? open.to : node.from
  const to = close ? close.from : node.to
  let tex = ''
  let pos = from
  for (const o of others) {
    if (o.to <= pos || o.from >= to) continue
    tex += slice(pos, o.from)
    // A quote marker includes one following space
    pos = slice(o.to, o.to + 1) === ' ' ? o.to + 1 : o.to
  }
  if (pos < to) tex += slice(pos, to)
  const delim = open ? slice(open.from, open.to) : ''
  return {
    tex: tex.trim(),
    display: node.name === 'BlockMath' || delim === '$$' || delim === '\\[',
    closed: node.name === 'InlineMath' || !!close
  }
}
