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
import { ImageWidget, notePath } from './images'

/** Builds a state with ‸ marking the cursor, making sure the whole document is parsed */
function stateOf(src: string, path = 'note.md'): EditorState {
  const cursor = src.indexOf('‸')
  const doc = cursor >= 0 ? src.slice(0, cursor) + src.slice(cursor + 1) : src
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor >= 0 ? cursor : doc.length),
    extensions: [markdownSupport(), notePath.of(path)]
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

/** Turns decorations into an easy-to-compare form; the text of hide/widget is the replaced source */
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

describe('headings', () => {
  it('hides # and applies the heading style when the cursor is not on the line', () => {
    expect(hidden('# Title\n\nBody‸')).toEqual(['# '])
    expect(lineClasses('# Title\n\nBody‸')).toEqual(['# Title => cm-lp-h1'])
    expect(lineClasses('### Level three\n\n‸')).toEqual(['### Level three => cm-lp-h3'])
  })

  it('shows the raw syntax when the cursor is on the line, keeping the heading size', () => {
    expect(hidden('# Tit‸le')).toEqual([])
    expect(lineClasses('# Tit‸le')).toEqual(['# Title => cm-lp-h1'])
  })
})

describe('inline styles', () => {
  it('hides the marks of bold, italic, strikethrough and inline code once the cursor leaves', () => {
    expect(hidden('**bold** *italic* ~~struck~~ `code`\n\n‸')).toEqual([
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

  it('shows only the marks of the element the cursor is in', () => {
    expect(hidden('**bo‸ld** *italic*')).toEqual(['*', '*'])
  })

  it('adds the code style to inline code content', () => {
    const code = decos('`a + b`\n\n‸').find((d) => d.cls === 'cm-lp-code')
    expect(code?.text).toBe('a + b')
  })
})

describe('links', () => {
  it('hides [ ](url), and the link text carries the URL', () => {
    const src = 'See [the docs](https://example.com) here\n\n‸'
    expect(hidden(src)).toEqual(['[', '](https://example.com)'])
    const link = decos(src).find((d) => d.cls === 'cm-lp-link')
    expect(link?.text).toBe('the docs')
    expect(link?.attrs?.['data-url']).toBe('https://example.com')
  })

  it('shows the full syntax when the cursor is inside the link', () => {
    expect(hidden('[the ‸docs](https://example.com)')).toEqual([])
  })

  it('[[wikilink]] and [[target|alias]]', () => {
    expect(hidden('[[Welcome]] and [[Deep Work|this book]]\n\n‸')).toEqual([
      '[[',
      ']]',
      '[[Deep Work|',
      ']]'
    ])
    const links = decos('[[Deep Work|this book]]\n\n‸').filter((d) => d.cls === 'cm-lp-wikilink')
    expect(links.map((l) => [l.text, l.attrs?.['data-target']])).toEqual([
      ['this book', 'Deep Work']
    ])
  })

  it('[[ ]] inside code is not a link', () => {
    expect(
      decos('`[[not a link]]`\n\n```\n[[not one either]]\n```\n‸').some(
        (d) => d.cls === 'cm-lp-wikilink'
      )
    ).toBe(false)
  })

  it('only allows opening http(s) and mailto', () => {
    expect(isOpenableUrl('https://a.b')).toBe(true)
    expect(isOpenableUrl('mailto:a@b.c')).toBe(true)
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('blocks', () => {
  it('list markers become bullets, and task lists become checkboxes', () => {
    const d = decos('- One\n- [ ] To do\n- [x] Done\n\n‸')
    expect(d.filter((x) => x.kind === 'widget').map((x) => x.text)).toEqual(['-', '[ ]', '[x]'])
    // The - of a task item is simply hidden, without a bullet
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['- ', '- '])
    expect(d.find((x) => x.cls === 'cm-lp-task-done')?.text).toBe(' Done')
  })

  it('quotes hide > and apply the quote style', () => {
    expect(hidden('> A quote\n\n‸')).toEqual(['> '])
    expect(lineClasses('> A quote\n\n‸')).toEqual(['> A quote => cm-lp-quote'])
  })

  it('horizontal rules become a line, showing the source when the cursor is on the line', () => {
    expect(
      decos('Above\n\n---\n\nBelow‸')
        .filter((d) => d.kind === 'widget')
        .map((d) => d.text)
    ).toEqual(['---'])
    expect(decos('Above\n\n---‸\n\nBelow').filter((d) => d.kind === 'widget')).toEqual([])
  })

  it('code blocks: with the cursor outside, fences become a language label and the content is not rendered as Markdown', () => {
    const src = '```js\n# not a heading\n**x**\n```\n\n‸'
    const d = decos(src)
    expect(d.filter((x) => x.kind === 'widget').map((x) => x.text)).toEqual(['```js'])
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['```'])
    expect(lineClasses(src)).toEqual([
      '```js => cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence-hidden',
      '# not a heading => cm-lp-codeblock',
      '**x** => cm-lp-codeblock',
      '``` => cm-lp-codeblock cm-lp-codeblock-last cm-lp-fence-hidden'
    ])
  })

  it('code blocks: with the cursor inside, the fences show as written', () => {
    const src = '```js\nconst a‸ = 1\n```'
    expect(decos(src).filter((x) => x.kind === 'widget' || x.kind === 'hide')).toEqual([])
    expect(lineClasses(src)[0]).toBe('```js => cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence')
  })

  it('~~~ fences and unclosed blocks', () => {
    expect(
      decos('~~~ts\nx\n~~~\n\n‸')
        .filter((x) => x.kind === 'widget')
        .map((x) => x.text)
    ).toEqual(['~~~ts'])
    // No closing fence: only the opening is replaced, and the content isn't hidden
    expect(hidden('```\nx\n\n\n‸')).toEqual([])
  })

  it('common languages map to syntax highlighting', () => {
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
    expect(findCodeLanguage('no-such-language')).toBeNull()
    expect(findCodeLanguage('')).toBeNull()
  })
})

describe('frontmatter', () => {
  const src = '---\ntitle: Note\ndate: 2026-10-06\n---\n# Title\n‸'

  it('detects frontmatter at the start of the document', () => {
    expect(frontmatterEnd(Text.of(src.replace('‸', '').split('\n')))).toBe(
      '---\ntitle: Note\ndate: 2026-10-06\n---'.length
    )
    expect(frontmatterEnd(Text.of(['# None', '---']))).toBe(0)
    expect(frontmatterEnd(Text.of(['---', '', '---']))).toBe(8)
  })

  it('frontmatter is not rendered as a heading, and the content after it renders normally', () => {
    expect(lineClasses(src)).toEqual([
      '--- => cm-lp-frontmatter',
      'title: Note => cm-lp-frontmatter',
      'date: 2026-10-06 => cm-lp-frontmatter',
      '--- => cm-lp-frontmatter',
      '# Title => cm-lp-h1'
    ])
    expect(hidden(src)).toEqual(['# '])
  })
})

describe('toggleTask', () => {
  it('toggles [ ] and [x]', () => {
    const doc = Text.of(['- [ ] a', '- [X] b'])
    expect(toggleTask(doc, 2)).toEqual({ from: 3, to: 4, insert: 'x' })
    expect(toggleTask(doc, 10)).toEqual({ from: 11, to: 12, insert: ' ' })
    expect(toggleTask(doc, 0)).toBeNull()
  })
})

describe('images', () => {
  /** Image widget: path is the vault-relative path, replaced is the replaced source (an empty string when the cursor is on it) */
  function images(src: string, path?: string): { path: string; alt: string; replaced: string }[] {
    const state = stateOf(src, path)
    const out: { path: string; alt: string; replaced: string }[] = []
    buildDecorations(state).between(0, state.doc.length, (from, to, d) => {
      const w = (d.spec as { widget?: unknown }).widget
      if (w instanceof ImageWidget) {
        out.push({ path: w.path, alt: w.alt, replaced: state.doc.sliceString(from, to) })
      }
    })
    return out
  }

  it('replaces the whole syntax with the image when the cursor is not on it', () => {
    expect(images('Before ![Diagram](img/a.png) after\n‸')).toEqual([
      { path: 'img/a.png', alt: 'Diagram', replaced: '![Diagram](img/a.png)' }
    ])
  })

  it('keeps the raw syntax with the image after it when the cursor is on it', () => {
    expect(images('![Dia‸gram](a.png)')).toEqual([{ path: 'a.png', alt: 'Diagram', replaced: '' }])
  })

  it("relative paths are based on the note's folder, supporting <> and %20", () => {
    expect(images('![](../attachments/x.png)\n‸', 'Journal/a.md')[0].path).toBe('attachments/x.png')
    expect(images('![](<Pasted image 1.png>)\n‸', 'Journal/a.md')[0].path).toBe(
      'Journal/Pasted image 1.png'
    )
    expect(images('![](a%20b.png "Title")\n‸')[0].path).toBe('a b.png')
  })

  it('URLs, absolute paths, paths escaping the vault, ![[x]] and images in code are not rendered', () => {
    expect(images('![](https://example.com/a.png)\n‸')).toEqual([])
    expect(images('![](/home/a.png)\n‸')).toEqual([])
    expect(images('![](../a.png)\n‸', 'a.md')).toEqual([])
    expect(images('![](notes.md)\n‸')).toEqual([])
    expect(images('![[a.png]]\n‸')).toEqual([])
    expect(images('`![](a.png)`\n\n```\n![](a.png)\n```\n‸')).toEqual([])
  })
})
