// macOS 與 Windows 的檔案系統預設不分大小寫：只差大小寫的兩個檔名（例如 Markdown.tsx 與 markdown.ts）
// 在 Linux 上沒事，在那兩個平台上 import 會解析到錯的檔案。在 Linux 上先抓出來。
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', 'out', 'dist'])

/** 同一個資料夾裡，去掉副檔名後只差大小寫的檔名或資料夾名（遞迴）
 * @param {string} dir
 * @returns {string[][]} */
export function findCaseCollisions(dir) {
  const found = []
  const entries = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => !e.name.startsWith('.') && !SKIP.has(e.name)
  )
  const byKey = new Map()
  for (const e of entries) {
    const key = e.name.replace(/\.[^.]+$/, '').toLowerCase()
    const names = byKey.get(key) ?? new Set()
    names.add(e.name.replace(/\.[^.]+$/, ''))
    byKey.set(key, names)
  }
  for (const names of byKey.values()) {
    if (names.size > 1) found.push([...names].map((n) => relative(root, join(dir, n))).sort())
  }
  for (const e of entries) if (e.isDirectory()) found.push(...findCaseCollisions(join(dir, e.name)))
  return found
}

describe('case collisions', () => {
  it('沒有只差大小寫的檔名（不含副檔名）', () => {
    expect(findCaseCollisions(root)).toEqual([])
  })
})
