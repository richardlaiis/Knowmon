import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import {
  errorMessage,
  findNode,
  isWithin,
  movedInto,
  parentOf,
  newItemPath,
  remapPath,
  renamedPath,
  type NewItem
} from './tree'

const tree: TreeNode = {
  name: 'vault',
  path: '',
  kind: 'folder',
  children: [
    {
      name: '日記',
      path: '日記',
      kind: 'folder',
      children: [{ name: 'Untitled.md', path: '日記/Untitled.md', kind: 'file' }]
    },
    { name: 'Untitled.md', path: 'Untitled.md', kind: 'file' },
    { name: 'Untitled 1.md', path: 'Untitled 1.md', kind: 'file' }
  ]
}

describe('tree 工具', () => {
  it('parentOf', () => {
    expect(parentOf('a/b/c.md')).toBe('a/b')
    expect(parentOf('c.md')).toBe('')
  })

  it('findNode', () => {
    expect(findNode(tree, '日記/Untitled.md')?.kind).toBe('file')
    expect(findNode(tree, '')).toBe(tree)
    expect(findNode(tree, '不存在.md')).toBeNull()
  })

  it('newItemPath 補 .md、擋掉同名與無效名稱', () => {
    const file = (folder: string): NewItem => ({ folder, kind: 'file' })
    const folder = (f: string): NewItem => ({ folder: f, kind: 'folder' })
    expect(newItemPath(tree, file(''), ' 週記 ')).toBe('週記.md')
    expect(newItemPath(tree, file('日記'), '週記.md')).toBe('日記/週記.md')
    expect(newItemPath(tree, file('新資料夾'), 'Untitled')).toBe('新資料夾/Untitled.md')
    expect(newItemPath(tree, folder('日記'), '2026')).toBe('日記/2026')
    // 同名（不分大小寫），檔案與資料夾互相衝突
    expect(() => newItemPath(tree, file(''), 'untitled')).toThrow('already exists')
    expect(() => newItemPath(tree, folder(''), '日記')).toThrow('already exists')
    expect(() => newItemPath(tree, folder(''), 'Untitled.md')).toThrow('already exists')
    expect(() => newItemPath(tree, file(''), '  ')).toThrow()
    expect(() => newItemPath(tree, folder(''), 'a/b')).toThrow()
    expect(() => newItemPath(tree, file(''), '.hidden')).toThrow()
  })

  it('renamedPath 保留資料夾並補 .md', () => {
    expect(renamedPath({ path: '日記/Untitled.md', kind: 'file' }, '週記')).toBe('日記/週記.md')
    expect(renamedPath({ path: '日記/Untitled.md', kind: 'file' }, '週記.md')).toBe('日記/週記.md')
    expect(renamedPath({ path: '日記', kind: 'folder' }, '日誌')).toBe('日誌')
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, '  ')).toThrow()
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, 'x/y')).toThrow()
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, '.hidden')).toThrow()
  })

  it('movedInto 算出拖曳後的路徑，擋掉無效的移動', () => {
    expect(movedInto('日記/a.md', '專案')).toBe('專案/a.md')
    expect(movedInto('日記/a.md', '')).toBe('a.md')
    expect(movedInto('a.md', '日記/週記')).toBe('日記/週記/a.md')
    expect(movedInto('日記', '專案')).toBe('專案/日記')
    // 位置沒變
    expect(movedInto('日記/a.md', '日記')).toBeNull()
    expect(movedInto('a.md', '')).toBeNull()
    // 拖到自己或自己的子資料夾
    expect(movedInto('日記', '日記')).toBeNull()
    expect(movedInto('日記', '日記/子')).toBeNull()
    // 名稱前綴相同但不是子資料夾
    expect(movedInto('日記', '日記本')).toBe('日記本/日記')
  })

  it('remapPath 與 isWithin', () => {
    expect(remapPath('日記/a.md', '日記', '日誌')).toBe('日誌/a.md')
    expect(remapPath('日記本/a.md', '日記', '日誌')).toBe('日記本/a.md')
    expect(isWithin('日記/a.md', '日記')).toBe(true)
    expect(isWithin('日記本/a.md', '日記')).toBe(false)
  })

  it('errorMessage 去掉 IPC 前綴', () => {
    const e = new Error(
      "Error invoking remote method 'notes:create': Error: A note with this name already exists: a.md"
    )
    expect(errorMessage(e)).toBe('A note with this name already exists: a.md')
  })
})
