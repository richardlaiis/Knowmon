// Cytoscape 樣式。顏色取自 main.css 的 CSS 變數，切換主題時重新產生。
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
    sequence: v('--edge-sequence', '#2563eb')
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
        // 縮小到字太小時不畫標籤（大型圖譜的主要效能來源之一）
        'min-zoomed-font-size': 9
      }
    },
    {
      selector: 'edge',
      style: {
        // haystack 是 Cytoscape 最快的邊（直線、無箭頭）
        'curve-style': 'haystack',
        'haystack-radius': 0,
        width: 'mapData(weight, 1, 5, 1, 2.5)',
        // --border 在縮小時太淡，改用 --muted 加透明度
        'line-color': c.muted,
        opacity: 0.35
      }
    },
    // 時間邊：顏色與線型區分類型（haystack 不支援箭頭，sequence 的方向不畫出來）
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
    { selector: 'node.current', style: { 'background-color': c.accent, 'font-weight': 'bold' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.highlight', style: { 'background-color': c.accent, label: 'data(title)' } },
    { selector: 'edge.highlight', style: { 'line-color': c.accent, opacity: 1 } },
    { selector: 'node:grabbed', style: { 'background-color': c.accent } },
    { selector: 'node.hidden', style: { display: 'none' } }
  ]
}
