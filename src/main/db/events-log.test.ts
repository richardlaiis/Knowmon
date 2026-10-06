import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventsLog, movedPath, replay } from './events-log'

describe('EventsLog', () => {
  it('append 後可讀回，略過損毀的行', () => {
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
  it('rename 搬移歷程、delete 清除歷程', () => {
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

  it('資料夾改名與刪除會影響底下所有筆記', () => {
    const result = replay([
      { ts: 1, kind: 'create', path: '專案/a.md' },
      { ts: 2, kind: 'create', path: '專案/子/b.md' },
      { ts: 3, kind: 'create', path: '專案外.md' },
      { ts: 4, op: 'rename', from: '專案', to: '封存/專案' },
      { ts: 5, op: 'delete', path: '封存/專案/子' }
    ])
    expect([...result.keys()].sort()).toEqual(['封存/專案/a.md', '專案外.md'])
  })
})

describe('movedPath', () => {
  it('只比對完整的路徑片段', () => {
    expect(movedPath('a/b.md', 'a', 'x')).toBe('x/b.md')
    expect(movedPath('ab/b.md', 'a', 'x')).toBeNull()
    expect(movedPath('a', 'a', 'x')).toBe('x')
  })
})
