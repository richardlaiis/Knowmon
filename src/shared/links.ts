// wikilink 目標 → 筆記路徑的解析規則。main（建立 links 表）與 renderer（點擊連結、自動補全）共用，
// 確保兩邊對同一個 [[目標]] 得到同一篇筆記。
// 規則：不分大小寫；目標含 / 時比對路徑結尾，否則比對檔名；多篇符合時取路徑最短者，再依字典序。

/** 比對用的鍵：去掉 .md、統一 Unicode 正規化（macOS 檔名是 NFD）與大小寫 */
export function linkKey(target: string): string {
  return target.trim().replace(/\.md$/i, '').normalize('NFC').toLowerCase()
}

/** [[目標#標題|顯示]] 括號內的文字 → 目標；只有 #標題（連到自己）時回傳空字串 */
export function wikilinkTarget(inner: string): string {
  return inner.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '').trim()
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

function byPreference(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

export type LinkResolver = (target: string) => string | null

/** 依目前所有筆記路徑建立解析器（筆記多時比逐次呼叫 resolveLink 快） */
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

/** 連到 path 時要寫的最短目標：通常就是檔名，同名時逐層加上資料夾直到能唯一解析 */
export function linkTextFor(path: string, resolve: LinkResolver): string {
  const parts = path.replace(/\.md$/i, '').split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    const text = parts.slice(i).join('/')
    if (resolve(text) === path) return text
  }
  return parts.join('/')
}
