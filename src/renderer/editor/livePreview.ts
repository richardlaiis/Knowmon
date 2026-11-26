// Live Markdown rendering (like Obsidian's Live Preview):
// marks (# ** ` [[ ]] and so on) are hidden when the cursor isn't near them, showing only the rendered style;
// they show again when the cursor moves onto the element or line, for editing.
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
import { resolveImageSrc } from '../../shared/assets'
import { ImageWidget, notePath } from './images'
import { MathWidget, blockMath } from './math'
import { mathMarkdown, mathSource } from './mathSyntax'
import { WIKILINK, frontmatterEnd, splitWikilink } from './syntax'
import { renderedTables, tables } from './tables'

export { frontmatterEnd }

/**
 * Finds a language to highlight from a code block's language tag (@codemirror/language-data, loaded dynamically on use).
 * Matches language names and aliases first, then file extensions, so ```py and ```rs are recognized too.
 */
export function findCodeLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0]
  if (!name) return null
  return (
    LanguageDescription.matchLanguageName(languages, name, false) ??
    LanguageDescription.matchFilename(languages, `file.${name}`)
  )
}

/** Markdown language support (GFM: tables, strikethrough, task lists) and syntax colors, also used in source mode */
export function markdownSupport(): Extension {
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: findCodeLanguage,
      extensions: [mathMarkdown()]
    }),
    syntaxHighlighting(markdownHighlight)
  ]
}

/** Live rendering (toggled with a Compartment) */
export function livePreview(): Extension {
  return [livePreviewPlugin, tables(), blockMath()]
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
  // Syntax colors inside code blocks (each theme's actual colors are the --hl-* variables in main.css)
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

// ---- Pure functions: computing decorations ----

/** Nodes in which wikilinks aren't shown (code; math is rendered whole) */
const NO_WIKILINK = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'InlineMath',
  'BlockMath'
])

/** Computes the live rendering decorations within [from, to] */
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
  /** Hides a mark and the single space right after it */
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

  const note = state.facet(notePath)
  const fmEnd = frontmatterEnd(doc)
  if (fmEnd > 0 && from < fmEnd) eachLine(0, fmEnd, 'cm-lp-frontmatter')

  const tree = syntaxTree(state)
  // Ranges replaced whole by a table widget (tables.ts) need no other decorations inside
  const tableRanges = renderedTables(state)
  const inTable = (a: number): boolean => tableRanges.some((t) => t.from <= a && a <= t.to)

  // [[wikilink]] and [[target|label]]: the Markdown parser doesn't know them (and treats the [x] inside as a link), so find them with a regex first
  const wikilinks: { from: number; to: number; target: string; textFrom: number }[] = []
  for (const m of doc.sliceString(from, to).matchAll(WIKILINK)) {
    const a = from + m.index!
    if (a < fmEnd || inTable(a)) continue
    let inCode = false
    for (let n: SyntaxNode | null = tree.resolveInner(a + 2, 1); n; n = n.parent) {
      if (NO_WIKILINK.has(n.name)) inCode = true
    }
    if (inCode) continue
    const { target, textStart } = splitWikilink(m[1])
    wikilinks.push({ from: a, to: a + m[0].length, target, textFrom: a + 2 + textStart })
  }
  const inWikilink = (a: number, b: number): boolean =>
    wikilinks.some((w) => w.from < b && w.to > a)

  tree.iterate({
    from,
    to,
    enter: (ref) => {
      // Content inside the frontmatter isn't rendered as Markdown
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
        case 'Table':
          if (inTable(ref.from)) return false
          return
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
        case 'Image': {
          // ![alt](relative path): replaced whole by the image when the cursor isn't on it; when it is, the image follows the raw syntax
          // ![[x]] has no URL (handled as a wikilink); URLs and absolute paths aren't rendered
          const url = children(node, 'URL')[0]
          if (!url || inWikilink(ref.from, ref.to)) return
          const rel = resolveImageSrc(note, doc.sliceString(url.from, url.to))
          if (rel === null) return
          const marks = children(node, 'LinkMark')
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
          const widget = new ImageWidget(rel, alt)
          if (touches(ref.from, ref.to)) {
            decos.push(Decoration.widget({ widget, side: 1 }).range(ref.to))
          } else {
            decos.push(Decoration.replace({ widget }).range(ref.from, ref.to))
          }
          return false
        }
        case 'InlineMath': {
          // $x$: replaced whole by the formula when the cursor isn't on it; shows the raw syntax when it is
          if (!touches(ref.from, ref.to)) {
            const src = mathSource(node, (a, b) => doc.sliceString(a, b))
            if (src.tex) {
              const widget = new MathWidget(src.tex, src.display)
              decos.push(Decoration.replace({ widget }).range(ref.from, ref.to))
            }
          }
          return false
        }
        case 'BlockMath':
          // $$ blocks are handled by the StateField in math.ts
          return false
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
          // When the cursor isn't in the block, ``` fences become a language label / are hidden
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

/** Toggles the task box at pos ([ ] ↔ [x]) and returns the change to apply */
export function toggleTask(
  doc: Text,
  pos: number
): { from: number; to: number; insert: string } | null {
  const marker = doc.sliceString(pos, pos + 3)
  if (marker === '[ ]') return { from: pos + 1, to: pos + 2, insert: 'x' }
  if (/^\[[xX]\]$/.test(marker)) return { from: pos + 1, to: pos + 2, insert: ' ' }
  return null
}

/** Only these protocols may be opened in an external browser */
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
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(notePath) !== u.state.facet(notePath)
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
            // The main process's setWindowOpenHandler opens it in the system browser instead
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
