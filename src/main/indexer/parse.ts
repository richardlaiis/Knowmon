// 筆記解析：frontmatter、日期、[[連結]]。純函式，不碰檔案系統與 DB。
import matter from 'gray-matter'
import { linkKey, wikilinkTarget } from '../../shared/links'

export interface WikilinkRef {
  /** 連結目標（已去掉 |顯示文字、#標題、.md） */
  target: string
  /** 1-based 行號 */
  line: number
  /** 整個 [[...]]（含 ![[ 的 !）在該行的位置，UTF-16 index */
  from: number
  to: number
}

export interface ParsedNote {
  /** 內容講的事何時發生（YYYY-MM-DD）：frontmatter date: 優先，其次是日記檔名 */
  eventDate: string | null
  frontmatter: Record<string, unknown>
  /** 全文搜尋用的內文：frontmatter 換成等量的空行，讓行號與原檔一致 */
  body: string
  links: WikilinkRef[]
}

/** 一篇筆記連到某個目標的次數（同一目標不分大小寫只算一組） */
export interface LinkCount {
  target: string
  count: number
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/
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

/** 找出所有 wikilink，略過程式碼區塊與行內程式碼 */
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

/** 依目標彙總連結次數（目標保留第一次出現的寫法） */
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

/** 把行內程式碼（`...`、``...``）換成等長空白，保留其他字元的位置 */
function maskInlineCode(line: string): string {
  if (!line.includes('`')) return line
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length))
}

function parseYaml(content: string): Record<string, unknown> {
  try {
    // 傳入 options 讓 gray-matter 不快取（它預設以內容為 key 永久快取）
    const data = matter(content, {}).data
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {} // YAML 損毀時當作沒有 frontmatter
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

/** 日記檔名：檔名以 YYYY-MM-DD 開頭（2026-10-06.md、2026-10-06 會議.md） */
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
