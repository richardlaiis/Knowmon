// Graph edge types: display names and filter preferences (localStorage)
import type { LinkType } from '../../shared/types'

export const EDGE_TYPES: { type: LinkType; label: string; title: string }[] = [
  { type: 'wikilink', label: 'Links', title: '[[Wikilinks]] written in notes' },
  { type: 'same_session', label: 'Session', title: 'Edited in the same work session' },
  { type: 'same_day', label: 'Same day', title: 'Event dates on the same (or a nearby) day' },
  { type: 'sequence', label: 'Sequence', title: 'Previous / next dated note in the same folder' },
  { type: 'semantic', label: 'Semantic', title: 'Similar content (local embeddings)' }
]

const ALL = EDGE_TYPES.map((t) => t.type)

/**
 * Parses the saved preference: "a,-b" means a is on and b is off. Types not mentioned default to on
 * (types added later, such as semantic in phase 5, don't appear in old preferences).
 * The old format only recorded the types that were on (no -), so existing types not mentioned count as off.
 */
export function parseEdgeTypes(raw: string | null): Set<LinkType> {
  if (raw === null) return new Set(ALL)
  const items = raw.split(',').filter(Boolean)
  const legacy = !items.some((t) => t.startsWith('-'))
  const LEGACY_TYPES: LinkType[] = ['wikilink', 'same_session', 'same_day', 'sequence']
  return new Set(
    ALL.filter((t) => {
      if (items.includes(t)) return true
      if (items.includes(`-${t}`)) return false
      return !(legacy && LEGACY_TYPES.includes(t))
    })
  )
}

export function serializeEdgeTypes(types: ReadonlySet<LinkType>): string {
  return ALL.map((t) => (types.has(t) ? t : `-${t}`)).join(',')
}

/** Reads the selected types; everything is selected when there's no record or it can't be read */
export function loadEdgeTypes(key: string): Set<LinkType> {
  try {
    return parseEdgeTypes(localStorage.getItem(key))
  } catch {
    return new Set(ALL)
  }
}

export function saveEdgeTypes(key: string, types: ReadonlySet<LinkType>): void {
  try {
    localStorage.setItem(key, serializeEdgeTypes(types))
  } catch {
    // Switching still works when it can't be saved
  }
}
