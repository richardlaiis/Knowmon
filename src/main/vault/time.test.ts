// Vault 的時間層：時間邊何時重算、時間參數的讀寫、DB 重建
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TIME_SETTINGS } from '../../shared/time'
import type { LinkType } from '../../shared/types'
import { Vault } from '.'

const MIN = 60_000
let root: string
let clock: number
let vault: Vault | null = null

const abs = (rel: string): string => path.join(root, rel)
const settingsFile = (): string => abs('.knowmon/settings.json')

function writeExternal(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
  fs.writeFileSync(abs(rel), content)
}

async function open(): Promise<Vault> {
  vault = await Vault.open(root, { now: () => clock })
  return vault
}

function edges(v: Vault, type: LinkType): string[] {
  return v
    .graph()
    .edges.filter((e) => e.type === type)
    .map((e) => `${e.source} – ${e.target}`)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-time-'))
  clock = new Date(2026, 9, 8, 9, 0).getTime()
  writeExternal('a.md', 'a')
  writeExternal('b.md', 'b')
  writeExternal('日記/2026-10-04.md', '')
  writeExternal('日記/2026-10-05.md', '')
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('時間邊', () => {
  it('同一段時間編輯的筆記產生 same_session 邊，隔太久的不會', async () => {
    const v = await open()
    expect(edges(v, 'same_session')).toEqual([])
    await v.write('a.md', 'a 1')
    clock += 10 * MIN
    await v.write('b.md', 'b 1')
    expect(edges(v, 'same_session')).toEqual(['a.md – b.md'])
    clock += 120 * MIN
    await v.write('日記/2026-10-04.md', '隔了兩小時')
    expect(edges(v, 'same_session')).toEqual(['a.md – b.md'])
  })

  it('event_date 改變時 same_day 與 sequence 跟著更新', async () => {
    const v = await open()
    expect(edges(v, 'sequence')).toEqual(['日記/2026-10-04.md – 日記/2026-10-05.md'])
    expect(edges(v, 'same_day')).toEqual([])
    await v.write('a.md', '---\ndate: 2026-10-05\n---\n')
    expect(edges(v, 'same_day')).toEqual(['a.md – 日記/2026-10-05.md'])
    await v.rename('a.md', '日記/a.md')
    expect(edges(v, 'sequence')).toEqual([
      '日記/2026-10-04.md – 日記/2026-10-05.md',
      '日記/2026-10-05.md – 日記/a.md'
    ])
    await v.remove('日記/2026-10-05.md')
    expect(edges(v, 'sequence')).toEqual(['日記/2026-10-04.md – 日記/a.md'])
  })

  it('外部修改（reconcile）也會更新時間邊', async () => {
    const v = await open()
    writeExternal('c.md', '---\ndate: 2026-10-04\n---\n')
    await v.reconcile()
    expect(edges(v, 'same_day')).toEqual(['c.md – 日記/2026-10-04.md'])
  })

  it('activeDays 包含建立與編輯的日期', async () => {
    const v = await open()
    clock += 24 * 60 * MIN
    await v.write('a.md', '隔天改')
    const a = v.graph().nodes.find((n) => n.path === 'a.md')!
    expect(a.activeDays.at(-1)).toBe('2026-10-09')
    expect(v.activity(clock, clock + 1)).toEqual([
      { path: 'a.md', title: 'a', ts: clock, kind: 'edit' }
    ])
  })
})

describe('時間參數', () => {
  it('預設值；修改後限制範圍、寫入 settings.json，重開 vault 仍保留', async () => {
    let v = await open()
    expect(v.getTimeSettings()).toEqual(DEFAULT_TIME_SETTINGS)
    expect(await v.setTimeSettings({ sameDayWindowDays: 99, sessionGapMinutes: 60 })).toEqual({
      ...DEFAULT_TIME_SETTINGS,
      sameDayWindowDays: 7,
      sessionGapMinutes: 60
    })
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).time.sameDayWindowDays).toBe(7)
    await v.close()
    v = await open()
    expect(v.getTimeSettings().sessionGapMinutes).toBe(60)
  })

  it('修改參數後時間邊立即重算', async () => {
    const v = await open()
    expect(edges(v, 'same_day')).toEqual([])
    await v.setTimeSettings({ sameDayWindowDays: 1 })
    expect(edges(v, 'same_day')).toEqual(['日記/2026-10-04.md – 日記/2026-10-05.md'])
  })

  it('settings.json 損毀時用預設值，寫入時保留其他欄位', async () => {
    fs.mkdirSync(abs('.knowmon'), { recursive: true })
    fs.writeFileSync(settingsFile(), '{壞掉')
    let v = await open()
    expect(v.getTimeSettings()).toEqual(DEFAULT_TIME_SETTINGS)
    await v.close()
    fs.writeFileSync(settingsFile(), JSON.stringify({ other: 1, time: { sessionMaxNotes: 5 } }))
    v = await open()
    expect(v.getTimeSettings().sessionMaxNotes).toBe(5)
    await v.setTimeSettings({ sessionMaxNotes: 6 })
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).other).toBe(1)
  })
})

describe('刪掉資料庫後重建', () => {
  it('時間邊與 activeDays 和重建前一致', async () => {
    let v = await open()
    await v.write('a.md', '---\ndate: 2026-10-05\n---\n')
    clock += 5 * MIN
    await v.write('b.md', 'b 2')
    await v.setTimeSettings({ sameDayWindowDays: 1 })
    const before = v.graph()
    expect(before.edges.some((e) => e.type === 'same_session')).toBe(true)
    await v.close()
    vault = null
    for (const f of fs.readdirSync(abs('.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    v = await open()
    expect(v.graph()).toEqual(before)
  })
})
