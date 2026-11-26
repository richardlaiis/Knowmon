// Images in notes (pure functions, shared by main and renderer).
// Images in the vault are served to the renderer through the custom protocol knowmon-asset://; notes only support paths relative to the note.

export const ASSET_SCHEME = 'knowmon-asset'
const ASSET_ORIGIN = `${ASSET_SCHEME}://vault/`

/** Folder for pasted images (at the vault root) */
export const ATTACHMENTS_DIR = 'attachments'

/** Size limit for a single pasted image */
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

/** The MIME type for a file extension, or null when it isn't a supported image */
export function imageMime(path: string): string | null {
  return IMAGE_TYPES[extensionOf(path)] ?? null
}

/** Vault-relative path → URL for the renderer */
export function assetUrl(rel: string): string {
  return ASSET_ORIGIN + rel.split('/').map(encodeURIComponent).join('/')
}

/** URL → vault-relative path; null when it isn't a knowmon-asset URL (main must still check the path) */
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

/** Normalizes a posix path; null when it escapes the vault root */
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
 * The URL in a note's image syntax → vault-relative path. Only paths relative to the note are accepted:
 * URLs, absolute paths, paths escaping the vault, hidden files and non-images return null. Both `<a b.png>` and `%20` are recognized.
 */
export function resolveImageSrc(notePath: string, src: string): string | null {
  let s = src.trim()
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.includes('\\')) return null
  try {
    s = decodeURIComponent(s)
  } catch {
    // Not valid percent-encoding, so use the text as is
  }
  const folder = folderOf(notePath)
  const rel = normalize(folder ? `${folder}/${s}` : s)
  if (!rel || rel.split('/').some((p) => p.startsWith('.'))) return null
  return imageMime(rel) ? rel : null
}

/** Relative path from the note's folder to target */
export function relativeToNote(notePath: string, target: string): string {
  const from = folderOf(notePath).split('/').filter(Boolean)
  const to = target.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}

/** Image syntax to insert into a note; the path is wrapped in <> when it contains spaces or parentheses */
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
 * The file name for a pasted or dropped image. Clipboard screenshots have no name (Chromium always calls them image.png),
 * so they become "Pasted image <time>"; when the extension isn't an image, one is added from the MIME type.
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
 * Cleans a file name before saving: strips the path, characters the file system doesn't allow, and % and #, which break Markdown URLs.
 * Throws for unsupported image formats.
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
