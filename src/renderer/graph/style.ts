// Cytoscape styles. Colors come from CSS variables in main.css and are regenerated when the theme changes.
import type { StylesheetJson } from 'cytoscape'
import { LABEL_FONT_SIZE, LABEL_GAP } from './labelCollide'

export interface GraphColors {
  fg: string
  muted: string
  accent: string
  border: string
  bg: string
  session: string
  day: string
  sequence: string
  semantic: string
}

export function readColors(el: Element = document.documentElement): GraphColors {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback
  return {
    fg: v('--fg', '#111'),
    muted: v('--muted', '#666'),
    accent: v('--accent', '#5b4bdb'),
    border: v('--border', '#ddd'),
    bg: v('--bg', '#fff'),
    session: v('--edge-session', '#d97706'),
    day: v('--edge-day', '#0f8a6a'),
    sequence: v('--edge-sequence', '#2563eb'),
    semantic: v('--edge-semantic', '#b0306a')
  }
}

export function graphStyle(c: GraphColors, labels: boolean): StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        width: 'data(size)',
        height: 'data(size)',
        'background-color': c.muted,
        label: labels ? 'data(title)' : '',
        color: c.fg,
        'font-size': LABEL_FONT_SIZE,
        'text-valign': 'bottom',
        'text-margin-y': LABEL_GAP,
        'text-outline-color': c.bg,
        'text-outline-width': 2,
        // Don't draw labels once zoomed out so far that the text is tiny (one of the main performance factors for large graphs)
        'min-zoomed-font-size': 9
      }
    },
    {
      selector: 'edge',
      style: {
        // haystack is Cytoscape's fastest edge (straight, no arrows)
        'curve-style': 'haystack',
        'haystack-radius': 0,
        width: 'mapData(weight, 1, 5, 1, 2.5)',
        // --border is too faint when zoomed out, so use --muted with transparency
        'line-color': c.muted,
        opacity: 0.35
      }
    },
    // Time edges: colors and line styles distinguish the types (haystack doesn't support arrows, so sequence's direction isn't drawn)
    {
      selector: 'edge[type = "same_session"]',
      style: {
        'line-color': c.session,
        'line-style': 'dashed',
        'line-dash-pattern': [6, 4],
        opacity: 0.55
      }
    },
    {
      selector: 'edge[type = "same_day"]',
      style: {
        'line-color': c.day,
        'line-style': 'dashed',
        'line-dash-pattern': [2, 3],
        opacity: 0.6
      }
    },
    { selector: 'edge[type = "sequence"]', style: { 'line-color': c.sequence, opacity: 0.5 } },
    // Semantic weights are similarities (0–1), so wikilink count widths don't apply
    {
      selector: 'edge[type = "semantic"]',
      style: { 'line-color': c.semantic, width: 1.5, opacity: 0.45 }
    },
    { selector: 'node.current', style: { 'background-color': c.accent, 'font-weight': 'bold' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.highlight', style: { 'background-color': c.accent, label: 'data(title)' } },
    { selector: 'edge.highlight', style: { 'line-color': c.accent, opacity: 1 } },
    { selector: 'node:grabbed', style: { 'background-color': c.accent } },
    { selector: 'node.hidden', style: { display: 'none' } }
  ]
}
