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
      name: 'Journal',
      path: 'Journal',
      kind: 'folder',
      children: [{ name: 'Untitled.md', path: 'Journal/Untitled.md', kind: 'file' }]
    },
    { name: 'Untitled.md', path: 'Untitled.md', kind: 'file' },
    { name: 'Untitled 1.md', path: 'Untitled 1.md', kind: 'file' }
  ]
}

describe('tree helpers', () => {
  it('parentOf', () => {
    expect(parentOf('a/b/c.md')).toBe('a/b')
    expect(parentOf('c.md')).toBe('')
  })

  it('findNode', () => {
    expect(findNode(tree, 'Journal/Untitled.md')?.kind).toBe('file')
    expect(findNode(tree, '')).toBe(tree)
    expect(findNode(tree, 'missing.md')).toBeNull()
  })

  it('newItemPath appends .md and blocks duplicate and invalid names', () => {
    const file = (folder: string): NewItem => ({ folder, kind: 'file' })
    const folder = (f: string): NewItem => ({ folder: f, kind: 'folder' })
    expect(newItemPath(tree, file(''), ' Weekly ')).toBe('Weekly.md')
    expect(newItemPath(tree, file('Journal'), 'Weekly.md')).toBe('Journal/Weekly.md')
    expect(newItemPath(tree, file('New folder'), 'Untitled')).toBe('New folder/Untitled.md')
    expect(newItemPath(tree, folder('Journal'), '2026')).toBe('Journal/2026')
    // Same name (case-insensitive): files and folders conflict with each other
    expect(() => newItemPath(tree, file(''), 'untitled')).toThrow('already exists')
    expect(() => newItemPath(tree, folder(''), 'Journal')).toThrow('already exists')
    expect(() => newItemPath(tree, folder(''), 'Untitled.md')).toThrow('already exists')
    expect(() => newItemPath(tree, file(''), '  ')).toThrow()
    expect(() => newItemPath(tree, folder(''), 'a/b')).toThrow()
    expect(() => newItemPath(tree, file(''), '.hidden')).toThrow()
  })

  it('renamedPath keeps the folder and appends .md', () => {
    expect(renamedPath({ path: 'Journal/Untitled.md', kind: 'file' }, 'Weekly')).toBe(
      'Journal/Weekly.md'
    )
    expect(renamedPath({ path: 'Journal/Untitled.md', kind: 'file' }, 'Weekly.md')).toBe(
      'Journal/Weekly.md'
    )
    expect(renamedPath({ path: 'Journal', kind: 'folder' }, 'Diary')).toBe('Diary')
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, '  ')).toThrow()
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, 'x/y')).toThrow()
    expect(() => renamedPath({ path: 'a.md', kind: 'file' }, '.hidden')).toThrow()
  })

  it('movedInto computes the path after a drag and blocks invalid moves', () => {
    expect(movedInto('Journal/a.md', 'Projects')).toBe('Projects/a.md')
    expect(movedInto('Journal/a.md', '')).toBe('a.md')
    expect(movedInto('a.md', 'Journal/Weekly')).toBe('Journal/Weekly/a.md')
    expect(movedInto('Journal', 'Projects')).toBe('Projects/Journal')
    // Position unchanged
    expect(movedInto('Journal/a.md', 'Journal')).toBeNull()
    expect(movedInto('a.md', '')).toBeNull()
    // Dragged onto itself or one of its subfolders
    expect(movedInto('Journal', 'Journal')).toBeNull()
    expect(movedInto('Journal', 'Journal/sub')).toBeNull()
    // Same name prefix but not a subfolder
    expect(movedInto('Journal', 'Journals')).toBe('Journals/Journal')
  })

  it('remapPath and isWithin', () => {
    expect(remapPath('Journal/a.md', 'Journal', 'Diary')).toBe('Diary/a.md')
    expect(remapPath('Journals/a.md', 'Journal', 'Diary')).toBe('Journals/a.md')
    expect(isWithin('Journal/a.md', 'Journal')).toBe(true)
    expect(isWithin('Journals/a.md', 'Journal')).toBe(false)
  })

  it('errorMessage strips the IPC prefix', () => {
    const e = new Error(
      "Error invoking remote method 'notes:create': Error: A note with this name already exists: a.md"
    )
    expect(errorMessage(e)).toBe('A note with this name already exists: a.md')
  })
})
