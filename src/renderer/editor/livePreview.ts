// Markdown 即時渲染（類似 Obsidian 的 Live Preview）：
// 標記符號（# ** ` [[ ]] 等）在游標不在附近時隱藏，只顯示渲染後的樣式；
// 游標移到該元素或該行時再顯示原始語法，方便編輯。
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  syntaxTree
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import type { EditorState, Extension, Range, Text } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { SyntaxNode } from '@lezer/common'

/**
 * 依程式碼區塊的語言標記找出可上色的語言（@codemirror/language-data，用到時才動態載入）。
 * 先比對語言名稱與別名，再比對副檔名，所以 ```py、```rs 也認得。
 */
export function findCodeLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0]
  if (!name) return null
  return (
    LanguageDescription.matchLanguageName(languages, name, false) ??
    LanguageDescription.matchFilename(languages, `file.${name}`)
  )
}

/** Markdown 語言支援（GFM：表格、刪除線、待辦清單）與語法顏色，原始碼模式也會用到 */
export function markdownSupport(): Extension {
  return [
    markdown({ base: markdownLanguage, codeLanguages: findCodeLanguage }),
    syntaxHighlighting(markdownHighlight)
  ]
}

/** 即時渲染（可用 Compartment 開關） */
export function livePreview(): Extension {
  return livePreviewPlugin
}

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--syntax)' },
  { tag: t.quote, color: 'var(--quote)' },
  // 程式碼區塊內的語法顏色（各主題的實際色值在 main.css 的 --hl-* 變數）
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--hl-comment)',
    fontStyle: 'italic'
  },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--hl-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--hl-type)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--fg)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--hl-tag)' },
  { tag: t.invalid, color: 'var(--danger)' }
])

// ---- 純函式：計算裝飾 ----

/** 文件開頭 YAML frontmatter 的結束位置（含結尾的 ---），沒有則回傳 0 */
export function frontmatterEnd(doc: Text): number {
  const head = doc.sliceString(0, Math.min(doc.length, 20_000))
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?=\r?\n|$)/.exec(head)
  return m ? m[0].length : 0
}

const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText'])

/** 計算 [from, to] 範圍內的即時渲染裝飾 */
export function buildDecorations(
  state: EditorState,
  from = 0,
  to = state.doc.length
): DecorationSet {
  const { doc } = state
  const decos: Range<Decoration>[] = []
  const lineClasses = new Map<number, Set<string>>()
  const sel = state.selection.ranges

  const touches = (a: number, b: number): boolean => sel.some((r) => r.from <= b && r.to >= a)
  const lineTouched = (pos: number): boolean => {
    const line = doc.lineAt(pos)
    return touches(line.from, line.to)
  }
  const addLineClass = (pos: number, cls: string): void => {
    const start = doc.lineAt(pos).from
    if (!lineClasses.has(start)) lineClasses.set(start, new Set())
    lineClasses.get(start)!.add(cls)
  }
  const eachLine = (a: number, b: number, cls: string): void => {
    for (let n = doc.lineAt(a).number; n <= doc.lineAt(b).number; n++) {
      addLineClass(doc.line(n).from, cls)
    }
  }
  const hide = (a: number, b: number): void => {
    if (b > a) decos.push(Decoration.replace({}).range(a, b))
  }
  /** 隱藏標記以及緊接在後的一個空白 */
  const hideWithSpace = (a: number, b: number): void => {
    hide(a, doc.sliceString(b, b + 1) === ' ' ? b + 1 : b)
  }
  const mark = (a: number, b: number, cls: string, attrs?: Record<string, string>): void => {
    if (b > a) decos.push(Decoration.mark({ class: cls, attributes: attrs }).range(a, b))
  }
  const children = (node: SyntaxNode, name: string): SyntaxNode[] => {
    const out: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
    return out
  }

  const fmEnd = frontmatterEnd(doc)
  if (fmEnd > 0 && from < fmEnd) eachLine(0, fmEnd, 'cm-lp-frontmatter')

  const tree = syntaxTree(state)

  // [[wikilink]] 與 [[目標|顯示文字]]：Markdown 解析器不認得（還會把裡面的 [x] 當成連結），先用正則找出來
  const wikilinks: { from: number; to: number; target: string; textFrom: number }[] = []
  for (const m of doc.sliceString(from, to).matchAll(WIKILINK)) {
    const a = from + m.index!
    if (a < fmEnd) continue
    let inCode = false
    for (let n: SyntaxNode | null = tree.resolveInner(a + 2, 1); n; n = n.parent) {
      if (CODE_NODES.has(n.name)) inCode = true
    }
    if (inCode) continue
    const pipe = m[1].indexOf('|')
    wikilinks.push({
      from: a,
      to: a + m[0].length,
      target: (pipe >= 0 ? m[1].slice(0, pipe) : m[1]).trim(),
      textFrom: pipe >= 0 ? a + 2 + pipe + 1 : a + 2
    })
  }
  const inWikilink = (a: number, b: number): boolean =>
    wikilinks.some((w) => w.from < b && w.to > a)

  tree.iterate({
    from,
    to,
    enter: (ref) => {
      // frontmatter 裡的內容不套用 Markdown 渲染
      if (ref.from < fmEnd) return ref.to > fmEnd
      const node = ref.node
      const name = ref.name

      const heading = /^ATXHeading(\d)$/.exec(name)
      if (heading) {
        addLineClass(ref.from, `cm-lp-h${heading[1]}`)
        if (!lineTouched(ref.from)) {
          children(node, 'HeaderMark').forEach((m, i) =>
            i === 0 ? hideWithSpace(m.from, m.to) : hide(m.from - 1, m.to)
          )
        }
        return
      }
      const setext = /^SetextHeading(\d)$/.exec(name)
      if (setext) {
        addLineClass(ref.from, `cm-lp-h${setext[1]}`)
        return
      }

      switch (name) {
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough': {
          if (!touches(ref.from, ref.to)) {
            const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
            children(node, markName).forEach((m) => hide(m.from, m.to))
          }
          return
        }
        case 'InlineCode': {
          const marks = children(node, 'CodeMark')
          if (touches(ref.from, ref.to) || marks.length < 2) {
            mark(ref.from, ref.to, 'cm-lp-code')
          } else {
            hide(marks[0].from, marks[0].to)
            mark(marks[0].to, marks[marks.length - 1].from, 'cm-lp-code')
            hide(marks[marks.length - 1].from, marks[marks.length - 1].to)
          }
          return false
        }
        case 'Link': {
          const marks = children(node, 'LinkMark')
          const url = children(node, 'URL')[0]
          if (marks.length < 2 || !url || inWikilink(ref.from, ref.to)) return
          const href = doc.sliceString(url.from, url.to)
          mark(marks[0].to, marks[1].from, 'cm-lp-link', {
            'data-url': href,
            title: `${href}\nCtrl+click to open`
          })
          if (!touches(ref.from, ref.to)) {
            hide(marks[0].from, marks[0].to)
            hide(marks[1].from, ref.to)
          }
          return
        }
        case 'QuoteMark':
          if (!lineTouched(ref.from)) hideWithSpace(ref.from, ref.to)
          return
        case 'Blockquote':
          eachLine(ref.from, ref.to, 'cm-lp-quote')
          return
        case 'ListMark': {
          const item = node.parent
          const isTask = !!item?.getChild('Task')
          const bullet = item?.parent?.name === 'BulletList'
          if (lineTouched(ref.from)) return
          if (isTask) hideWithSpace(ref.from, ref.to)
          else if (bullet)
            decos.push(Decoration.replace({ widget: bulletWidget }).range(ref.from, ref.to))
          return
        }
        case 'TaskMarker': {
          const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
          if (checked) mark(ref.to, doc.lineAt(ref.from).to, 'cm-lp-task-done')
          if (!touches(ref.from, ref.to)) {
            decos.push(
              Decoration.replace({ widget: checked ? checkedWidget : uncheckedWidget }).range(
                ref.from,
                ref.to
              )
            )
          }
          return
        }
        case 'HorizontalRule':
          if (!lineTouched(ref.from)) {
            decos.push(Decoration.replace({ widget: hrWidget }).range(ref.from, ref.to))
          }
          return
        case 'CodeBlock':
          eachLine(ref.from, ref.to, 'cm-lp-codeblock')
          addLineClass(ref.from, 'cm-lp-codeblock-first')
          addLineClass(ref.to, 'cm-lp-codeblock-last')
          return false
        case 'FencedCode': {
          eachLine(ref.from, ref.to, 'cm-lp-codeblock')
          addLineClass(ref.from, 'cm-lp-codeblock-first')
          addLineClass(ref.to, 'cm-lp-codeblock-last')
          const marks = children(node, 'CodeMark')
          const open = marks[0]
          const close = marks.length > 1 ? marks[marks.length - 1] : null
          const info = children(node, 'CodeInfo')[0]
          const lang = info ? doc.sliceString(info.from, info.to).trim() : ''
          // 游標不在區塊裡時，``` 圍欄換成語言標籤／隱藏
          if (open && !touches(ref.from, ref.to)) {
            const openLine = doc.lineAt(open.from)
            addLineClass(open.from, 'cm-lp-fence-hidden')
            decos.push(
              Decoration.replace({ widget: new TextWidget('cm-lp-code-lang', lang) }).range(
                open.from,
                openLine.to
              )
            )
            if (close && doc.lineAt(close.from).number !== openLine.number) {
              addLineClass(close.from, 'cm-lp-fence-hidden')
              hide(close.from, close.to)
            }
          } else {
            addLineClass(ref.from, 'cm-lp-fence')
            if (close) addLineClass(close.from, 'cm-lp-fence')
          }
          return false
        }
      }
      return
    }
  })

  for (const w of wikilinks) {
    if (touches(w.from, w.to)) {
      mark(w.from + 2, w.to - 2, 'cm-lp-wikilink', { 'data-target': w.target })
    } else {
      hide(w.from, w.textFrom)
      mark(w.textFrom, w.to - 2, 'cm-lp-wikilink', { 'data-target': w.target })
      hide(w.to - 2, w.to)
    }
  }

  for (const [pos, classes] of lineClasses) {
    decos.push(Decoration.line({ class: [...classes].join(' ') }).range(pos))
  }
  return Decoration.set(decos, true)
}

/** 切換 pos 位置的待辦方塊（[ ] ↔ [x]），回傳要套用的變更 */
export function toggleTask(
  doc: Text,
  pos: number
): { from: number; to: number; insert: string } | null {
  const marker = doc.sliceString(pos, pos + 3)
  if (marker === '[ ]') return { from: pos + 1, to: pos + 2, insert: 'x' }
  if (/^\[[xX]\]$/.test(marker)) return { from: pos + 1, to: pos + 2, insert: ' ' }
  return null
}

/** 只允許用外部瀏覽器開啟這些協定 */
export function isOpenableUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim())
}

// ---- Widgets ----

class TextWidget extends WidgetType {
  constructor(
    readonly cls: string,
    readonly text: string
  ) {
    super()
  }
  eq(other: TextWidget): boolean {
    return other.cls === this.cls && other.text === this.text
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.cls
    el.textContent = this.text
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-checkbox'
    box.checked = this.checked
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

const bulletWidget = new TextWidget('cm-lp-bullet', '•')
const hrWidget = new TextWidget('cm-lp-hr', '')
const checkedWidget = new CheckboxWidget(true)
const uncheckedWidget = new CheckboxWidget(false)

// ---- ViewPlugin ----

function visibleDecorations(view: EditorView): DecorationSet {
  const ranges = view.visibleRanges
  if (ranges.length === 0) return Decoration.none
  return buildDecorations(view.state, ranges[0].from, ranges[ranges.length - 1].to)
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = visibleDecorations(view)
    }
    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = visibleDecorations(u.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const target = e.target as HTMLElement
        if (target.classList.contains('cm-lp-checkbox')) {
          const change = toggleTask(view.state.doc, view.posAtDOM(target))
          if (change) view.dispatch({ changes: change })
          e.preventDefault()
          return true
        }
        if (e.ctrlKey || e.metaKey) {
          const url = target.closest<HTMLElement>('[data-url]')?.dataset.url
          if (url && isOpenableUrl(url)) {
            // main process 的 setWindowOpenHandler 會改用系統瀏覽器開啟
            window.open(url)
            e.preventDefault()
            return true
          }
        }
        return false
      }
    }
  }
)
