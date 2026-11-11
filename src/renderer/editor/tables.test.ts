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

/** 用 ‸ 標示游標位置（或兩個 ‸ 標示選取範圍）建立 state，並確保整份文件都已解析 */
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
  if (!table) throw new Error('沒有表格')
  return parseTable(state, table)
}

/** 每格的純文字 */
const texts = (m: TableModel): string[][] =>
  [m.header, ...m.rows].map((r) => r.map((c) => c.spans.map((s) => s.text).join('')))

/** 被換成表格 widget 的原文 */
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

const TABLE = '| 名稱 | 數量 |\n| --- | ---: |\n| 蘋果 | 3 |'

describe('parseTable', () => {
  it('表頭、內容與對齊', () => {
    const m = modelOf('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n\n‸')
    expect(m.align).toEqual(['left', 'center', 'right', null])
    expect(texts(m)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['1', '2', '3', '4']
    ])
  })

  it('沒有開頭與結尾的 | 也可以', () => {
    expect(texts(modelOf('a | b\n--|--\n1 | 2\n\n‸'))).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('欄數以表頭為準：太短補空格子，太長截掉', () => {
    const m = modelOf('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| | x | |\n\n‸')
    expect(texts(m)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['1', '2', '3'],
      ['', 'x', '']
    ])
  })

  it('\\| 跳脫成 |', () => {
    expect(texts(modelOf('| a |\n|---|\n| x \\| y |\n\n‸'))[1]).toEqual(['x | y'])
  })

  it('行內樣式轉成 span，隱藏標記', () => {
    const m = modelOf(
      '| a |\n|---|\n| **粗** *斜* ~~刪~~ `碼` |\n| [文字](https://example.com) |\n\n‸'
    )
    expect(m.rows[0][0].spans).toEqual([
      { text: '粗', bold: true },
      { text: ' ' },
      { text: '斜', italic: true },
      { text: ' ' },
      { text: '刪', strike: true },
      { text: ' ' },
      { text: '碼', code: true }
    ])
    expect(m.rows[1][0].spans).toEqual([{ text: '文字', url: 'https://example.com' }])
  })

  it('wikilink（顯示文字的 | 在表格裡要寫成 \\|）；程式碼裡的不算', () => {
    const m = modelOf('| a |\n|---|\n| 見 [[筆記 A]] 與 [[b/c\\|C]] |\n| `[[x]]` |\n\n‸')
    expect(m.rows[0][0].spans).toEqual([
      { text: '見 ' },
      { text: '筆記 A', target: '筆記 A' },
      { text: ' 與 ' },
      { text: 'C', target: 'b/c' }
    ])
    expect(m.rows[1][0].spans).toEqual([{ text: '[[x]]', code: true }])
  })

  it('格子的位置相對於表格第一行的行首', () => {
    const src = '前言\n\n| a | bb |\n|---|---|\n| x |  |\n\n‸'
    const m = modelOf(src)
    const doc = src.replace('‸', '')
    const base = doc.indexOf('| a')
    expect(doc[base + m.header[1].offset]).toBe('b')
    expect(doc[base + m.rows[0][0].offset]).toBe('x')
    // 空格子：放在 | 與一個空白後面
    expect(doc.slice(base + m.rows[0][1].offset - 2, base + m.rows[0][1].offset)).toBe('| ')
  })
})

describe('表格裝飾', () => {
  it('游標在表格外：整張（整行）換成表格', () => {
    expect(widgets(`前言\n\n${TABLE}\n\n後記‸`)).toEqual([TABLE])
    expect(widgets(`‸前言\n\n${TABLE}`)).toEqual([TABLE])
  })

  it('游標在表格裡、行首行尾或選取範圍跨進表格：顯示原始碼', () => {
    expect(widgets(`前言\n\n| 名‸稱 | 數量 |\n| --- | ---: |\n| 蘋果 | 3 |`)).toEqual([])
    expect(widgets(`前言\n\n${TABLE}‸\n\n後記`)).toEqual([])
    expect(widgets(`前言\n\n‸${TABLE}\n\n後記`)).toEqual([])
    expect(widgets(`前‸言\n\n| 名稱‸ | 數量 |\n| --- | ---: |\n| 蘋果 | 3 |`)).toEqual([])
  })

  it('兩張表格只展開游標所在的那張', () => {
    const second = '| x |\n|---|\n| y |'
    expect(widgets(`${TABLE}\n\n| ‸x |\n|---|\n| y |`)).toEqual([TABLE])
    expect(widgets(`${TABLE}\n\n${second}\n\n‸`)).toEqual([TABLE, second])
  })

  it('引用、清單、frontmatter 裡的表格與沒有分隔列的不渲染', () => {
    expect(widgets('> | a |\n> |---|\n> | 1 |\n\n‸')).toEqual([])
    expect(widgets('- 項目\n\n  | a |\n  |---|\n  | 1 |\n\n‸')).toEqual([])
    expect(widgets('---\n| a |\n|---|\n---\n\n‸')).toEqual([])
    expect(widgets('| a | b |\n| 1 | 2 |\n\n‸')).toEqual([])
  })

  it('原文相同的表格 widget 視為相同（不重建 DOM）', () => {
    const a = renderedTables(stateOf(`${TABLE}\n\n‸`))
    const b = renderedTables(stateOf(`${TABLE}\n\n其他‸`))
    const wa = new TableWidget(TABLE, parseTable(stateOf(`${TABLE}\n\n‸`), a[0].node))
    const wb = new TableWidget(TABLE, parseTable(stateOf(`${TABLE}\n\n其他‸`), b[0].node))
    expect(wa.eq(wb)).toBe(true)
  })

  it('即時渲染不再對被取代的表格產生其他裝飾', () => {
    const src = '| **a** | [[b]] |\n|---|---|\n| `c` | d |\n\n‸'
    const state = stateOf(src)
    let count = 0
    buildDecorations(state).between(0, state.doc.length, () => {
      count++
    })
    expect(count).toBe(0)
    // 游標進入表格時照常渲染行內樣式
    const inside = stateOf('| **a** | [[b]] |\n|---|---|\n| `c` | d‸ |\n\n')
    let n = 0
    buildDecorations(inside).between(0, inside.doc.length, () => {
      n++
    })
    expect(n).toBeGreaterThan(0)
  })
})
