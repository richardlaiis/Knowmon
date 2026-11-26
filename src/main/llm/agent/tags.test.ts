import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import { addTags, normalizeTag } from './tags'

const tagsOf = (content: string): unknown => matter(content, {}).data.tags

describe('addTags', () => {
  it('adds frontmatter at the top when there is none', () => {
    const r = addTags('# Title\nbody\n', ['review'])
    expect(r.content).toBe('---\ntags: [review]\n---\n# Title\nbody\n')
    expect(r.before).toBe('')
    expect(r.after).toBe('---\ntags: [review]\n---\n')
    expect(r.added).toEqual(['review'])
  })

  it('flow style: adds before ], keeping the existing order and other fields', () => {
    const src = '---\ndate: 2026-10-06\ntags: [journal, dev]\nmood: good # comment\n---\nbody'
    const r = addTags(src, ['review'])
    expect(r.content).toBe(
      '---\ndate: 2026-10-06\ntags: [journal, dev, review]\nmood: good # comment\n---\nbody'
    )
    expect(tagsOf(r.content)).toEqual(['journal', 'dev', 'review'])
  })

  it('an empty flow list', () => {
    expect(addTags('---\ntags: []\n---\n', ['a']).content).toBe('---\ntags: [a]\n---\n')
  })

  it('block list: adds after the last item with the same indentation', () => {
    const src = '---\ntags:\n  - book\n  - habits\ntitle: x\n---\n'
    const r = addTags(src, ['review', 'reading'])
    expect(r.content).toBe(
      '---\ntags:\n  - book\n  - habits\n  - review\n  - reading\ntitle: x\n---\n'
    )
    expect(tagsOf(r.content)).toEqual(['book', 'habits', 'review', 'reading'])
  })

  it('a block list without indentation', () => {
    const r = addTags('---\ntags:\n- a\n---\n', ['b'])
    expect(r.content).toBe('---\ntags:\n- a\n- b\n---\n')
  })

  it('a single string becomes a flow list', () => {
    const r = addTags('---\ntags: book\n---\n', ['review'])
    expect(r.content).toBe('---\ntags: [book, review]\n---\n')
  })

  it('an empty value becomes a flow list', () => {
    expect(addTags('---\ntags:\n---\n', ['a']).content).toBe('---\ntags: [a]\n---\n')
  })

  it('a multi-line flow list is rewritten whole', () => {
    const r = addTags('---\ntags: [\n  a,\n  b\n]\nx: 1\n---\n', ['c'])
    expect(r.content).toBe('---\ntags: [a, b, c]\nx: 1\n---\n')
  })

  it('frontmatter without tags: adds before the closing ---', () => {
    const r = addTags('---\ndate: 2026-10-06\n---\nbody', ['journal'])
    expect(r.content).toBe('---\ndate: 2026-10-06\ntags: [journal]\n---\nbody')
  })

  it('empty frontmatter', () => {
    expect(addTags('---\n---\nx', ['a']).content).toBe('---\ntags: [a]\n---\nx')
  })

  it('existing tags are not duplicated (case-insensitive, # prefix)', () => {
    const r = addTags('---\ntags: [Book, Habits]\n---\n', ['#book', 'habits', 'new', 'new'])
    expect(r.added).toEqual(['new'])
    expect(r.content).toBe('---\ntags: [Book, Habits, new]\n---\n')
  })

  it('no change when every tag already exists', () => {
    const src = '---\ntags: [a]\n---\n'
    const r = addTags(src, ['A', '#a'])
    expect(r.added).toEqual([])
    expect(r.content).toBe(src)
    expect(r.after).toBe(r.before)
  })

  it('keeps CRLF', () => {
    const r = addTags('---\r\ntitle: x\r\n---\r\nbody\r\n', ['a'])
    expect(r.content).toBe('---\r\ntitle: x\r\ntags: [a]\r\n---\r\nbody\r\n')
  })

  it('quotes special characters and numbers, which still parse back as strings', () => {
    const r = addTags('---\ntags: [a]\n---\n', ['c++: notes', '2026', 'true'])
    expect(tagsOf(r.content)).toEqual(['a', 'c++:-notes', '2026', 'true'])
  })

  it('refuses to modify corrupt frontmatter', () => {
    expect(() => addTags('---\ntags: [a\nb: : :\n---\n', ['x'])).toThrow(/not valid YAML/)
  })

  it('tags: in the body is unaffected', () => {
    const src = '---\ntitle: x\n---\ntags: this is the body\n'
    expect(addTags(src, ['a']).content).toBe(
      '---\ntitle: x\ntags: [a]\n---\ntags: this is the body\n'
    )
  })
})

describe('normalizeTag', () => {
  it('strips # and replaces spaces with -', () => {
    // CJK tags work the same way
    expect(normalizeTag('  #讀書 筆記 ')).toBe('讀書-筆記')
    expect(normalizeTag('#')).toBe('')
  })
})
