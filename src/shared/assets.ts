// 筆記中的圖片（純函式，main 與 renderer 共用）。
// vault 內的圖片經自訂協定 knowmon-asset:// 提供給 renderer；筆記裡只支援相對於筆記的路徑。

export const ASSET_SCHEME = 'knowmon-asset'
const ASSET_ORIGIN = `${ASSET_SCHEME}://vault/`

/** 貼上的圖片存放的資料夾（vault 根目錄） */
export const ATTACHMENTS_DIR = 'attachments'

/** 貼上的單一圖片大小上限 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

function extensionOf(name: string): string {
  const m = /\.([^./]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

/** 依副檔名取得圖片的 MIME type，不是支援的圖片時回傳 null */
export function imageMime(path: string): string | null {
  return IMAGE_TYPES[extensionOf(path)] ?? null
}

/** vault 相對路徑 → renderer 用的網址 */
export function assetUrl(rel: string): string {
  return ASSET_ORIGIN + rel.split('/').map(encodeURIComponent).join('/')
}

/** 網址 → vault 相對路徑；不是 knowmon-asset 網址時回傳 null（main 仍要再檢查路徑） */
export function assetPathFromUrl(url: string): string | null {
  if (!url.startsWith(ASSET_ORIGIN)) return null
  try {
    return url
      .slice(ASSET_ORIGIN.length)
      .split(/[?#]/)[0]
      .split('/')
      .map(decodeURIComponent)
      .join('/')
  } catch {
    return null
  }
}

/** 正規化 posix 路徑；跳出 vault 根目錄時回傳 null */
function normalize(path: string): string | null {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * 筆記中圖片語法的網址 → vault 相對路徑。只接受相對於筆記的路徑：
 * 網址、絕對路徑、跳出 vault、隱藏檔、不是圖片時回傳 null。`<a b.png>` 與 `%20` 都認得。
 */
export function resolveImageSrc(notePath: string, src: string): string | null {
  let s = src.trim()
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.includes('\\')) return null
  try {
    s = decodeURIComponent(s)
  } catch {
    // 不是合法的百分比編碼時照原文使用
  }
  const folder = folderOf(notePath)
  const rel = normalize(folder ? `${folder}/${s}` : s)
  if (!rel || rel.split('/').some((p) => p.startsWith('.'))) return null
  return imageMime(rel) ? rel : null
}

/** 從筆記所在資料夾到 target 的相對路徑 */
export function relativeToNote(notePath: string, target: string): string {
  const from = folderOf(notePath).split('/').filter(Boolean)
  const to = target.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}

/** 插入筆記的圖片語法；路徑有空白或括號時用 <> 包起來 */
export function imageMarkdown(notePath: string, target: string): string {
  const rel = relativeToNote(notePath, target)
  return /[\s()<>]/.test(rel) ? `![](<${rel}>)` : `![](${rel})`
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif'
}

/**
 * 貼上或拖進來的圖片要存的檔名。剪貼簿的截圖沒有名稱（Chromium 一律叫 image.png），
 * 改用「Pasted image 時間」；副檔名不是圖片時依 MIME type 補上。
 */
export function pastedImageName(name: string, mime: string, date: Date): string {
  const ext = MIME_EXTENSIONS[mime] ?? 'png'
  if (!name || /^image\.\w+$/i.test(name)) {
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp =
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    return `Pasted image ${stamp}.${ext}`
  }
  return imageMime(name) ? name : `${name}.${ext}`
}

/**
 * 存檔前清理檔名：去掉路徑、檔案系統不允許的字元，以及會破壞 Markdown 網址的 % 與 #。
 * 不是支援的圖片格式時丟出錯誤。
 */
export function attachmentFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[:*?"<>|%#\x00-\x1f]/g, '-')
    .trim()
    .replace(/^\.+/, '')
  if (!cleaned || !imageMime(cleaned)) throw new Error(`Not a supported image: ${name}`)
  return cleaned
}
