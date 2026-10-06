import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultChange } from '../../shared/types'
import { getNoteByPath, listEvents } from '../db'
import { EventsLog } from '../db/events-log'
import { EVENT_THROTTLE_MS, Vault } from '.'

let root: string
let clock: number
let vault: Vault | null = null

const now = (): number => clock
const abs = (rel: string): string => path.join(root, rel)
const logFile = (): string => path.join(root, '.knowmon', 'events.jsonl')

function writeExternal(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
  fs.writeFileSync(abs(rel), content)
  // 確保 mtime 一定與上次不同，不受檔案系統時間精度影響
  const t = new Date(Date.now() + Math.random() * 1e6 + 1000)
  fs.utimesSync(abs(rel), t, t)
}

async function open(opts: Parameters<typeof Vault.open>[1] = {}): Promise<Vault> {
  vault = await Vault.open(root, { now, ...opts })
  return vault
}

function kinds(v: Vault, rel: string): string[] {
  const note = getNoteByPath(v.db, rel)
  if (!note) throw new Error(`沒有索引：${rel}`)
  return listEvents(v.db, note.id).map((e) => e.kind)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-vault-'))
  clock = Date.now() + 10 * 24 * 3600_000
  writeExternal('歡迎.md', '# 歡迎\n')
  writeExternal('日記/2026-10-06.md', '今天開始寫 [[歡迎]]')
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('開啟 vault', () => {
  it('索引既有筆記，並為每篇記一筆 create', async () => {
    const v = await open()
    expect(getNoteByPath(v.db, '歡迎.md')).toMatchObject({ title: '歡迎' })
    expect(kinds(v, '歡迎.md')).toEqual(['create'])
    expect(kinds(v, '日記/2026-10-06.md')).toEqual(['create'])
    expect(fs.existsSync(path.join(root, '.knowmon', 'index.db'))).toBe(true)
    expect(new EventsLog(logFile()).readAll()).toHaveLength(2)
  })

  it('不是資料夾時報錯', async () => {
    await expect(Vault.open(abs('歡迎.md'))).rejects.toThrow()
  })

  it('關閉期間被修改的檔案在下次開啟時記 edit', async () => {
    await (await open()).close()
    writeExternal('歡迎.md', '# 歡迎\n關閉期間改的')
    const v = await open()
    expect(kinds(v, '歡迎.md')).toEqual(['create', 'edit'])
  })
})

describe('App 內操作', () => {
  it('create 建立空白筆記並通知變更，同名時報錯', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    await v.create('專案/新筆記.md')
    expect(fs.readFileSync(abs('專案/新筆記.md'), 'utf8')).toBe('')
    expect(kinds(v, '專案/新筆記.md')).toEqual(['create'])
    expect(changes).toEqual([{ type: 'add', path: '專案/新筆記.md' }])
    await expect(v.create('專案/新筆記.md')).rejects.toThrow('already exists')
    await expect(v.create('不是筆記.txt')).rejects.toThrow()
  })

  it('createFolder 建立空資料夾並通知變更', async () => {
    const v = await open()
    const changes: VaultChange[] = []
    v.onChange((c) => changes.push(c))
    await v.createFolder('專案/子資料夾')
    expect(fs.statSync(abs('專案/子資料夾')).isDirectory()).toBe(true)
    expect(fs.readdirSync(abs('專案/子資料夾'))).toEqual([])
    expect(changes).toEqual([{ type: 'add', path: '專案/子資料夾' }])
    expect((await v.tree()).children!.map((c) => c.path)).toContain('專案')
    // 空資料夾不影響索引，reconcile 也不會回報變更
    expect(await v.reconcile()).toEqual([])

    await expect(v.createFolder('專案/子資料夾')).rejects.toThrow('Already exists')
    await expect(v.createFolder('歡迎.md')).rejects.toThrow()
    await expect(v.createFolder('../外面')).rejects.toThrow()
    await expect(v.createFolder('.hidden')).rejects.toThrow()
    expect(fs.existsSync(path.join(root, '..', '外面'))).toBe(false)
  })

  it('write 寫檔並記 edit，同類事件 60 秒內只記一次', async () => {
    const v = await open()
    await v.write('歡迎.md', '一')
    clock += 1000
    await v.write('歡迎.md', '二')
    expect(fs.readFileSync(abs('歡迎.md'), 'utf8')).toBe('二')
    expect(kinds(v, '歡迎.md')).toEqual(['create', 'edit'])
    clock += EVENT_THROTTLE_MS
    await v.write('歡迎.md', '三')
    expect(kinds(v, '歡迎.md')).toEqual(['create', 'edit', 'edit'])
    expect(getNoteByPath(v.db, '歡迎.md')!.modifiedAt).toBe(
      Math.floor(fs.statSync(abs('歡迎.md')).mtimeMs)
    )
  })

  it('write 內容沒變時不寫檔', async () => {
    const v = await open()
    const before = fs.statSync(abs('歡迎.md')).mtimeMs
    await v.write('歡迎.md', '# 歡迎\n')
    expect(fs.statSync(abs('歡迎.md')).mtimeMs).toBe(before)
    expect(kinds(v, '歡迎.md')).toEqual(['create'])
  })

  it('write 到不存在的路徑會建立筆記', async () => {
    const v = await open()
    await v.write('新/檔.md', '內容')
    expect(kinds(v, '新/檔.md')).toEqual(['create', 'edit'])
  })

  it('read 回傳內容並記 open（節流）', async () => {
    const v = await open()
    expect(await v.read('日記/2026-10-06.md')).toBe('今天開始寫 [[歡迎]]')
    await v.read('日記/2026-10-06.md')
    expect(kinds(v, '日記/2026-10-06.md')).toEqual(['create', 'open'])
  })

  it('拒絕跳出 vault 或寫入 .knowmon', async () => {
    const v = await open()
    await expect(v.write('../外面.md', 'x')).rejects.toThrow()
    await expect(v.read('.knowmon/events.jsonl')).rejects.toThrow()
    expect(fs.existsSync(path.join(root, '..', '外面.md'))).toBe(false)
  })

  it('rename 保留同一個 id 與歷程', async () => {
    const v = await open()
    const id = getNoteByPath(v.db, '歡迎.md')!.id
    await v.rename('歡迎.md', '封存/首頁.md')
    expect(fs.existsSync(abs('封存/首頁.md'))).toBe(true)
    expect(fs.existsSync(abs('歡迎.md'))).toBe(false)
    expect(getNoteByPath(v.db, '封存/首頁.md')).toMatchObject({ id, title: '首頁' })
    expect(getNoteByPath(v.db, '歡迎.md')).toBeNull()
    await expect(v.rename('封存/首頁.md', '日記/2026-10-06.md')).rejects.toThrow(
      'Destination already exists'
    )
    await expect(v.rename('封存/首頁.md', '首頁.txt')).rejects.toThrow()
  })

  it('資料夾 rename 會搬移底下所有筆記', async () => {
    const v = await open()
    await v.rename('日記', '日誌')
    expect(getNoteByPath(v.db, '日誌/2026-10-06.md')).not.toBeNull()
    expect(kinds(v, '日誌/2026-10-06.md')).toEqual(['create'])
    await expect(v.rename('日誌', '日誌/子')).rejects.toThrow()
  })

  it('remove 透過 trash 刪除並清掉索引', async () => {
    const trashed: string[] = []
    const v = await open({
      trash: async (p) => {
        trashed.push(p)
        fs.rmSync(p, { recursive: true })
      }
    })
    await v.remove('日記')
    expect(trashed).toEqual([abs('日記')])
    expect(getNoteByPath(v.db, '日記/2026-10-06.md')).toBeNull()
    expect(new EventsLog(logFile()).readAll().at(-1)).toMatchObject({ op: 'delete', path: '日記' })
  })
})

describe('reconcile（外部修改）', () => {
  it('偵測外部新增、修改、刪除', async () => {
    const v = await open()
    clock += EVENT_THROTTLE_MS
    writeExternal('歡迎.md', '外部改過')
    writeExternal('外部新增.md', '新的')
    fs.rmSync(abs('日記/2026-10-06.md'))

    const changes = await v.reconcile()
    expect(changes).toEqual(
      expect.arrayContaining([
        { type: 'change', path: '歡迎.md' },
        { type: 'add', path: '外部新增.md' },
        { type: 'unlink', path: '日記/2026-10-06.md' }
      ])
    )
    expect(changes).toHaveLength(3)
    expect(kinds(v, '歡迎.md')).toEqual(['create', 'edit'])
    expect(kinds(v, '外部新增.md')).toEqual(['create'])
    expect(getNoteByPath(v.db, '日記/2026-10-06.md')).toBeNull()
  })

  it('外部改名（內容相同）視為 rename，保留歷程', async () => {
    const v = await open()
    await v.read('歡迎.md')
    const id = getNoteByPath(v.db, '歡迎.md')!.id
    fs.renameSync(abs('歡迎.md'), abs('改名後.md'))
    const changes = await v.reconcile()
    expect(changes).toEqual([
      { type: 'unlink', path: '歡迎.md' },
      { type: 'add', path: '改名後.md' }
    ])
    expect(getNoteByPath(v.db, '改名後.md')!.id).toBe(id)
    expect(kinds(v, '改名後.md')).toEqual(['create', 'open'])
  })

  it('App 自己寫入後 reconcile 不會回報變更', async () => {
    const v = await open()
    await v.write('歡迎.md', '在 App 裡改的')
    await v.create('新.md')
    expect(await v.reconcile()).toEqual([])
  })

  it('touch 但內容沒變不算 edit', async () => {
    const v = await open()
    const t = new Date(Date.now() + 5_000_000)
    fs.utimesSync(abs('歡迎.md'), t, t)
    expect(await v.reconcile()).toEqual([])
    expect(kinds(v, '歡迎.md')).toEqual(['create'])
  })
})

describe('從 events.jsonl 重建', () => {
  it('刪掉資料庫後歷程完全一致', async () => {
    let v = await open()
    clock += EVENT_THROTTLE_MS
    await v.write('歡迎.md', '改一')
    await v.read('日記/2026-10-06.md')
    await v.create('a.md')
    clock += EVENT_THROTTLE_MS
    await v.rename('a.md', '資料夾/b.md')
    await v.write('資料夾/b.md', '內容')
    await v.create('會被刪.md')
    await v.remove('會被刪.md')

    const snapshot = (x: Vault): Record<string, { ts: number; kind: string }[]> =>
      Object.fromEntries(
        ['歡迎.md', '日記/2026-10-06.md', '資料夾/b.md'].map((p) => [
          p,
          listEvents(x.db, getNoteByPath(x.db, p)!.id).map(({ ts, kind }) => ({ ts, kind }))
        ])
      )
    const before = snapshot(v)
    await v.close()
    vault = null

    for (const f of fs.readdirSync(path.join(root, '.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    const logLines = new EventsLog(logFile()).readAll().length

    v = await open()
    expect(snapshot(v)).toEqual(before)
    expect(getNoteByPath(v.db, '會被刪.md')).toBeNull()
    // 重建不應重複寫入日誌
    expect(new EventsLog(logFile()).readAll()).toHaveLength(logLines)
  })
})

describe('watcher', () => {
  it('外部修改會觸發 onChange', async () => {
    const v = await open({ watch: true, debounceMs: 50 })
    const got = new Promise<VaultChange>((resolve) => {
      v.onChange((c) => {
        if (c.type === 'change') resolve(c)
      })
    })
    // 等 chokidar 準備好
    await new Promise((r) => setTimeout(r, 300))
    writeExternal('歡迎.md', '外部編輯器寫的')
    await expect(got).resolves.toEqual({ type: 'change', path: '歡迎.md' })
  }, 10_000)
})
