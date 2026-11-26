import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { SyntaxNode } from '@lezer/common'
import { buildDecorations, markdownSupport } from './livePreview'
import { notePath } from './images'
import {
  type TableModel,
  TableWidget,
  parseTable,
  renderedTables,
  tableDecorations
} from './tables'

/** Builds a state with ‸ marking the cursor (or two ‸ marking a selection), making sure the whole document is parsed */
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

function modelOf(src: string): TableModel {
  const state = stateOf(src)
  let table: SyntaxNode | null = null
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name === 'Table') table = n
  }
  if (!table) throw new Error('No table')
  return parseTable(state, table)
}

/** The plain text of each cell */
const texts = (m: TableModel): string[][] =>
  [m.header, ...m.rows].map((r) => r.map((c) => c.spans.map((s) => s.text).join('')))

/** The source replaced by the table widget */
function widgets(src: string): string[] {
  const state = stateOf(src)
  const out: string[] = []
  tableDecorations(state).between(0, state.doc.length, (from, to, d) => {
    expect(d.spec.widget).toBeInstanceOf(TableWidget)
    expect(d.spec.block).toBe(true)
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

const TABLE = '| Name | Count |\n| --- | ---: |\n| Apples | 3 |'

describe('parseTable', () => {
  it('header, body and alignment', () => {
    const m = modelOf('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n\n‸')
    expect(m.align).toEqual(['left', 'center', 'right', null])
    expect(texts(m)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['1', '2', '3', '4']
    ])
  })

  it('works without leading and trailing |', () => {
    expect(texts(modelOf('a | b\n--|--\n1 | 2\n\n‸'))).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('the header sets the column count: short rows are padded, long rows are cut', () => {
    const m = modelOf('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| | x | |\n\n‸')
    expect(texts(m)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['1', '2', '3'],
      ['', 'x', '']
    ])
  })

  it('\\| unescapes to |', () => {
    expect(texts(modelOf('| a |\n|---|\n| x \\| y |\n\n‸'))[1]).toEqual(['x | y'])
  })

  it('inline styles become spans, with marks hidden', () => {
    const m = modelOf(
      '| a |\n|---|\n| **bold** *italic* ~~struck~~ `code` |\n| [text](https://example.com) |\n\n‸'
    )
    expect(m.rows[0][0].spans).toEqual([
      { text: 'bold', bold: true },
      { text: ' ' },
      { text: 'italic', italic: true },
      { text: ' ' },
      { text: 'struck', strike: true },
      { text: ' ' },
      { text: 'code', code: true }
    ])
    expect(m.rows[1][0].spans).toEqual([{ text: 'text', url: 'https://example.com' }])
  })

  it('wikilinks (the | of a label must be written \\| in a table); not inside code', () => {
    const m = modelOf('| a |\n|---|\n| See [[Note A]] and [[b/c\\|C]] |\n| `[[x]]` |\n\n‸')
    expect(m.rows[0][0].spans).toEqual([
      { text: 'See ' },
      { text: 'Note A', target: 'Note A' },
      { text: ' and ' },
      { text: 'C', target: 'b/c' }
    ])
    expect(m.rows[1][0].spans).toEqual([{ text: '[[x]]', code: true }])
  })

  it('math becomes a math span (\\| restored to |); adjacent formulas are not merged, and [[ ]] inside is not a link', () => {
    const m = modelOf('| a |\n|---|\n| Length $\\|v\\|$ and $$x$$ |\n| $a$$b$ |\n| $[[x]]$ |\n\n‸')
    expect(m.rows[0][0].spans).toEqual([
      { text: 'Length ' },
      { text: '|v|', math: 'inline' },
      { text: ' and ' },
      { text: 'x', math: 'display' }
    ])
    expect(m.rows[1][0].spans).toEqual([
      { text: 'a', math: 'inline' },
      { text: 'b', math: 'inline' }
    ])
    expect(m.rows[2][0].spans).toEqual([{ text: '[[x]]', math: 'inline' }])
  })

  it("cell positions are relative to the start of the table's first line", () => {
    const src = 'Intro\n\n| a | bb |\n|---|---|\n| x |  |\n\n‸'
    const m = modelOf(src)
    const doc = src.replace('‸', '')
    const base = doc.indexOf('| a')
    expect(doc[base + m.header[1].offset]).toBe('b')
    expect(doc[base + m.rows[0][0].offset]).toBe('x')
    // An empty cell: placed after the | and one space
    expect(doc.slice(base + m.rows[0][1].offset - 2, base + m.rows[0][1].offset)).toBe('| ')
  })
})

describe('table decorations', () => {
  it('cursor outside the table: the whole table (full lines) becomes a table', () => {
    expect(widgets(`Intro\n\n${TABLE}\n\nOutro‸`)).toEqual([TABLE])
    expect(widgets(`‸Intro\n\n${TABLE}`)).toEqual([TABLE])
  })

  it('cursor in the table, at a line start or end, or a selection reaching into it: shows the source', () => {
    expect(widgets(`Intro\n\n| Na‸me | Count |\n| --- | ---: |\n| Apples | 3 |`)).toEqual([])
    expect(widgets(`Intro\n\n${TABLE}‸\n\nOutro`)).toEqual([])
    expect(widgets(`Intro\n\n‸${TABLE}\n\nOutro`)).toEqual([])
    expect(widgets(`Int‸ro\n\n| Name‸ | Count |\n| --- | ---: |\n| Apples | 3 |`)).toEqual([])
  })

  it('with two tables, only the one with the cursor expands', () => {
    const second = '| x |\n|---|\n| y |'
    expect(widgets(`${TABLE}\n\n| ‸x |\n|---|\n| y |`)).toEqual([TABLE])
    expect(widgets(`${TABLE}\n\n${second}\n\n‸`)).toEqual([TABLE, second])
  })

  it('tables in quotes, lists or frontmatter, and ones without a delimiter row, are not rendered', () => {
    expect(widgets('> | a |\n> |---|\n> | 1 |\n\n‸')).toEqual([])
    expect(widgets('- Item\n\n  | a |\n  |---|\n  | 1 |\n\n‸')).toEqual([])
    expect(widgets('---\n| a |\n|---|\n---\n\n‸')).toEqual([])
    expect(widgets('| a | b |\n| 1 | 2 |\n\n‸')).toEqual([])
  })

  it('table widgets with the same source are equal (no DOM rebuild)', () => {
    const a = renderedTables(stateOf(`${TABLE}\n\n‸`))
    const b = renderedTables(stateOf(`${TABLE}\n\nOther‸`))
    const wa = new TableWidget(TABLE, parseTable(stateOf(`${TABLE}\n\n‸`), a[0].node))
    const wb = new TableWidget(TABLE, parseTable(stateOf(`${TABLE}\n\nOther‸`), b[0].node))
    expect(wa.eq(wb)).toBe(true)
  })

  it('live rendering produces no other decorations for replaced tables', () => {
    const src = '| **a** | [[b]] |\n|---|---|\n| `c` | d |\n\n‸'
    const state = stateOf(src)
    let count = 0
    buildDecorations(state).between(0, state.doc.length, () => {
      count++
    })
    expect(count).toBe(0)
    // Inline styles render as usual when the cursor enters the table
    const inside = stateOf('| **a** | [[b]] |\n|---|---|\n| `c` | d‸ |\n\n')
    let n = 0
    buildDecorations(inside).between(0, inside.doc.length, () => {
      n++
    })
    expect(n).toBeGreaterThan(0)
  })
})
