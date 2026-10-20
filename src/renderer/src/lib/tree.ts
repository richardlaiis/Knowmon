// 檔案樹的路徑工具（純函式，路徑一律為相對 vault 的 posix 路徑）
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

/** 檔案樹中正在輸入名稱、尚未建立的筆記或資料夾 */
export interface NewItem {
  folder: string
  kind: TreeNode['kind']
}

/** 檢查使用者輸入的名稱；檔案會自動補上 .md */
function entryName(kind: TreeNode['kind'], input: string): string {
  const name = input.trim()
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw new Error('Name must not be empty, contain slashes, or start with "."')
  }
  return kind === 'file' && !name.toLowerCase().endsWith('.md') ? `${name}.md` : name
}

/** 使用者輸入新名稱後的完整路徑；檔案會自動補上 .md */
export function renamedPath(node: Pick<TreeNode, 'path' | 'kind'>, newName: string): string {
  return joinPath(parentOf(node.path), entryName(node.kind, newName))
}

/** 以使用者輸入的名稱新增項目的路徑；資料夾中已有同名項目（不分大小寫）時丟出錯誤 */
export function newItemPath(root: TreeNode, item: NewItem, input: string): string {
  const name = entryName(item.kind, input)
  const siblings = findNode(root, item.folder)?.children ?? []
  if (siblings.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`"${name}" already exists`)
  }
  return joinPath(item.folder, name)
}

/** 筆記或其所在資料夾被搬移後，原本開著的路徑變成什麼；不受影響則回傳原路徑 */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return path
}

/** 拖曳 from 到 folder 後的新路徑；拖到自己裡面或位置沒變時回傳 null */
export function movedInto(from: string, folder: string): string | null {
  if (parentOf(from) === folder || isWithin(folder, from)) return null
  return joinPath(folder, from.slice(from.lastIndexOf('/') + 1))
}

/** path 是否等於 target 或位於 target 資料夾底下 */
export function isWithin(path: string, target: string): boolean {
  return path === target || path.startsWith(target + '/')
}

export function displayName(node: TreeNode): string {
  return node.kind === 'file' ? node.name.replace(/\.md$/i, '') : node.name
}

/** IPC 錯誤訊息會帶上 "Error invoking remote method 'x': Error: " 前綴，顯示前拿掉 */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
