import { describe, expect, it } from 'vitest'
import { countLinks, dateFromFilename, dateFromFrontmatter, extractWikilinks, parseNote } from '.'

const targets = (text: string): string[] => extractWikilinks(text).map((l) => l.target)

describe('parseNote', () => {
  it('parses frontmatter and replaces it with blank lines in the body so line numbers match', () => {
    const content =
      '---\ntitle: Atomic Habits\ndate: 2025-12-20\ntags: [book]\n---\n# Atomic Habits\nSee [[Deep Work]]'
    const p = parseNote('Books/Atomic Habits.md', content)
    expect(p.frontmatter).toMatchObject({ title: 'Atomic Habits', tags: ['book'] })
    expect(p.eventDate).toBe('2025-12-20')
    expect(p.body).toBe('\n\n\n\n\n# Atomic Habits\nSee [[Deep Work]]')
    expect(p.links).toEqual([{ target: 'Deep Work', line: 7, from: 4, to: 17 }])
  })

  it('without frontmatter the whole file is the body', () => {
    const p = parseNote('a.md', '# a\n[[b]]')
    expect(p.frontmatter).toEqual({})
    expect(p.body).toBe('# a\n[[b]]')
    expect(p.eventDate).toBeNull()
  })

  it('corrupt YAML counts as no frontmatter, but the body is still parsed', () => {
    const p = parseNote('a.md', '---\ndate: [broken\n---\n[[b]]')
    expect(p.frontmatter).toEqual({})
    expect(p.links.map((l) => l.target)).toEqual(['b'])
  })

  it('[[ ]] inside frontmatter is not a link', () => {
    const p = parseNote('a.md', '---\nrelated: "[[x]]"\n---\n[[y]]')
    expect(p.links.map((l) => l.target)).toEqual(['y'])
    expect(p.frontmatter.related).toBe('[[x]]')
  })

  it('an unclosed --- is not frontmatter', () => {
    const p = parseNote('a.md', '---\n[[a]]\nbody')
    expect(p.body).toBe('---\n[[a]]\nbody')
    expect(p.links).toHaveLength(1)
  })

  it('frontmatter date takes precedence over a journal file name', () => {
    expect(parseNote('Journal/2026-10-06.md', '---\ndate: 2026-01-02\n---\n').eventDate).toBe(
      '2026-01-02'
    )
    expect(parseNote('Journal/2026-10-06.md', 'Today').eventDate).toBe('2026-10-06')
    expect(parseNote('Journal/2026-10-06.md', '---\ndate: not a date\n---\n').eventDate).toBe(
      '2026-10-06'
    )
  })

  it('supports CRLF', () => {
    const p = parseNote('a.md', '---\r\ndate: 2026-10-01\r\n---\r\n[[b]]\r\n')
    expect(p.eventDate).toBe('2026-10-01')
    expect(p.links[0]).toMatchObject({ target: 'b', line: 4 })
  })
})

describe('extractWikilinks', () => {
  it('supports labels, headings, embeds and the .md extension', () => {
    expect(
      targets('[[a|label]] [[b#heading]] ![[c.png]] [[d.md]] [[e#heading|label]] [[ f ]]')
    ).toEqual(['a', 'b', 'c.png', 'd', 'e', 'f'])
  })

  it('[[target\\|label]] inside a table links to the target', () => {
    expect(targets('| a | [[Note\\|label]] |\n|---|---|')).toEqual(['Note'])
  })

  it('skips links only to its own heading and empty links', () => {
    expect(targets('[[#heading]] [[|x]] [[]]')).toEqual([])
  })

  it('records line and position, including the ! of an embed', () => {
    expect(extractWikilinks('First line\nBefore ![[img]] and [[Note]]')).toEqual([
      { target: 'img', line: 2, from: 7, to: 15 },
      { target: 'Note', line: 2, from: 20, to: 28 }
    ])
  })

  it('skips fenced code blocks and inline code', () => {
    const text = [
      '[[a]] `[[b]]` ``x [[c]] `` [[d]]',
      '````md',
      '[[e]]',
      '```',
      '[[f]]',
      '`````',
      '[[g]]',
      '~~~',
      '[[h]]',
      '```',
      '~~~',
      '[[i]]'
    ].join('\n')
    expect(targets(text)).toEqual(['a', 'd', 'g', 'i'])
  })

  it('an unclosed code block runs to the end of the document', () => {
    expect(targets('[[a]]\n```\n[[b]]')).toEqual(['a'])
  })

  it('does not span lines or accept nested brackets', () => {
    expect(targets('[[a\nb]] [[x[y]]')).toEqual([])
  })
})

describe('countLinks', () => {
  it('merges counts for the same target case-insensitively, keeping the first spelling', () => {
    const links = extractWikilinks('[[Note]] [[note]] [[NOTE|x]] [[Other]]')
    expect(countLinks(links)).toEqual([
      { target: 'Note', count: 3 },
      { target: 'Other', count: 1 }
    ])
  })
})

describe('dates', () => {
  it('frontmatter: YAML dates, various separators and strings with a time', () => {
    expect(dateFromFrontmatter(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026/10/1')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026.10.01')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026-10-01T09:30:00+08:00')).toBe('2026-10-01')
    expect(dateFromFrontmatter('2026-10-01 meeting')).toBe('2026-10-01')
  })

  it('frontmatter: invalid dates and other types', () => {
    expect(dateFromFrontmatter('2026-02-30')).toBeNull()
    expect(dateFromFrontmatter('2026-13-01')).toBeNull()
    expect(dateFromFrontmatter('20261001')).toBeNull()
    expect(dateFromFrontmatter(20261001)).toBeNull()
    expect(dateFromFrontmatter(new Date(NaN))).toBeNull()
    expect(dateFromFrontmatter(undefined)).toBeNull()
  })

  it('dates parsed by YAML and dates with a time', () => {
    expect(parseNote('a.md', '---\ndate: 2026-10-01\n---\n').eventDate).toBe('2026-10-01')
    expect(parseNote('a.md', '---\ndate: 2026-10-01 10:00:00\n---\n').eventDate).toBe('2026-10-01')
    expect(parseNote('a.md', "---\ndate: '2026/10/01'\n---\n").eventDate).toBe('2026-10-01')
  })

  it('journal file names', () => {
    expect(dateFromFilename('Journal/2026-10-06.md')).toBe('2026-10-06')
    expect(dateFromFilename('2026-10-06 meeting.md')).toBe('2026-10-06')
    expect(dateFromFilename('2026-10-061.md')).toBeNull()
    expect(dateFromFilename('2026-02-30.md')).toBeNull()
    expect(dateFromFilename('meeting 2026-10-06.md')).toBeNull()
    expect(dateFromFilename('2026-10-06/note.md')).toBeNull()
  })
})
