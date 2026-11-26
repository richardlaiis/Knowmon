import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventsLog, movedPath, replay } from './events-log'

describe('EventsLog', () => {
  it('reads back what was appended, skipping corrupt lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-log-'))
    try {
      const log = new EventsLog(path.join(dir, 'events.jsonl'))
      expect(log.readAll()).toEqual([])
      log.append({ ts: 1, kind: 'create', path: 'a.md' })
      fs.appendFileSync(log.file, '{"ts":2,"kind":"ed\n')
      log.append({ ts: 3, kind: 'edit', path: 'a.md' })
      expect(log.readAll()).toEqual([
        { ts: 1, kind: 'create', path: 'a.md' },
        { ts: 3, kind: 'edit', path: 'a.md' }
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('replay', () => {
  it('rename moves history and delete clears it', () => {
    const result = replay([
      { ts: 1, kind: 'create', path: 'a.md' },
      { ts: 2, kind: 'edit', path: 'a.md' },
      { ts: 3, op: 'rename', from: 'a.md', to: 'b.md' },
      { ts: 4, kind: 'open', path: 'b.md' },
      { ts: 5, kind: 'create', path: 'c.md' },
      { ts: 6, op: 'delete', path: 'c.md' },
      { ts: 7, kind: 'create', path: 'c.md' }
    ])
    expect(Object.fromEntries(result)).toEqual({
      'b.md': [
        { ts: 1, kind: 'create' },
        { ts: 2, kind: 'edit' },
        { ts: 4, kind: 'open' }
      ],
      'c.md': [{ ts: 7, kind: 'create' }]
    })
  })

  it('renaming and deleting a folder affects every note under it', () => {
    const result = replay([
      { ts: 1, kind: 'create', path: 'Projects/a.md' },
      { ts: 2, kind: 'create', path: 'Projects/sub/b.md' },
      { ts: 3, kind: 'create', path: 'Projects-outside.md' },
      { ts: 4, op: 'rename', from: 'Projects', to: 'Archive/Projects' },
      { ts: 5, op: 'delete', path: 'Archive/Projects/sub' }
    ])
    expect([...result.keys()].sort()).toEqual(['Archive/Projects/a.md', 'Projects-outside.md'])
  })
})

describe('movedPath', () => {
  it('matches only whole path segments', () => {
    expect(movedPath('a/b.md', 'a', 'x')).toBe('x/b.md')
    expect(movedPath('ab/b.md', 'a', 'x')).toBeNull()
    expect(movedPath('a', 'a', 'x')).toBe('x')
  })
})
