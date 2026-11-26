// macOS and Windows file systems are case-insensitive by default: two file names differing only in case (for example Markdown.tsx and markdown.ts)
// are fine on Linux, but on those platforms an import resolves to the wrong file. Catch them on Linux first.
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', 'out', 'dist'])

/** File or folder names in the same folder that differ only in case after removing the extension (recursive)
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
  it('has no file names differing only in case (ignoring extensions)', () => {
    expect(findCaseCollisions(root)).toEqual([])
  })
})
