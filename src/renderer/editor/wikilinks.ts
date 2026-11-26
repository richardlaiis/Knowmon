// wikilinks in the editor: autocompleting note names after [[, and Ctrl/Cmd+click to open links
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { createLinkResolver, linkTextFor, wikilinkTarget } from '../../shared/links'
import type { NoteSummary } from '../../shared/types'
import { rankNotes } from '../src/lib/fuzzy'

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText'])
const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g

/** Whether [[... is being typed before the cursor (no | or # yet); returns the text typed so far */
export function openWikilinkQuery(textBefore: string): string | null {
  const m = /\[\[([^[\]|#\n]*)$/.exec(textBefore)
  return m ? m[1] : null
}

/** The wikilink target at col on the line (col is an index within the line) */
export function wikilinkAt(line: string, col: number): string | null {
  for (const m of line.matchAll(WIKILINK)) {
    if (col >= m.index && col <= m.index + m[0].length) return wikilinkTarget(m[1]) || null
  }
  return null
}

/** Autocompletion option: inserts the shortest target that resolves uniquely, moving the cursor after ]] once chosen */
export function wikilinkOptions(
  notes: readonly NoteSummary[],
  query: string,
  limit = 50
): { label: string; detail: string; text: string }[] {
  const resolve = createLinkResolver(notes.map((n) => n.path))
  return rankNotes(notes, query, [], limit).map((n) => {
    const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
    return { label: n.title, detail: folder, text: linkTextFor(n.path, resolve) }
  })
}

function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true
  }
  return false
}

export interface WikilinkOptions {
  getNotes: () => Promise<NoteSummary[]>
  /** newTab: Ctrl/Cmd+Shift+click */
  onOpen: (target: string, newTab: boolean) => void
}

export function wikilinks({ getNotes, onOpen }: WikilinkOptions): Extension {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const query = openWikilinkQuery(line.text.slice(0, ctx.pos - line.from))
    if (query === null || inCode(ctx.state, ctx.pos)) return null
    const notes = await getNotes()
    if (ctx.aborted) return null
    const from = ctx.pos - query.length
    const options: Completion[] = wikilinkOptions(notes, query).map((o, i) => ({
      label: o.label,
      detail: o.detail,
      boost: -i, // keep rankNotes' order
      apply: (view, _c, a, b) => {
        // closeBrackets has usually added ]] already; if so, replace it too
        const end = view.state.sliceDoc(b, b + 2) === ']]' ? b + 2 : b
        const insert = o.text + ']]'
        view.dispatch({
          changes: { from: a, to: end, insert },
          selection: { anchor: a + insert.length },
          userEvent: 'input.complete'
        })
      }
    }))
    return { from, options, filter: false }
  }

  return [
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
        // A rendered table (tables.ts) has no matching source position, so read data-target directly
        const inTable = (e.target as HTMLElement).closest?.<HTMLElement>(
          '.cm-lp-table [data-target]'
        )
        if (inTable?.dataset.target) {
          e.preventDefault()
          onOpen(inTable.dataset.target, e.shiftKey)
          return true
        }
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos === null || inCode(view.state, pos)) return false
        const line = view.state.doc.lineAt(pos)
        const target = wikilinkAt(line.text, pos - line.from)
        if (!target) return false
        e.preventDefault()
        onOpen(target, e.shiftKey)
        return true
      }
    })
  ]
}
