import type { Backlink } from '../../../shared/types'

export interface BacklinkGroup {
  path: string
  title: string
  items: Backlink[]
}

/** 依來源筆記分組，保留原本的順序 */
export function groupBacklinks(links: readonly Backlink[]): BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup>()
  for (const l of links) {
    const g = groups.get(l.path) ?? { path: l.path, title: l.title, items: [] }
    g.items.push(l)
    groups.set(l.path, g)
  }
  return [...groups.values()]
}
