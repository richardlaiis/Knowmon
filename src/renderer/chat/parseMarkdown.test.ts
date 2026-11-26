import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parseMarkdown'

describe('parseMarkdown', () => {
  it('lists and inline formatting', () => {
    expect(
      parseMarkdown('- **Key point**: explanation *italic* and `code`\n- Second point')
    ).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            {
              t: 'p',
              children: [
                { t: 'strong', children: [{ t: 'text', text: 'Key point' }] },
                { t: 'text', text: ': explanation ' },
                { t: 'em', children: [{ t: 'text', text: 'italic' }] },
                { t: 'text', text: ' and ' },
                { t: 'code', text: 'code' }
              ]
            }
          ],
          [{ t: 'p', children: [{ t: 'text', text: 'Second point' }] }]
        ]
      }
    ])
  })

  it('wikilinks and aliases', () => {
    expect(
      parseMarkdown('See [[Deep Work]] and [[Books/Atomic Habits#Chapter 2|habits]].')
    ).toEqual([
      {
        t: 'p',
        children: [
          { t: 'text', text: 'See ' },
          { t: 'wikilink', target: 'Deep Work', label: 'Deep Work' },
          { t: 'text', text: ' and ' },
          { t: 'wikilink', target: 'Books/Atomic Habits', label: 'habits' },
          { t: 'text', text: '.' }
        ]
      }
    ])
  })

  it('headings, ordered list start numbers, nested lists', () => {
    const md = '## Overview\n\n3. One\n4. Two\n   - Sub-item'
    expect(parseMarkdown(md)).toEqual([
      { t: 'h', level: 2, children: [{ t: 'text', text: 'Overview' }] },
      {
        t: 'list',
        ordered: true,
        start: 3,
        items: [
          [{ t: 'p', children: [{ t: 'text', text: 'One' }] }],
          [
            { t: 'p', children: [{ t: 'text', text: 'Two' }] },
            {
              t: 'list',
              ordered: false,
              start: 1,
              items: [[{ t: 'p', children: [{ t: 'text', text: 'Sub-item' }] }]]
            }
          ]
        ]
      }
    ])
  })

  it('external links only allow http(s) and mailto', () => {
    expect(parseMarkdown('[site](https://a.b) [bad](javascript:alert(1))')).toEqual([
      {
        t: 'p',
        children: [
          { t: 'link', href: 'https://a.b', children: [{ t: 'text', text: 'site' }] },
          { t: 'text', text: ' bad' }
        ]
      }
    ])
  })

  it('code blocks, quotes, horizontal rules', () => {
    expect(parseMarkdown('```js\nlet a = 1\n```\n\n> A quote\n\n---')).toEqual([
      { t: 'code', text: 'let a = 1' },
      { t: 'quote', children: [{ t: 'p', children: [{ t: 'text', text: 'A quote' }] }] },
      { t: 'hr' }
    ])
  })

  it('half-streamed syntax is shown as text', () => {
    expect(parseMarkdown('- **unfinished')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [[{ t: 'p', children: [{ t: 'text', text: '**unfinished' }] }]]
      }
    ])
    expect(parseMarkdown('See [[Deep')).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'See [[Deep' }] }
    ])
  })

  it('math: $…$, $$…$$, \\(…\\), \\[…\\]; amounts of money are not math', () => {
    expect(
      parseMarkdown('Energy $E=mc^2$, sum $$\\sum x$$ and \\(a\\), \\[b\\]; spent $5 and $10')
    ).toEqual([
      {
        t: 'p',
        children: [
          { t: 'text', text: 'Energy ' },
          { t: 'math', tex: 'E=mc^2', display: false },
          { t: 'text', text: ', sum ' },
          { t: 'math', tex: '\\sum x', display: true },
          { t: 'text', text: ' and ' },
          { t: 'math', tex: 'a', display: false },
          { t: 'text', text: ', ' },
          { t: 'math', tex: 'b', display: true },
          { t: 'text', text: '; spent $5 and $10' }
        ]
      }
    ])
    expect(parseMarkdown('`$x$` \\$y$')).toEqual([
      {
        t: 'p',
        children: [
          { t: 'code', text: '$x$' },
          { t: 'text', text: ' $y$' }
        ]
      }
    ])
  })

  it('math blocks: $$ and \\[, also inside quotes; unclosed ones show the source while streaming', () => {
    expect(parseMarkdown('Formula:\n$$\na^2\n$$\n\n\\[\nb\n\\]\n\n> $$ c $$')).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'Formula:' }] },
      { t: 'math', tex: 'a^2' },
      { t: 'math', tex: 'b' },
      { t: 'quote', children: [{ t: 'math', tex: 'c' }] }
    ])
    expect(parseMarkdown('The result is\n\n$$\n\\frac{1}{')).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'The result is' }] },
      { t: 'p', children: [{ t: 'text', text: '$$\n\\frac{1}{' }] }
    ])
  })

  it('line breaks inside a paragraph become spaces, and HTML is shown as source', () => {
    expect(parseMarkdown('First line\nsecond line <b>x</b>')).toEqual([
      {
        t: 'p',
        children: [{ t: 'text', text: 'First line second line <b>x</b>' }]
      }
    ])
  })

  it('with citations on, [n] parses as a citation, but not inside code or wikilinks', () => {
    expect(parseMarkdown('Ran 5 km [1][2], see [[Note]].', { citations: true })).toEqual([
      {
        t: 'p',
        children: [
          { t: 'text', text: 'Ran 5 km ' },
          { t: 'cite', n: 1 },
          { t: 'cite', n: 2 },
          { t: 'text', text: ', see ' },
          { t: 'wikilink', target: 'Note', label: 'Note' },
          { t: 'text', text: '.' }
        ]
      }
    ])
    expect(parseMarkdown('`a[1]` [x]', { citations: true })).toEqual([
      {
        t: 'p',
        children: [
          { t: 'code', text: 'a[1]' },
          { t: 'text', text: ' x' }
        ]
      }
    ])
    // For summaries (option off), [1] is still a link without a URL and shows only its text
    expect(parseMarkdown('Result [1]')).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'Result 1' }] }
    ])
  })
})
