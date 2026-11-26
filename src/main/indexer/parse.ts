// Note parsing: frontmatter, dates, [[links]]. Pure functions, no file system or DB access.
import matter from 'gray-matter'
import { linkKey, wikilinkTarget } from '../../shared/links'

export interface WikilinkRef {
  /** Link target (with |label, #heading and .md removed) */
  target: string
  /** 1-based line number */
  line: number
  /** Position of the whole [[...]] (including the ! of ![[) in the line, as a UTF-16 index */
  from: number
  to: number
}

export interface ParsedNote {
  /** When the events in the content happened (YYYY-MM-DD): frontmatter date: first, then a journal file name */
  eventDate: string | null
  frontmatter: Record<string, unknown>
  /** Body for full-text search: frontmatter replaced by the same number of blank lines so line numbers match the file */
  body: string
  links: WikilinkRef[]
}

/** How many times a note links to a target (the same target counts once, case-insensitively) */
export interface LinkCount {
  target: string
  count: number
}

export const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/
const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function parseNote(path: string, content: string): ParsedNote {
  const fm = FRONTMATTER.exec(content)
  const frontmatter = fm ? parseYaml(content) : {}
  const body = fm ? '\n'.repeat(countNewlines(fm[0])) + content.slice(fm[0].length) : content
  return {
    eventDate: dateFromFrontmatter(frontmatter.date) ?? dateFromFilename(path),
    frontmatter,
    body,
    links: extractWikilinks(body)
  }
}

/** Finds every wikilink, skipping code blocks and inline code */
export function extractWikilinks(text: string): WikilinkRef[] {
  const out: WikilinkRef[] = []
  let fence: string | null = null
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      if (
        f &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        !line.slice(f[0].length).trim()
      ) {
        fence = null
      }
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    for (const m of maskInlineCode(line).matchAll(WIKILINK)) {
      const target = wikilinkTarget(m[1])
      if (target) out.push({ target, line: i + 1, from: m.index, to: m.index + m[0].length })
    }
  }
  return out
}

/** Totals link counts by target (keeping the first spelling of the target) */
export function countLinks(links: readonly WikilinkRef[]): LinkCount[] {
  const byKey = new Map<string, LinkCount>()
  for (const l of links) {
    const key = linkKey(l.target)
    const c = byKey.get(key)
    if (c) c.count++
    else byKey.set(key, { target: l.target, count: 1 })
  }
  return [...byKey.values()]
}

/** Replaces inline code (`...`, ``...``) with spaces of the same length, keeping other characters' positions */
function maskInlineCode(line: string): string {
  if (!line.includes('`')) return line
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length))
}

function parseYaml(content: string): Record<string, unknown> {
  try {
    // Pass options so gray-matter doesn't cache (by default it caches forever, keyed by content)
    const data = matter(content, {}).data
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {} // Corrupt YAML counts as no frontmatter
  }
}

function countNewlines(s: string): number {
  let n = 0
  for (const ch of s) if (ch === '\n') n++
  return n
}

export function dateFromFrontmatter(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return null
  const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(value)
  return m ? validDate(m[1], m[2], m[3]) : null
}

/** Journal file names: the file name starts with YYYY-MM-DD (2026-10-06.md, 2026-10-06 會議.md) */
export function dateFromFilename(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(name)
  return m ? validDate(m[1], m[2], m[3]) : null
}

function validDate(y: string, mo: string, d: string): string | null {
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const t = new Date(Date.UTC(year, month - 1, day))
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) {
    return null
  }
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
