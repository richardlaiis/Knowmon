// GFM 表格的即時渲染：游標不在表格裡時，整張表格換成渲染好的 <table>；
// 游標（或選取範圍）碰到表格就整張顯示原始 Markdown，在原始碼上編輯。
//
// 取代跨越換行的裝飾（block widget）不能由 ViewPlugin 提供，所以表格用 StateField，
// 與 livePreview.ts 的 ViewPlugin 分開。只渲染文件頂層的表格：引用或清單裡的表格
// 整行取代會連 > 與清單標記一起吃掉，保持原樣。
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { WIKILINK, frontmatterEnd, splitWikilink } from './syntax'

export type Align = 'left' | 'center' | 'right' | null

/** 格子裡的一段文字與它的樣式 */
export interface CellSpan {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** 外部連結 */
  url?: string
  /** wikilink 目標 */
  target?: string
}

export interface TableCell {
  /** 點擊時游標要放的位置，相對於表格第一行的行首 */
  offset: number
  spans: CellSpan[]
}

export interface TableModel {
  align: Align[]
  header: TableCell[]
  rows: TableCell[][]
}

/** 要渲染（沒有被游標碰到）的頂層表格；from/to 是整行範圍 */
export interface RenderedTable {
  from: number
  to: number
  node: SyntaxNode
}

/** 文件頂層、不在 frontmatter 裡、沒有被選取範圍碰到的表格 */
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

/** 分隔列（|:--|:-:|--:|）的對齊方式 */
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

/** 把格子 [from, to] 的行內語法轉成一段段文字（隱藏標記） */
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

  /** 依序輸出 [a, b] 內的子節點，子節點之間的文字照原樣輸出 */
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
      case 'Escape':
        return emit(doc.sliceString(n.from + 1, n.to), style)
      case 'Link': {
        // [x] 沒有網址（例如 [[x]] 裡面）保留括號，之後由 wikilink 處理；裡面的 \| 仍要還原
        const marks = kids(n, 'LinkMark')
        const url = kids(n, 'URL')[0]
        if (marks.length < 2 || !url) return walk(n, n.from, n.to, style)
        return walk(n, marks[0].to, marks[1].from, {
          ...style,
          url: doc.sliceString(url.from, url.to)
        })
      }
      case 'Image': {
        // 格子裡的圖片只顯示替代文字
        const marks = kids(n, 'LinkMark')
        if (marks.length < 2 || !kids(n, 'URL')[0]) return raw()
        return emit(doc.sliceString(marks[0].to, marks[1].from), style)
      }
      case 'URL':
        // GFM 自動連結（直接寫網址）
        return emit(doc.sliceString(n.from, n.to), { ...style, url: doc.sliceString(n.from, n.to) })
      default:
        return raw()
    }
  }

  if (cell) walk(cell, from, to, {})
  else emit(doc.sliceString(from, to), {})

  // wikilink：解析器不認得，在合併後的文字上用正則找（程式碼裡的不算）
  const chars: Style[] = []
  for (const p of pieces) {
    const { text, ...style } = p
    for (let i = 0; i < text.length; i++) chars.push(style)
  }
  const text = pieces.map((p) => p.text).join('')
  const out: CellSpan[] = []
  const push = (s: string, style: Style): void => {
    if (!s) return
    const last = out[out.length - 1]
    if (last && sameStyle(last, style)) last.text += s
    else out.push({ text: s, ...style })
  }
  let pos = 0
  for (const m of text.matchAll(WIKILINK)) {
    const a = m.index!
    const b = a + m[0].length
    if (chars.slice(a, b).some((s) => s.code)) continue
    for (let i = pos; i < a; i++) push(text[i], chars[i])
    const { target, textStart } = splitWikilink(m[1])
    out.push({ text: m[1].slice(textStart), ...chars[a], url: undefined, target })
    pos = b
  }
  for (let i = pos; i < text.length; i++) push(text[i], chars[i])
  return out.map(stripUndefined)
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    !a.target &&
    !b.target &&
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

/** 依 | 切出一列的格子；開頭與結尾的 | 不產生空格子 */
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
    // 空格子：游標放在 | 之後的第一個空白之後（沒有空白就緊接在 | 後）
    const offset = from < to ? from : Math.min(a + 1, b)
    return { offset: offset - base, spans: from < to ? cellSpans(state, cell, from, to) : [] }
  })
}

/** 把表格節點解析成渲染用的資料；位置相對於表格第一行的行首 */
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
  // 欄數以表頭為準：太短的列補空格子，太長的截掉（GFM 規則）
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
  let el: Node = document.createTextNode(s.text)
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
    /** 表格原文；原文相同時解析結果也相同 */
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
  /** 讓編輯器處理表格上的點擊（放游標、Ctrl+點擊連結） */
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

/** 點擊格子：把游標放到該格的原始碼（表格因此展開成 Markdown） */
const tableClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    // Ctrl/Cmd+點擊交給連結與 wikilink 的處理
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return false
    const target = e.target as HTMLElement
    const wrap = target.closest<HTMLElement>('.cm-lp-table-wrap')
    if (!wrap) return false
    const cell = target.closest<HTMLElement>('[data-offset]')
    // 不在格子上（水平捲軸、留白）：交給瀏覽器，拖曳捲軸時不展開表格
    if (!cell) return true
    const pos = Math.min(view.posAtDOM(wrap) + Number(cell.dataset.offset), view.state.doc.length)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
    e.preventDefault()
    return true
  }
})

/** 表格即時渲染（屬於 livePreview()，原始碼模式不啟用） */
export function tables(): Extension {
  return [tableField, tableClicks]
}
