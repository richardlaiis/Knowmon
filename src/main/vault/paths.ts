import path from 'node:path'

export const META_DIR = '.knowmon'

/** Normalizes a relative path from the renderer and makes sure it can't escape the vault or touch hidden/metadata files. */
export function normalizeRel(rel: string): string {
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('Path must not be empty')
  const posix = rel.replace(/\\/g, '/')
  if (path.posix.isAbsolute(posix) || /^[a-zA-Z]:/.test(posix)) {
    throw new Error(`Path must be relative: ${rel}`)
  }
  const normalized = path.posix.normalize(posix).replace(/\/+$/, '')
  const parts = normalized.split('/')
  if (normalized === '.' || parts.some((p) => p === '..')) {
    throw new Error(`Path is outside the vault: ${rel}`)
  }
  if (parts.some((p) => p.startsWith('.'))) {
    throw new Error(`Hidden paths are not accessible: ${rel}`)
  }
  return normalized
}

export function resolveInVault(root: string, rel: string): string {
  return path.join(root, ...normalizeRel(rel).split('/'))
}

export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

export function isNotePath(rel: string): boolean {
  return rel.toLowerCase().endsWith('.md')
}

/** Hidden files and .knowmon aren't vault content */
export function isIgnored(rel: string): boolean {
  return rel.split('/').some((p) => p.startsWith('.'))
}

export function titleFromPath(rel: string): string {
  return path.posix.basename(rel).replace(/\.md$/i, '')
}
