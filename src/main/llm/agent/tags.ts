// 在 frontmatter 的 tags: 加上標籤。只改 tags 那幾行，其他 frontmatter 一字不動
// （不用 gray-matter 重新輸出，避免改掉使用者的格式與註解）。純函式。
import matter from 'gray-matter'
import { FRONTMATTER } from '../../indexer/parse'

export interface TagEdit {
  content: string
  /** 實際加上的標籤（已存在的不算） */
  added: string[]
  /** 修改前後的 frontmatter 區塊；原本沒有 frontmatter 時 before 為空字串 */
  before: string
  after: string
}

/** 標籤正規化：去掉開頭的 #、前後空白，中間的空白換成 -；不合法時為空字串 */
export function normalizeTag(tag: string): string {
  return tag.normalize('NFC').trim().replace(/^#+/, '').trim().replace(/\s+/g, '-')
}

const tagKey = (t: string): string => normalizeTag(t).toLowerCase()

/** frontmatter 中已有的標籤（tags: [a, b]、清單、或以逗號／空白分隔的字串） */
export function existingTags(data: Record<string, unknown>): string[] {
  const v = data.tags
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []
  return list.filter((t) => t !== null && t !== undefined).map((t) => normalizeTag(String(t)))
}

/** YAML 中需要加引號的標籤 */
function yamlScalar(tag: string): string {
  const plain =
    !/[,[\]{}:#'"&*!|>%@`]/.test(tag) &&
    !/^[-?]/.test(tag) &&
    !/^(?:true|false|null|yes|no|on|off|~|[-+]?[\d.]+(?:e[-+]?\d+)?)$/i.test(tag)
  return plain ? tag : JSON.stringify(tag)
}

const flow = (tags: readonly string[]): string => `[${tags.map(yamlScalar).join(', ')}]`

/**
 * 加上標籤。全部已存在時回傳原內容、added 為空。
 * frontmatter 不是合法的 YAML 時丟出錯誤（不修改）。
 */
export function addTags(content: string, tags: readonly string[]): TagEdit {
  const fm = FRONTMATTER.exec(content)
  let data: Record<string, unknown> = {}
  if (fm) {
    try {
      // 傳入 options 讓 gray-matter 不快取
      const d = matter(content, {}).data
      data = d && typeof d === 'object' ? d : {}
    } catch {
      throw new Error('The frontmatter of this note is not valid YAML; fix it before adding tags.')
    }
  }
  const have = existingTags(data)
  const seen = new Set(have.map(tagKey))
  const added: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    if (!n || seen.has(tagKey(n))) continue
    seen.add(tagKey(n))
    added.push(n)
  }
  const before = fm ? fm[0] : ''
  if (added.length === 0) return { content, added, before, after: before }

  if (!fm) {
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    const after = `---${eol}tags: ${flow(added)}${eol}---${eol}`
    return { content: after + content, added, before, after }
  }

  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  const lines = before.split(/\r?\n/)
  // 最後一個元素是結尾 --- 之後的空字串（或沒有換行時的 ---）
  const close = lines.length - 1 - [...lines].reverse().findIndex((l) => /^---[ \t]*$/.test(l))
  const key = lines.findIndex((l, i) => i > 0 && i < close && /^tags[ \t]*:/.test(l))
  if (key < 0) {
    lines.splice(close, 0, `tags: ${flow(added)}`)
  } else {
    // tags 這一項的範圍：之後縮排或以 - 開頭的行
    let end = key + 1
    while (end < close && /^(?:[ \t]+\S|-(?:[ \t]|$))/.test(lines[end])) end++
    const value = lines[key].replace(/^tags[ \t]*:/, '')
    // 多行 flow 清單：結尾的 ] 可能在第 0 欄
    if (/^[ \t]*\[[^\]]*$/.test(value)) {
      const j = lines.findIndex((l, i) => i > key && i < close && l.includes(']'))
      if (j >= 0) end = Math.max(end, j + 1)
    }
    const inline = /^[ \t]*\[(.*)\][ \t]*(#.*)?$/.exec(value)
    const items = lines.slice(key + 1, end)
    if (inline && end === key + 1) {
      // tags: [a, b] → 在 ] 前面加
      const inner = inline[1].trim()
      const list = added.map(yamlScalar).join(', ')
      const comment = inline[2] ? ` ${inline[2]}` : ''
      lines[key] = `tags: [${inner ? `${inner.replace(/,\s*$/, '')}, ${list}` : list}]${comment}`
    } else if (/^[ \t]*(#.*)?$/.test(value) && items.length > 0 && items.every(isListItem)) {
      // 區塊清單：照最後一項的縮排加在後面
      const indent = /^([ \t]*)-/.exec(items[items.length - 1])![1]
      lines.splice(end, 0, ...added.map((t) => `${indent}- ${yamlScalar(t)}`))
    } else {
      // 單一字串、空值、多行 flow 等：整項改寫成 tags: [...]
      lines.splice(key, end - key, `tags: ${flow([...have, ...added])}`)
    }
  }
  const after = lines.join(eol)
  return { content: after + content.slice(before.length), added, before, after }
}

const isListItem = (l: string): boolean => /^[ \t]*-(?:[ \t]|$)/.test(l) || /^[ \t]*#/.test(l)
