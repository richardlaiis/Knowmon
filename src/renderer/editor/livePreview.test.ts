import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildDecorations,
  findCodeLanguage,
  frontmatterEnd,
  isOpenableUrl,
  markdownSupport,
  toggleTask
} from './livePreview'

/** 用 ‸ 標示游標位置建立 state，並確保整份文件都已解析 */
function stateOf(src: string): EditorState {
  const cursor = src.indexOf('‸')
  const doc = cursor >= 0 ? src.slice(0, cursor) + src.slice(cursor + 1) : src
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor >= 0 ? cursor : doc.length),
    extensions: [markdownSupport()]
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

interface Deco {
  kind: 'hide' | 'widget' | 'mark' | 'line'
  text: string
  cls?: string
  attrs?: Record<string, string>
}

/** 把裝飾轉成容易比對的形式；hide/widget 的 text 是被取代的原文 */
function decos(src: string): Deco[] {
  const state = stateOf(src)
  const out: Deco[] = []
  buildDecorations(state).between(0, state.doc.length, (from, to, d) => {
    const spec = d.spec as {
      widget?: unknown
      class?: string
      attributes?: Record<string, string>
    }
    const text = state.doc.sliceString(from, to)
    if (d.point && from === to)
      out.push({ kind: 'line', text: state.doc.lineAt(from).text, cls: spec.class })
    else if (spec.widget) out.push({ kind: 'widget', text })
    else if (d.point) out.push({ kind: 'hide', text })
    else out.push({ kind: 'mark', text, cls: spec.class, attrs: spec.attributes })
  })
  return out
}

const hidden = (src: string): string[] =>
  decos(src)
    .filter((d) => d.kind === 'hide')
    .map((d) => d.text)

const lineClasses = (src: string): string[] =>
  decos(src)
    .filter((d) => d.kind === 'line')
    .map((d) => `${d.text} => ${d.cls}`)

describe('標題', () => {
  it('游標不在該行時隱藏 # 並套用標題樣式', () => {
    expect(hidden('# 標題\n\n內文‸')).toEqual(['# '])
    expect(lineClasses('# 標題\n\n內文‸')).toEqual(['# 標題 => cm-lp-h1'])
    expect(lineClasses('### 三級\n\n‸')).toEqual(['### 三級 => cm-lp-h3'])
  })

  it('游標在該行時顯示原始語法，但保留標題大小', () => {
    expect(hidden('# 標‸題')).toEqual([])
    expect(lineClasses('# 標‸題')).toEqual(['# 標題 => cm-lp-h1'])
  })
})

describe('行內樣式', () => {
  it('粗體、斜體、刪除線、行內程式碼在游標離開後隱藏標記', () => {
    expect(hidden('**粗** *斜* ~~刪~~ `碼`\n\n‸')).toEqual([
      '**',
      '**',
      '*',
      '*',
      '~~',
      '~~',
      '`',
      '`'
    ])
  })

  it('游標在元素內時只顯示該元素的標記', () => {
    expect(hidden('**粗‸** *斜*')).toEqual(['*', '*'])
  })

  it('行內程式碼內容加上 code 樣式', () => {
    const code = decos('`a + b`\n\n‸').find((d) => d.cls === 'cm-lp-code')
    expect(code?.text).toBe('a + b')
  })
})

describe('連結', () => {
  it('隱藏 [ ](url)，連結文字帶有網址', () => {
    const src = '看 [文件](https://example.com) 這裡\n\n‸'
    expect(hidden(src)).toEqual(['[', '](https://example.com)'])
    const link = decos(src).find((d) => d.cls === 'cm-lp-link')
    expect(link?.text).toBe('文件')
    expect(link?.attrs?.['data-url']).toBe('https://example.com')
  })

  it('游標在連結內時顯示完整語法', () => {
    expect(hidden('[文‸件](https://example.com)')).toEqual([])
  })

  it('[[wikilink]] 與 [[目標|別名]]', () => {
    expect(hidden('[[歡迎]] 與 [[深度工作|這本書]]\n\n‸')).toEqual([
      '[[',
      ']]',
      '[[深度工作|',
      ']]'
    ])
    const links = decos('[[深度工作|這本書]]\n\n‸').filter((d) => d.cls === 'cm-lp-wikilink')
    expect(links.map((l) => [l.text, l.attrs?.['data-target']])).toEqual([['這本書', '深度工作']])
  })

  it('程式碼裡的 [[ ]] 不當作連結', () => {
    expect(
      decos('`[[不是連結]]`\n\n```\n[[也不是]]\n```\n‸').some((d) => d.cls === 'cm-lp-wikilink')
    ).toBe(false)
  })

  it('只允許開啟 http(s) 與 mailto', () => {
    expect(isOpenableUrl('https://a.b')).toBe(true)
    expect(isOpenableUrl('mailto:a@b.c')).toBe(true)
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('區塊', () => {
  it('清單符號換成圓點，待辦清單換成核取方塊', () => {
    const d = decos('- 一\n- [ ] 待辦\n- [x] 完成\n\n‸')
    expect(d.filter((x) => x.kind === 'widget').map((x) => x.text)).toEqual(['-', '[ ]', '[x]'])
    // 待辦項目的 - 直接隱藏，不顯示圓點
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['- ', '- '])
    expect(d.find((x) => x.cls === 'cm-lp-task-done')?.text).toBe(' 完成')
  })

  it('引用隱藏 > 並套用引用樣式', () => {
    expect(hidden('> 引言\n\n‸')).toEqual(['> '])
    expect(lineClasses('> 引言\n\n‸')).toEqual(['> 引言 => cm-lp-quote'])
  })

  it('分隔線換成橫線，游標在該行時顯示原文', () => {
    expect(
      decos('上\n\n---\n\n下‸')
        .filter((d) => d.kind === 'widget')
        .map((d) => d.text)
    ).toEqual(['---'])
    expect(decos('上\n\n---‸\n\n下').filter((d) => d.kind === 'widget')).toEqual([])
  })

  it('程式碼區塊：游標在外面時圍欄換成語言標籤，內容不被 Markdown 渲染', () => {
    const src = '```js\n# 不是標題\n**x**\n```\n\n‸'
    const d = decos(src)
    expect(d.filter((x) => x.kind === 'widget').map((x) => x.text)).toEqual(['```js'])
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['```'])
    expect(lineClasses(src)).toEqual([
      '```js => cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence-hidden',
      '# 不是標題 => cm-lp-codeblock',
      '**x** => cm-lp-codeblock',
      '``` => cm-lp-codeblock cm-lp-codeblock-last cm-lp-fence-hidden'
    ])
  })

  it('程式碼區塊：游標在裡面時顯示圍欄原文', () => {
    const src = '```js\nconst a‸ = 1\n```'
    expect(decos(src).filter((x) => x.kind === 'widget' || x.kind === 'hide')).toEqual([])
    expect(lineClasses(src)[0]).toBe('```js => cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence')
  })

  it('~~~ 圍欄與沒有結尾的區塊', () => {
    expect(
      decos('~~~ts\nx\n~~~\n\n‸')
        .filter((x) => x.kind === 'widget')
        .map((x) => x.text)
    ).toEqual(['~~~ts'])
    // 沒有結尾圍欄：只換掉開頭，不會隱藏內容
    expect(hidden('```\nx\n\n\n‸')).toEqual([])
  })

  it('常見語言都能對應到語法上色', () => {
    for (const name of [
      'ts',
      'typescript',
      'js',
      'tsx',
      'json',
      'css',
      'html',
      'python',
      'py',
      'bash',
      'sh',
      'rust',
      'go',
      'sql',
      'yaml',
      'java',
      'c++'
    ]) {
      expect(findCodeLanguage(name), name).not.toBeNull()
    }
    expect(findCodeLanguage('py')?.name).toBe('Python')
    expect(findCodeLanguage('ts title="a.ts"')?.name).toBe('TypeScript')
    expect(findCodeLanguage('不存在的語言')).toBeNull()
    expect(findCodeLanguage('')).toBeNull()
  })
})

describe('frontmatter', () => {
  const src = '---\ntitle: 筆記\ndate: 2026-10-06\n---\n# 標題\n‸'

  it('偵測文件開頭的 frontmatter', () => {
    expect(frontmatterEnd(Text.of(src.replace('‸', '').split('\n')))).toBe(
      '---\ntitle: 筆記\ndate: 2026-10-06\n---'.length
    )
    expect(frontmatterEnd(Text.of(['# 沒有', '---']))).toBe(0)
    expect(frontmatterEnd(Text.of(['---', '', '---']))).toBe(8)
  })

  it('frontmatter 不被當成標題渲染，之後的內容照常渲染', () => {
    expect(lineClasses(src)).toEqual([
      '--- => cm-lp-frontmatter',
      'title: 筆記 => cm-lp-frontmatter',
      'date: 2026-10-06 => cm-lp-frontmatter',
      '--- => cm-lp-frontmatter',
      '# 標題 => cm-lp-h1'
    ])
    expect(hidden(src)).toEqual(['# '])
  })
})

describe('toggleTask', () => {
  it('切換 [ ] 與 [x]', () => {
    const doc = Text.of(['- [ ] a', '- [X] b'])
    expect(toggleTask(doc, 2)).toEqual({ from: 3, to: 4, insert: 'x' })
    expect(toggleTask(doc, 10)).toEqual({ from: 11, to: 12, insert: ' ' })
    expect(toggleTask(doc, 0)).toBeNull()
  })
})
