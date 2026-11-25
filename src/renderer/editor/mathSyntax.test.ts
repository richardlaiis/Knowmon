import { markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownParser } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { blockMathOpen, inlineMathAt, mathMarkdown, mathSource } from './mathSyntax'

const base = markdownLanguage.parser as MarkdownParser
const dollar = base.configure([mathMarkdown()])
const brackets = base.configure([mathMarkdown({ brackets: true })])

interface Found {
  name: string
  text: string
  tex: string
  display: boolean
  closed: boolean
}

/** All InlineMath / BlockMath nodes in `src` */
function maths(src: string, parser = dollar): Found[] {
  const out: Found[] = []
  const slice = (a: number, b: number): string => src.slice(a, b)
  parser.parse(src).iterate({
    enter(ref) {
      if (ref.name !== 'InlineMath' && ref.name !== 'BlockMath') return
      out.push({ name: ref.name, text: slice(ref.from, ref.to), ...mathSource(ref.node, slice) })
      return false
    }
  })
  return out
}

/** Names of the top-level block nodes */
function blocks(src: string, parser = dollar): string[] {
  const out: string[] = []
  for (let n = parser.parse(src).topNode.firstChild; n; n = n.nextSibling) out.push(n.name)
  return out
}

describe('inlineMathAt', () => {
  const len = (text: string, b = false): number | null => inlineMathAt(text, 0, b)?.length ?? null

  it('matches $...$', () => {
    expect(len('$x^2$ rest')).toBe(5)
    expect(len('$a+b$')).toBe(5)
    expect(len('$\\frac{1}{2}$')).toBe(13)
  })

  it('needs non-space after the opener and before the closer', () => {
    expect(len('$ x$')).toBeNull()
    expect(len('$x $')).toBeNull()
    expect(len('$x $ y$')).toBeNull()
  })

  it('does not close before a digit (currency)', () => {
    expect(len('$5 and $10')).toBeNull()
    expect(len('$5, $6.')).toBeNull()
    expect(len('$x$5')).toBeNull()
    expect(len('$5-$10 and $x$')).toBeNull()
    expect(len('$5 and $10, and $x$')).toBeNull()
    expect(len('$x$ 5')).toBe(3)
  })

  it('skips escaped dollars inside', () => {
    expect(len('$a\\$b$')).toBe(6)
    expect(len('$a\\$')).toBeNull()
  })

  it('stays on one line', () => {
    expect(len('$a\nb$')).toBeNull()
    expect(len('$$a\nb$$')).toBeNull()
  })

  it('matches $$...$$ inline', () => {
    expect(inlineMathAt('$$x$$ y')).toEqual({ length: 5, open: 2, close: 2 })
    expect(len('$$ x $$')).toBe(7)
    expect(len('$$  $$')).toBeNull()
    expect(len('$$x')).toBeNull()
  })

  it('only accepts \\( and \\[ with brackets', () => {
    expect(len('\\(x\\)')).toBeNull()
    expect(len('\\(x\\)', true)).toBe(5)
    expect(len('\\[x\\]', true)).toBe(5)
    expect(len('\\( \\)', true)).toBeNull()
    expect(len('\\(a\\\\)', true)).toBeNull()
    expect(len('\\(a\\\\ b\\)', true)).toBe(9)
  })

  it('starts at the given position', () => {
    expect(inlineMathAt('ab $c$', 3)?.length).toBe(3)
  })
})

describe('blockMathOpen', () => {
  it('recognises multi-line and one-line openers', () => {
    expect(blockMathOpen('$$')).toEqual({ open: '$$', close: '$$', oneLine: false })
    expect(blockMathOpen('$$\\begin{aligned}')).toMatchObject({ oneLine: false })
    expect(blockMathOpen('$$ x^2 $$  ')).toMatchObject({ oneLine: true })
  })

  it('rejects lines that are inline math', () => {
    expect(blockMathOpen('$$a$$ and $$b$$')).toBeNull()
    expect(blockMathOpen('$$a$$ text')).toBeNull()
    expect(blockMathOpen('$$$$')).toBeNull()
    expect(blockMathOpen('$x$')).toBeNull()
  })

  it('accepts \\[ only with brackets', () => {
    expect(blockMathOpen('\\[')).toBeNull()
    expect(blockMathOpen('\\[', true)).toEqual({ open: '\\[', close: '\\]', oneLine: false })
    expect(blockMathOpen('\\[ x \\]', true)).toMatchObject({ oneLine: true })
  })
})

describe('inline math in Markdown', () => {
  it('parses $x$ and $$x$$', () => {
    expect(maths('Energy $E = mc^2$ and $$\\sum x$$.')).toEqual([
      { name: 'InlineMath', text: '$E = mc^2$', tex: 'E = mc^2', display: false, closed: true },
      { name: 'InlineMath', text: '$$\\sum x$$', tex: '\\sum x', display: true, closed: true }
    ])
  })

  it('leaves currency and escaped dollars alone', () => {
    expect(maths('It costs $5 and $10.')).toEqual([])
    expect(maths('From $5 to $10, or $x$ each')).toMatchObject([{ tex: 'x' }])
    expect(maths('Not \\$x$ math')).toEqual([])
  })

  it('code wins when it opens first, math when it opens first', () => {
    expect(maths('`$x$`')).toEqual([])
    expect(maths('$`x`$')).toMatchObject([{ tex: '`x`' }])
  })

  it('emphasis markers inside math are not emphasis', () => {
    const tree = dollar.parse('*a $b*c$')
    const names: string[] = []
    tree.iterate({ enter: (r) => void names.push(r.name) })
    expect(names).not.toContain('Emphasis')
    expect(names).toContain('InlineMath')
  })

  it('works in headings, lists and table cells', () => {
    expect(maths('# Title $x$')).toHaveLength(1)
    expect(maths('- item $y$')).toHaveLength(1)
    expect(maths('| a | b |\n| - | - |\n| $x$ | $y\\|z$ |')).toMatchObject([
      { tex: 'x' },
      { tex: 'y\\|z' }
    ])
  })

  it('does not parse \\( without brackets', () => {
    expect(maths('a \\(x\\) b')).toEqual([])
    expect(maths('a \\(x\\) b', brackets)).toMatchObject([{ tex: 'x', display: false }])
    expect(maths('a \\[x\\] b', brackets)).toMatchObject([{ tex: 'x', display: true }])
  })
})

describe('block math in Markdown', () => {
  it('parses a multi-line block', () => {
    const src = 'Text\n\n$$\na^2 + b^2\n= c^2\n$$\n\nAfter'
    expect(maths(src)).toEqual([
      {
        name: 'BlockMath',
        text: '$$\na^2 + b^2\n= c^2\n$$',
        tex: 'a^2 + b^2\n= c^2',
        display: true,
        closed: true
      }
    ])
    expect(blocks(src)).toEqual(['Paragraph', 'BlockMath', 'Paragraph'])
  })

  it('parses a one-line block', () => {
    expect(maths('$$ x^2 $$')).toMatchObject([{ name: 'BlockMath', tex: 'x^2', closed: true }])
  })

  it('closes on a line ending with $$', () => {
    const src = '$$\\begin{aligned}\nx &= 1\n\\end{aligned}$$\nnext'
    expect(maths(src)).toMatchObject([
      { tex: '\\begin{aligned}\nx &= 1\n\\end{aligned}', closed: true }
    ])
    expect(blocks(src)).toEqual(['BlockMath', 'Paragraph'])
  })

  it('keeps lines that look like other Markdown inside the block', () => {
    const src = '$$\na\n+ b\n# c\n> d\n$$'
    expect(blocks(src)).toEqual(['BlockMath'])
    expect(maths(src)[0].tex).toBe('a\n+ b\n# c\n> d')
  })

  it('an unclosed block ends at a blank line', () => {
    const src = '$$ is a lot\nof money\n\n# Heading'
    expect(maths(src)).toMatchObject([{ name: 'BlockMath', closed: false }])
    expect(blocks(src)).toEqual(['BlockMath', 'ATXHeading1'])
  })

  it('an unclosed block ends at the end of the document', () => {
    expect(maths('$$\nx')).toMatchObject([{ tex: 'x', closed: false }])
    expect(maths('$$')).toMatchObject([{ tex: '', closed: false }])
  })

  it('interrupts a paragraph', () => {
    expect(blocks('Text\n$$\nx\n$$')).toEqual(['Paragraph', 'BlockMath'])
  })

  it('a line with two inline formulas stays a paragraph', () => {
    const src = '$$a$$ and $$b$$'
    expect(blocks(src)).toEqual(['Paragraph'])
    expect(maths(src)).toMatchObject([{ name: 'InlineMath' }, { name: 'InlineMath' }])
  })

  it('indented code is not math', () => {
    expect(blocks('    $$\n    x\n    $$')).toEqual(['CodeBlock'])
  })

  it('code blocks are not math', () => {
    expect(maths('```\n$$\nx\n$$\n```')).toEqual([])
  })

  it('removes quote markers from the TeX', () => {
    const src = '> $$\n> a\n>  b\n> $$\n\nAfter'
    expect(maths(src)).toMatchObject([{ tex: 'a\n b', closed: true }])
  })

  it('ends with the quote', () => {
    const src = '> $$\n> a\nb'
    const [m] = maths(src)
    expect(m).toMatchObject({ closed: false })
    expect(m.text).toBe('$$\n> a')
  })

  it('works in a list item', () => {
    const src = '- item\n\n  $$\n  x\n  $$\n- next'
    expect(maths(src)).toMatchObject([{ tex: 'x', closed: true }])
  })

  it('parses \\[ blocks with brackets', () => {
    expect(maths('\\[\nx\n\\]', brackets)).toMatchObject([
      { name: 'BlockMath', tex: 'x', closed: true }
    ])
    expect(maths('\\[\nx\n\\]')).toEqual([])
  })
})
