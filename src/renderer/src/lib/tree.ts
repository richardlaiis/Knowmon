// Path helpers for the file tree (pure functions; paths are always posix paths relative to the vault)
import type { TreeNode } from '../../../shared/types'

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

export function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root
  for (const child of root.children ?? []) {
    if (path === child.path || path.startsWith(child.path + '/')) {
      const found = findNode(child, path)
      if (found) return found
    }
  }
  return null
}

/** A note or folder in the file tree whose name is being entered and that doesn't exist yet */
export interface NewItem {
  folder: string
  kind: TreeNode['kind']
}

/** Checks a name entered by the user; files get .md appended automatically */
function entryName(kind: TreeNode['kind'], input: string): string {
  const name = input.trim()
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw new Error('Name must not be empty, contain slashes, or start with "."')
  }
  return kind === 'file' && !name.toLowerCase().endsWith('.md') ? `${name}.md` : name
}

/** The full path after the user enters a new name; files get .md appended automatically */
export function renamedPath(node: Pick<TreeNode, 'path' | 'kind'>, newName: string): string {
  return joinPath(parentOf(node.path), entryName(node.kind, newName))
}

/** The path for a new item with the user's name; throws if the folder already has an item with that name (case-insensitive) */
export function newItemPath(root: TreeNode, item: NewItem, input: string): string {
  const name = entryName(item.kind, input)
  const siblings = findNode(root, item.folder)?.children ?? []
  if (siblings.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`"${name}" already exists`)
  }
  return joinPath(item.folder, name)
}

/** What an open path becomes after a note or its folder is moved; returns the original path when unaffected */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return path
}

/** The new path after dragging from into folder; null when dragged into itself or the position is unchanged */
export function movedInto(from: string, folder: string): string | null {
  if (parentOf(from) === folder || isWithin(folder, from)) return null
  return joinPath(folder, from.slice(from.lastIndexOf('/') + 1))
}

/** Whether path equals target or is inside the target folder */
export function isWithin(path: string, target: string): boolean {
  return path === target || path.startsWith(target + '/')
}

export function displayName(node: TreeNode): string {
  return node.kind === 'file' ? node.name.replace(/\.md$/i, '') : node.name
}

/** IPC error messages carry an "Error invoking remote method 'x': Error: " prefix, removed before display */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
