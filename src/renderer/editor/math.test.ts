import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildDecorations, markdownSupport } from './livePreview'
import { notePath } from './images'
import { MathWidget, blockMathDecorations, blockMathNodes } from './math'

/** State with the cursor at ‸ (or a selection between two ‸), fully parsed */
function stateOf(src: string): EditorState {
  const marks: number[] = []
  let doc = ''
  for (const ch of src) {
    if (ch === '‸') marks.push(doc.length)
    else doc += ch
  }
  const selection =
    marks.length === 2
      ? EditorSelection.single(marks[0], marks[1])
      : EditorSelection.cursor(marks[0] ?? doc.length)
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdownSupport(), notePath.of('note.md')]
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

interface Found {
  kind: string
  tex: string
  display: boolean
  /** The replaced source ('' for a widget that replaces nothing) */
  replaced: string
  block: boolean
}

function collect(
  state: EditorState,
  set: ReturnType<typeof buildDecorations>,
  out: Found[] = []
): Found[] {
  set.between(0, state.doc.length, (from, to, d) => {
    const w = (d.spec as { widget?: unknown }).widget
    if (w instanceof MathWidget) {
      out.push({
        kind: w.kind,
        tex: w.tex,
        display: w.display,
        replaced: state.doc.sliceString(from, to),
        block: !!d.spec.block
      })
    }
  })
  return out
}

/** Block math widgets (StateField) */
const blockWidgets = (src: string): Found[] => {
  const state = stateOf(src)
  return collect(state, blockMathDecorations(state))
}

/** Inline math widgets (ViewPlugin) */
const inlineWidgets = (src: string): Found[] => {
  const state = stateOf(src)
  return collect(state, buildDecorations(state))
}

describe('inline math', () => {
  it('is replaced by a formula when the cursor is elsewhere', () => {
    expect(inlineWidgets('Energy $E=mc^2$ and $$\\sum x$$\n‸')).toEqual([
      { kind: 'inline', tex: 'E=mc^2', display: false, replaced: '$E=mc^2$', block: false },
      { kind: 'inline', tex: '\\sum x', display: true, replaced: '$$\\sum x$$', block: false }
    ])
  })

  it('shows the source while the cursor touches it', () => {
    expect(inlineWidgets('a $x‸^2$ b')).toEqual([])
    expect(inlineWidgets('a $x^2$‸ b')).toEqual([])
    expect(inlineWidgets('a ‸$x^2$ b')).toEqual([])
    expect(inlineWidgets('a $x$ ‸b $y$')).toMatchObject([{ tex: 'x' }, { tex: 'y' }])
  })

  it('currency, code and escaped dollars are not math', () => {
    expect(inlineWidgets('It costs $5 and $10.\n`$x$` \\$y$\n‸')).toEqual([])
  })

  it('is rendered in headings, lists and quotes', () => {
    expect(inlineWidgets('# T $a$\n- $b$\n> $c$\n\n‸').map((w) => w.tex)).toEqual(['a', 'b', 'c'])
  })

  it('no wikilink decoration inside math', () => {
    const state = stateOf('$[[x]]$ and $$[[y]]$$\n‸')
    const marks: string[] = []
    buildDecorations(state).between(0, state.doc.length, (_f, _t, d) => {
      if (d.spec.class === 'cm-lp-wikilink') marks.push('wikilink')
    })
    expect(marks).toEqual([])
  })

  it('the frontmatter is not rendered', () => {
    expect(inlineWidgets('---\nprice: $x$\n---\n‸')).toEqual([])
  })
})

describe('block math', () => {
  const BLOCK = 'Before\n\n$$\na^2 + b^2 = c^2\n$$\n\nAfter'

  it('a top-level block becomes a block widget covering whole lines', () => {
    expect(blockWidgets(BLOCK + '‸')).toEqual([
      {
        kind: 'block',
        tex: 'a^2 + b^2 = c^2',
        display: true,
        replaced: '$$\na^2 + b^2 = c^2\n$$',
        block: true
      }
    ])
    expect(blockWidgets('  $$ x $$\n\n‸')).toMatchObject([{ replaced: '  $$ x $$', block: true }])
  })

  it('with the cursor inside: source plus a preview below', () => {
    for (const src of [
      'Before\n\n‸$$\nx\n$$\n\nAfter',
      'Before\n\n$$\nx‸\n$$\n\nAfter',
      'Before\n\n$$\nx\n$$‸\n\nAfter',
      'Bef‸ore\n\n$$\nx\n$$\n\nAf‸ter'
    ]) {
      expect(blockWidgets(src)).toEqual([
        { kind: 'preview', tex: 'x', display: true, replaced: '', block: true }
      ])
    }
    // The preview sits at the end of the closing line
    const state = stateOf('$$\nx‸\n$$\nAfter')
    const at: number[] = []
    blockMathDecorations(state).between(0, state.doc.length, (from) => void at.push(from))
    expect(at).toEqual([state.doc.line(3).to])
  })

  it('a cursor at the start of an indented block line still shows the source', () => {
    expect(blockWidgets('‸  $$ x $$')).toMatchObject([{ kind: 'preview' }])
  })

  it('only the block with the cursor is expanded', () => {
    expect(blockWidgets('$$ a $$\n\n$$ b‸ $$').map((w) => `${w.kind}:${w.tex}`)).toEqual([
      'block:a',
      'preview:b'
    ])
  })

  it('blocks in quotes and lists keep their markers', () => {
    expect(blockWidgets('> $$\n> x\n> $$\n\n‸')).toEqual([
      { kind: 'nested', tex: 'x', display: true, replaced: '$$\n> x\n> $$', block: false }
    ])
    expect(blockWidgets('- item\n\n  $$\n  y\n  $$\n\n‸')).toMatchObject([
      { kind: 'nested', tex: 'y', replaced: '$$\n  y\n  $$' }
    ])
  })

  it('unclosed, empty and frontmatter blocks are not rendered', () => {
    expect(blockWidgets('$$\nx\n\n‸')).toEqual([])
    expect(blockWidgets('$$\n$$\n\n‸')).toEqual([])
    expect(blockWidgets('---\na: $$ x $$\n---\n‸')).toEqual([])
    expect(blockMathNodes(stateOf('---\n$$\nx\n$$\n---\n\n$$ y $$'))).toHaveLength(1)
  })

  it('live preview adds no decorations inside a block', () => {
    const state = stateOf('$$\n**x** [[y]]\n$$\n\n‸')
    const found: string[] = []
    buildDecorations(state).between(0, state.doc.length, (from, to) => {
      if (to > 0 && from < 18) found.push(state.doc.sliceString(from, to))
    })
    expect(found).toEqual([])
  })

  it('identical formulas are equal widgets (no DOM rebuild)', () => {
    expect(new MathWidget('x', true, 'block').eq(new MathWidget('x', true, 'block'))).toBe(true)
    expect(new MathWidget('x', true, 'block').eq(new MathWidget('x', true, 'preview'))).toBe(false)
    expect(new MathWidget('x', false).eq(new MathWidget('y', false))).toBe(false)
  })
})
