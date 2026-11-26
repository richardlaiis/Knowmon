// Live rendering of GFM tables: when the cursor isn't in a table, the whole table is replaced by a rendered <table>;
// as soon as the cursor (or selection) touches it, the whole table shows its raw Markdown for editing.
//
// Replace decorations spanning line breaks (block widgets) can't come from a ViewPlugin, so tables use a StateField,
// separate from the ViewPlugin in livePreview.ts. Only top-level tables are rendered: replacing whole lines of a table
// inside a quote or list would eat the > and list markers too, so those stay as they are.
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { renderMath } from './mathRender'
import { mathSource } from './mathSyntax'
import { WIKILINK, frontmatterEnd, splitWikilink } from './syntax'

export type Align = 'left' | 'center' | 'right' | null

/** A piece of text in a cell, with its style */
export interface CellSpan {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** External link */
  url?: string
  /** wikilink target */
  target?: string
  /** Math (text is TeX); display for $$…$$ */
  math?: 'inline' | 'display'
}

export interface TableCell {
  /** Where the cursor goes on click, relative to the start of the table's first line */
  offset: number
  spans: CellSpan[]
}

export interface TableModel {
  align: Align[]
  header: TableCell[]
  rows: TableCell[][]
}

/** Top-level tables to render (not touched by the cursor); from/to cover whole lines */
export interface RenderedTable {
  from: number
  to: number
  node: SyntaxNode
}

/** Tables at the top level of the document, outside the frontmatter and not touched by a selection */
export function renderedTables(state: EditorState): RenderedTable[] {
  const { doc } = state
  const fmEnd = frontmatterEnd(doc)
  const sel = state.selection.ranges
  const out: RenderedTable[] = []
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name !== 'Table' || n.from < fmEnd) continue
    const from = doc.lineAt(n.from).from
    const to = doc.lineAt(n.to).to
    if (sel.some((r) => r.from <= to && r.to >= from)) continue
    out.push({ from, to, node: n })
  }
  return out
}

/** Alignment from the delimiter row (|:--|:-:|--:|) */
function parseAlign(text: string): Align[] {
  let cells = text.trim().split('|')
  if (cells[0].trim() === '') cells = cells.slice(1)
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1)
  return cells.map((c) => {
    const s = c.trim()
    const left = s.startsWith(':')
    const right = s.endsWith(':') && s.length > 1
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
}

type Style = Omit<CellSpan, 'text'>

/** Turns the inline syntax of cell [from, to] into pieces of text (marks hidden) */
function cellSpans(
  state: EditorState,
  cell: SyntaxNode | null,
  from: number,
  to: number
): CellSpan[] {
  const { doc } = state
  const pieces: CellSpan[] = []
  const emit = (text: string, style: Style): void => {
    if (text) pieces.push({ text, ...style })
  }
  const kids = (node: SyntaxNode, name: string): SyntaxNode[] => {
    const out: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
    return out
  }

  /** Outputs the child nodes within [a, b] in order, with the text between them as is */
  const walk = (parent: SyntaxNode, a: number, b: number, style: Style): void => {
    let pos = a
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c.to <= a || c.from >= b) continue
      if (c.from > pos) emit(doc.sliceString(pos, c.from), style)
      node(c, style)
      pos = Math.max(pos, c.to)
    }
    if (pos < b) emit(doc.sliceString(pos, b), style)
  }

  const node = (n: SyntaxNode, style: Style): void => {
    const raw = (): void => emit(doc.sliceString(n.from, n.to), style)
    switch (n.name) {
      case 'EmphasisMark':
      case 'StrikethroughMark':
        return
      case 'StrongEmphasis':
        return walk(n, n.from, n.to, { ...style, bold: true })
      case 'Emphasis':
        return walk(n, n.from, n.to, { ...style, italic: true })
      case 'Strikethrough':
        return walk(n, n.from, n.to, { ...style, strike: true })
      case 'InlineCode': {
        const marks = kids(n, 'CodeMark')
        if (marks.length < 2) return raw()
        const code = doc.sliceString(marks[0].to, marks[marks.length - 1].from)
        return emit(code.replace(/\\\|/g, '|'), { ...style, code: true })
      }
      case 'InlineMath': {
        // As with code, \| in a cell is restored to |
        const src = mathSource(n, (a, b) => doc.sliceString(a, b))
        if (!src.tex) return raw()
        return emit(src.tex.replace(/\\\|/g, '|'), {
          ...style,
          math: src.display ? 'display' : 'inline'
        })
      }
      case 'Escape':
        return emit(doc.sliceString(n.from + 1, n.to), style)
      case 'Link': {
        // [x] without a URL (such as inside [[x]]) keeps its brackets and is handled as a wikilink later; \| inside still needs restoring
        const marks = kids(n, 'LinkMark')
        const url = kids(n, 'URL')[0]
        if (marks.length < 2 || !url) return walk(n, n.from, n.to, style)
        return walk(n, marks[0].to, marks[1].from, {
          ...style,
          url: doc.sliceString(url.from, url.to)
        })
      }
      case 'Image': {
        // Images in cells show only their alt text
        const marks = kids(n, 'LinkMark')
        if (marks.length < 2 || !kids(n, 'URL')[0]) return raw()
        return emit(doc.sliceString(marks[0].to, marks[1].from), style)
      }
      case 'URL':
        // GFM autolinks (a bare URL)
        return emit(doc.sliceString(n.from, n.to), { ...style, url: doc.sliceString(n.from, n.to) })
      default:
        return raw()
    }
  }

  if (cell) walk(cell, from, to, {})
  else emit(doc.sliceString(from, to), {})

  // wikilinks: the parser doesn't know them, so find them with a regex on the merged text (not inside code)
  const chars: Style[] = []
  for (const p of pieces) {
    const { text, ...style } = p
    for (let i = 0; i < text.length; i++) chars.push(style)
  }
  const text = pieces.map((p) => p.text).join('')
  const out: CellSpan[] = []
  // Characters of the same piece (the same style object) are always merged; math isn't merged (adjacent $a$$b$ are two formulas)
  let lastStyle: Style | null = null
  const push = (s: string, style: Style): void => {
    if (!s) return
    const last = out[out.length - 1]
    if (last && (style === lastStyle || sameStyle(last, style))) last.text += s
    else out.push({ text: s, ...style })
    lastStyle = style
  }
  let pos = 0
  for (const m of text.matchAll(WIKILINK)) {
    const a = m.index!
    const b = a + m[0].length
    if (chars.slice(a, b).some((s) => s.code || s.math)) continue
    for (let i = pos; i < a; i++) push(text[i], chars[i])
    const { target, textStart } = splitWikilink(m[1])
    out.push({ text: m[1].slice(textStart), ...chars[a], url: undefined, target })
    lastStyle = null
    pos = b
  }
  for (let i = pos; i < text.length; i++) push(text[i], chars[i])
  return out.map(stripUndefined)
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    !a.target &&
    !b.target &&
    !a.math &&
    !b.math &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    a.url === b.url
  )
}

function stripUndefined(s: CellSpan): CellSpan {
  const out = { ...s } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out as unknown as CellSpan
}

/** Splits a row into cells by |; leading and trailing | produce no empty cells */
function rowCells(state: EditorState, row: SyntaxNode, base: number): TableCell[] {
  const { doc } = state
  const delims: SyntaxNode[] = []
  const cells: SyntaxNode[] = []
  for (let c = row.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableDelimiter') delims.push(c)
    else if (c.name === 'TableCell') cells.push(c)
  }
  const segs: [number, number][] = []
  let start = row.from
  for (const d of delims) {
    segs.push([start, d.from])
    start = d.to
  }
  segs.push([start, row.to])
  const blank = ([a, b]: [number, number]): boolean => doc.sliceString(a, b).trim() === ''
  if (delims.length > 0 && blank(segs[0])) segs.shift()
  if (delims.length > 0 && segs.length > 0 && blank(segs[segs.length - 1])) segs.pop()

  return segs.map(([a, b]) => {
    const text = doc.sliceString(a, b)
    const from = a + (text.length - text.trimStart().length)
    const to = b - (text.length - text.trimEnd().length)
    const cell = cells.find((c) => c.from >= a && c.to <= b) ?? null
    // An empty cell: the cursor goes after the first space following the | (or right after the | if there's no space)
    const offset = from < to ? from : Math.min(a + 1, b)
    return { offset: offset - base, spans: from < to ? cellSpans(state, cell, from, to) : [] }
  })
}

/** Parses a table node into render data; positions are relative to the start of the table's first line */
export function parseTable(state: EditorState, table: SyntaxNode): TableModel {
  const base = state.doc.lineAt(table.from).from
  let header: TableCell[] = []
  let align: Align[] = []
  const rows: TableCell[][] = []
  for (let c = table.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableHeader') header = rowCells(state, c, base)
    else if (c.name === 'TableRow') rows.push(rowCells(state, c, base))
    else if (c.name === 'TableDelimiter' && align.length === 0)
      align = parseAlign(state.doc.sliceString(c.from, c.to))
  }
  // The header sets the column count: short rows are padded with empty cells, long rows are cut (the GFM rule)
  const width = header.length
  const fit = (row: TableCell[]): TableCell[] => {
    const last = row[row.length - 1]
    const pad = last ? last.offset : 0
    return [
      ...row.slice(0, width),
      ...Array.from({ length: Math.max(0, width - row.length) }, () => ({ offset: pad, spans: [] }))
    ]
  }
  return {
    align: Array.from({ length: width }, (_, i) => align[i] ?? null),
    header,
    rows: rows.map(fit)
  }
}

// ---- Widget ----

function spanDOM(s: CellSpan): Node {
  let el: Node = s.math ? renderMath(s.text, s.math === 'display') : document.createTextNode(s.text)
  const wrap = (tag: string, cls?: string): HTMLElement => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    e.append(el)
    el = e
    return e
  }
  if (s.code) wrap('code', 'cm-lp-code')
  if (s.bold) wrap('strong')
  if (s.italic) wrap('em')
  if (s.strike) wrap('s')
  if (s.url) {
    const a = wrap('span', 'cm-lp-link')
    a.dataset.url = s.url
    a.title = `${s.url}\nCtrl+click to open`
  }
  if (s.target) {
    const w = wrap('span', 'cm-lp-wikilink')
    w.dataset.target = s.target
  }
  return el
}

export class TableWidget extends WidgetType {
  constructor(
    /** The table source; the same source always parses the same */
    readonly source: string,
    readonly model: TableModel
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source
  }
  get estimatedHeight(): number {
    return (this.model.rows.length + 1) * 34 + 16
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-lp-table'
    const row = (cells: TableCell[], tag: 'th' | 'td'): HTMLElement => {
      const tr = document.createElement('tr')
      cells.forEach((c, i) => {
        const td = document.createElement(tag)
        const align = this.model.align[i]
        if (align) td.style.textAlign = align
        td.dataset.offset = String(c.offset)
        td.append(...c.spans.map(spanDOM))
        tr.append(td)
      })
      return tr
    }
    const thead = document.createElement('thead')
    thead.append(row(this.model.header, 'th'))
    const tbody = document.createElement('tbody')
    tbody.append(...this.model.rows.map((r) => row(r, 'td')))
    table.append(thead)
    if (this.model.rows.length > 0) table.append(tbody)
    wrap.append(table)
    return wrap
  }
  /** Lets the editor handle clicks on the table (placing the cursor, Ctrl+clicking links) */
  ignoreEvent(): boolean {
    return false
  }
}

// ---- StateField ----

export function tableDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  for (const t of renderedTables(state)) {
    const widget = new TableWidget(state.doc.sliceString(t.from, t.to), parseTable(state, t.node))
    decos.push(Decoration.replace({ widget, block: true }).range(t.from, t.to))
  }
  return Decoration.set(decos)
}

const tableField = StateField.define<DecorationSet>({
  create: tableDecorations,
  update(decos, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return tableDecorations(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Clicking a cell puts the cursor in that cell's source (so the table expands into Markdown) */
const tableClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    // Ctrl/Cmd+click goes to the link and wikilink handling
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return false
    const target = e.target as HTMLElement
    const wrap = target.closest<HTMLElement>('.cm-lp-table-wrap')
    if (!wrap) return false
    const cell = target.closest<HTMLElement>('[data-offset]')
    // Not on a cell (the horizontal scrollbar, empty space): leave it to the browser, so dragging the scrollbar doesn't expand the table
    if (!cell) return true
    const pos = Math.min(view.posAtDOM(wrap) + Number(cell.dataset.offset), view.state.doc.length)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
    e.preventDefault()
    return true
  }
})

/** Live table rendering (part of livePreview(); disabled in source mode) */
export function tables(): Extension {
  return [tableField, tableClicks]
}
