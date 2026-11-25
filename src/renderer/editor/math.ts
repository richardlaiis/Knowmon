// Math rendering in the editor's live preview.
// - MathWidget: a rendered formula (inline math is decorated by livePreview.ts's ViewPlugin).
// - Block math ($$ … $$): a replacement that crosses line breaks can't come from a ViewPlugin,
//   so blocks use a StateField, like tables.ts. When the selection doesn't touch a closed block,
//   it becomes the formula; when it does, the source is shown with a rendered preview below it.
//   Top-level blocks are replaced line by line with a block widget (centered). Blocks in quotes
//   and lists are replaced from the opening $$ (after the first line's container markers) to the
//   end of the closing line with an inline widget, so the markers stay.
// See docs/plans/latex-rendering.md.
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { renderMath } from './mathRender'
import { mathSource } from './mathSyntax'
import { frontmatterEnd } from './syntax'

/** inline: $x$ · block: top-level $$ · nested: $$ in a quote/list · preview: below the source */
export type MathKind = 'inline' | 'block' | 'nested' | 'preview'

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly kind: MathKind = 'inline'
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.kind === this.kind
  }
  get estimatedHeight(): number {
    return this.kind === 'block' || this.kind === 'preview' ? 48 : -1
  }
  toDOM(): HTMLElement {
    const isBlock = this.kind === 'block' || this.kind === 'preview'
    const wrap = document.createElement(isBlock ? 'div' : 'span')
    wrap.className = `cm-lp-math cm-lp-math-${this.kind}`
    wrap.append(renderMath(this.tex, this.display))
    return wrap
  }
  /** Let the editor place the cursor next to the formula (which shows its source) */
  ignoreEvent(): boolean {
    return false
  }
}

/** Containers that can hold a math block */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/** All BlockMath nodes outside the frontmatter (only containers are walked) */
export function blockMathNodes(state: EditorState): SyntaxNode[] {
  const fmEnd = frontmatterEnd(state.doc)
  const out: SyntaxNode[] = []
  const walk = (parent: SyntaxNode): void => {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.to <= fmEnd) continue
      if (n.name === 'BlockMath') {
        if (n.from >= fmEnd) out.push(n)
      } else if (CONTAINERS.has(n.name)) {
        walk(n)
      }
    }
  }
  walk(syntaxTree(state).topNode)
  return out
}

export function blockMathDecorations(state: EditorState): DecorationSet {
  const { doc } = state
  const sel = state.selection.ranges
  const slice = (a: number, b: number): string => doc.sliceString(a, b)
  const decos: Range<Decoration>[] = []
  for (const n of blockMathNodes(state)) {
    const src = mathSource(n, slice)
    if (!src.closed || !src.tex) continue
    const topLevel = n.parent?.name === 'Document'
    // A top-level block is replaced from its line start (it may be indented by up to 3 spaces)
    const from = topLevel ? doc.lineAt(n.from).from : n.from
    if (sel.some((r) => r.from <= n.to && r.to >= from)) {
      const widget = new MathWidget(src.tex, true, 'preview')
      decos.push(Decoration.widget({ widget, side: 1, block: true }).range(doc.lineAt(n.to).to))
    } else if (topLevel) {
      const widget = new MathWidget(src.tex, true, 'block')
      decos.push(Decoration.replace({ widget, block: true }).range(from, n.to))
    } else {
      const widget = new MathWidget(src.tex, true, 'nested')
      decos.push(Decoration.replace({ widget }).range(n.from, n.to))
    }
  }
  return Decoration.set(decos, true)
}

const blockMathField = StateField.define<DecorationSet>({
  create: blockMathDecorations,
  update(decos, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return blockMathDecorations(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Block math rendering (part of livePreview(); off in source mode) */
export function blockMath(): Extension {
  return blockMathField
}
