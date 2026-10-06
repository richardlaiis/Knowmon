import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTree, listNotes } from './tree'

let root: string

function write(rel: string, content = ''): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-tree-'))
  write('b.md')
  write('a.md')
  write('筆記10.md')
  write('筆記2.md')
  write('圖片.png')
  write('日記/2026-10-06.md')
  write('.knowmon/index.db')
  write('.obsidian/x.md')
  fs.mkdirSync(path.join(root, '空資料夾'))
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('buildTree', () => {
  it('資料夾在前、依 zh-Hant 自然排序、只列 .md、略過隱藏檔', async () => {
    const tree = await buildTree(root)
    expect(tree.path).toBe('')
    expect(tree.children!.map((c) => c.path)).toEqual([
      '日記',
      '空資料夾',
      '筆記2.md',
      '筆記10.md',
      'a.md',
      'b.md'
    ])
    const diary = tree.children!.find((c) => c.path === '日記')!
    expect(diary.kind).toBe('folder')
    expect(diary.children).toEqual([
      { name: '2026-10-06.md', path: '日記/2026-10-06.md', kind: 'file' }
    ])
  })
})

describe('listNotes', () => {
  it('遞迴列出所有筆記', async () => {
    expect((await listNotes(root)).sort()).toEqual(
      ['a.md', 'b.md', '日記/2026-10-06.md', '筆記10.md', '筆記2.md'].sort()
    )
  })
})
