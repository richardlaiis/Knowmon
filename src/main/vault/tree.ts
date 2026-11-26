import fs from 'node:fs/promises'
import path from 'node:path'
import type { TreeNode } from '../../shared/types'
import { isNotePath } from './paths'

const collator = new Intl.Collator('zh-Hant', { numeric: true })

/** Builds the file tree: folders first, sorted by name, listing only .md and skipping hidden files. */
export async function buildTree(root: string): Promise<TreeNode> {
  return {
    name: path.basename(root),
    path: '',
    kind: 'folder',
    children: await readFolder(root, '')
  }
}

async function readFolder(root: string, rel: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  const folders: TreeNode[] = []
  const files: TreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      folders.push({
        name: e.name,
        path: childRel,
        kind: 'folder',
        children: await readFolder(root, childRel)
      })
    } else if (e.isFile() && isNotePath(e.name)) {
      files.push({ name: e.name, path: childRel, kind: 'file' })
    }
  }
  const byName = (a: TreeNode, b: TreeNode): number => collator.compare(a.name, b.name)
  return [...folders.sort(byName), ...files.sort(byName)]
}

/** Lists the relative paths of every note in the vault */
export async function listNotes(root: string, rel = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listNotes(root, childRel)))
    else if (e.isFile() && isNotePath(e.name)) out.push(childRel)
  }
  return out
}
