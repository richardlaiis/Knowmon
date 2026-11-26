// Adds tags to tags: in the frontmatter. Only the tags lines change, and the rest of the frontmatter is untouched
// (no re-serializing with gray-matter, which would alter the user's formatting and comments). Pure functions.
import matter from 'gray-matter'
import { FRONTMATTER } from '../../indexer/parse'

export interface TagEdit {
  content: string
  /** Tags actually added (existing ones don't count) */
  added: string[]
  /** The frontmatter block before and after the change; before is an empty string when there was no frontmatter */
  before: string
  after: string
}

/** Tag normalization: strip a leading # and surrounding whitespace, and replace inner whitespace with -; an empty string when invalid */
export function normalizeTag(tag: string): string {
  return tag.normalize('NFC').trim().replace(/^#+/, '').trim().replace(/\s+/g, '-')
}

const tagKey = (t: string): string => normalizeTag(t).toLowerCase()

/** Tags already in the frontmatter (tags: [a, b], a list, or a string separated by commas/spaces) */
export function existingTags(data: Record<string, unknown>): string[] {
  const v = data.tags
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []
  return list.filter((t) => t !== null && t !== undefined).map((t) => normalizeTag(String(t)))
}

/** Tags that need quoting in YAML */
function yamlScalar(tag: string): string {
  const plain =
    !/[,[\]{}:#'"&*!|>%@`]/.test(tag) &&
    !/^[-?]/.test(tag) &&
    !/^(?:true|false|null|yes|no|on|off|~|[-+]?[\d.]+(?:e[-+]?\d+)?)$/i.test(tag)
  return plain ? tag : JSON.stringify(tag)
}

const flow = (tags: readonly string[]): string => `[${tags.map(yamlScalar).join(', ')}]`

/**
 * Adds tags. When all already exist, returns the original content with added empty.
 * Throws (without modifying anything) when the frontmatter isn't valid YAML.
 */
export function addTags(content: string, tags: readonly string[]): TagEdit {
  const fm = FRONTMATTER.exec(content)
  let data: Record<string, unknown> = {}
  if (fm) {
    try {
      // Pass options so gray-matter doesn't cache
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
  // The last element is the empty string after the closing --- (or the --- itself when there's no trailing newline)
  const close = lines.length - 1 - [...lines].reverse().findIndex((l) => /^---[ \t]*$/.test(l))
  const key = lines.findIndex((l, i) => i > 0 && i < close && /^tags[ \t]*:/.test(l))
  if (key < 0) {
    lines.splice(close, 0, `tags: ${flow(added)}`)
  } else {
    // The extent of the tags entry: following lines that are indented or start with -
    let end = key + 1
    while (end < close && /^(?:[ \t]+\S|-(?:[ \t]|$))/.test(lines[end])) end++
    const value = lines[key].replace(/^tags[ \t]*:/, '')
    // A multi-line flow list: the closing ] may be in column 0
    if (/^[ \t]*\[[^\]]*$/.test(value)) {
      const j = lines.findIndex((l, i) => i > key && i < close && l.includes(']'))
      if (j >= 0) end = Math.max(end, j + 1)
    }
    const inline = /^[ \t]*\[(.*)\][ \t]*(#.*)?$/.exec(value)
    const items = lines.slice(key + 1, end)
    if (inline && end === key + 1) {
      // tags: [a, b] → add before ]
      const inner = inline[1].trim()
      const list = added.map(yamlScalar).join(', ')
      const comment = inline[2] ? ` ${inline[2]}` : ''
      lines[key] = `tags: [${inner ? `${inner.replace(/,\s*$/, '')}, ${list}` : list}]${comment}`
    } else if (/^[ \t]*(#.*)?$/.test(value) && items.length > 0 && items.every(isListItem)) {
      // Block list: add after the last item with its indentation
      const indent = /^([ \t]*)-/.exec(items[items.length - 1])![1]
      lines.splice(end, 0, ...added.map((t) => `${indent}- ${yamlScalar(t)}`))
    } else {
      // A single string, an empty value, a multi-line flow list and so on: rewrite the whole entry as tags: [...]
      lines.splice(key, end - key, `tags: ${flow([...have, ...added])}`)
    }
  }
  const after = lines.join(eol)
  return { content: after + content.slice(before.length), added, before, after }
}

const isListItem = (l: string): boolean => /^[ \t]*-(?:[ \t]|$)/.test(l) || /^[ \t]*#/.test(l)
