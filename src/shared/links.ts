// Rules for resolving a wikilink target to a note path. Shared by main (building the links table) and the renderer (clicking links, autocompletion),
// so both sides resolve the same [[target]] to the same note.
// Rules: case-insensitive; a target containing / matches the end of a path, otherwise the file name; with several matches, the shortest path wins, then lexicographic order.

/** The key used for matching: strip .md and normalize Unicode (macOS file names are NFD) and case */
export function linkKey(target: string): string {
  return target.trim().replace(/\.md$/i, '').normalize('NFC').toLowerCase()
}

/**
 * The text inside [[target#heading|label]] → the target; returns an empty string when it's only #heading (a link to itself).
 * In tables a | separates columns, so links are written [[target\|label]], and \| also counts as the separator.
 */
export function wikilinkTarget(inner: string): string {
  return inner.split(/\\?\|/)[0].split('#')[0].trim().replace(/\.md$/i, '').trim()
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

function byPreference(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

export type LinkResolver = (target: string) => string | null

/** Builds a resolver from all current note paths (faster than calling resolveLink repeatedly when there are many notes) */
export function createLinkResolver(paths: readonly string[]): LinkResolver {
  const byName = new Map<string, { path: string; key: string }[]>()
  for (const path of [...paths].sort(byPreference)) {
    const key = linkKey(path)
    const name = basename(key)
    const list = byName.get(name) ?? []
    list.push({ path, key })
    byName.set(name, list)
  }
  return (target) => {
    const key = linkKey(target).replace(/^\/+/, '')
    if (!key) return null
    const candidates = byName.get(basename(key))
    if (!candidates) return null
    if (!key.includes('/')) return candidates[0].path
    const hit = candidates.find((c) => c.key === key || c.key.endsWith('/' + key))
    return hit ? hit.path : null
  }
}

export function resolveLink(target: string, paths: readonly string[]): string | null {
  return createLinkResolver(paths)(target)
}

/** The shortest target to write when linking to path: usually just the file name, adding folders level by level on a clash until it resolves uniquely */
export function linkTextFor(path: string, resolve: LinkResolver): string {
  const parts = path.replace(/\.md$/i, '').split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    const text = parts.slice(i).join('/')
    if (resolve(text) === path) return text
  }
  return parts.join('/')
}
