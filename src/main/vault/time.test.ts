// Vault's time layer: when time edges are recomputed, reading and writing time parameters, DB rebuilds
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SEMANTIC_SETTINGS } from '../../shared/llm'
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

async function edges(v: Vault, type: LinkType): Promise<string[]> {
  return (await v.graph()).edges
    .filter((e) => e.type === type)
    .map((e) => `${e.source} – ${e.target}`)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-time-'))
  clock = new Date(2026, 9, 8, 9, 0).getTime()
  writeExternal('a.md', 'a')
  writeExternal('b.md', 'b')
  writeExternal('Journal/2026-10-04.md', '')
  writeExternal('Journal/2026-10-05.md', '')
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('time edges', () => {
  it('notes edited close together get same_session edges; ones far apart do not', async () => {
    const v = await open()
    expect(await edges(v, 'same_session')).toEqual([])
    await v.write('a.md', 'a 1')
    clock += 10 * MIN
    await v.write('b.md', 'b 1')
    expect(await edges(v, 'same_session')).toEqual(['a.md – b.md'])
    clock += 120 * MIN
    await v.write('Journal/2026-10-04.md', 'two hours later')
    expect(await edges(v, 'same_session')).toEqual(['a.md – b.md'])
  })

  it('same_day and sequence follow event_date changes', async () => {
    const v = await open()
    expect(await edges(v, 'sequence')).toEqual(['Journal/2026-10-04.md – Journal/2026-10-05.md'])
    expect(await edges(v, 'same_day')).toEqual([])
    await v.write('a.md', '---\ndate: 2026-10-05\n---\n')
    expect(await edges(v, 'same_day')).toEqual(['Journal/2026-10-05.md – a.md'])
    await v.rename('a.md', 'Journal/a.md')
    expect(await edges(v, 'sequence')).toEqual([
      'Journal/2026-10-04.md – Journal/2026-10-05.md',
      'Journal/2026-10-05.md – Journal/a.md'
    ])
    await v.remove('Journal/2026-10-05.md')
    expect(await edges(v, 'sequence')).toEqual(['Journal/2026-10-04.md – Journal/a.md'])
  })

  it('external changes (reconcile) also update time edges', async () => {
    const v = await open()
    writeExternal('c.md', '---\ndate: 2026-10-04\n---\n')
    await v.reconcile()
    expect(await edges(v, 'same_day')).toEqual(['Journal/2026-10-04.md – c.md'])
  })

  it('activeDays includes the creation and edit dates', async () => {
    const v = await open()
    clock += 24 * 60 * MIN
    await v.write('a.md', 'edited the next day')
    const a = (await v.graph()).nodes.find((n) => n.path === 'a.md')!
    // create events use the file's birthtime (real time), so only check that the edit day is included
    expect(a.activeDays).toContain('2026-10-09')
    expect(v.activity(clock, clock + 1)).toEqual([
      { path: 'a.md', title: 'a', ts: clock, kind: 'edit' }
    ])
  })
})

describe('time parameters', () => {
  it('defaults; changes are clamped, written to settings.json, and kept after reopening the vault', async () => {
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

  it('changing parameters recomputes time edges immediately', async () => {
    const v = await open()
    expect(await edges(v, 'same_day')).toEqual([])
    await v.setTimeSettings({ sameDayWindowDays: 1 })
    expect(await edges(v, 'same_day')).toEqual(['Journal/2026-10-04.md – Journal/2026-10-05.md'])
  })

  it('uses the defaults when settings.json is corrupt, keeping other fields on write', async () => {
    fs.mkdirSync(abs('.knowmon'), { recursive: true })
    fs.writeFileSync(settingsFile(), '{broken')
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

describe('semantic parameters', () => {
  it('stored in a different field of the same file as the time parameters, kept after reopening the vault', async () => {
    let v = await open()
    expect(v.getSemanticSettings()).toEqual(DEFAULT_SEMANTIC_SETTINGS)
    await v.setTimeSettings({ sessionGapMinutes: 60 })
    expect(
      await v.setSemanticSettings({ semanticThreshold: 0.123, semanticMaxPerNote: 8 })
    ).toEqual({ semanticThreshold: 0.3, semanticMaxPerNote: 8 })
    const file = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    expect(file.time.sessionGapMinutes).toBe(60)
    expect(file.semantic.semanticMaxPerNote).toBe(8)
    await v.close()
    v = await open()
    expect(v.getSemanticSettings().semanticMaxPerNote).toBe(8)
    expect(v.getTimeSettings().sessionGapMinutes).toBe(60)
  })
})

describe('rebuilding after deleting the database', () => {
  it('time edges and activeDays match the state before the rebuild', async () => {
    let v = await open()
    await v.write('a.md', '---\ndate: 2026-10-05\n---\n')
    clock += 5 * MIN
    await v.write('b.md', 'b 2')
    await v.setTimeSettings({ sameDayWindowDays: 1 })
    const before = await v.graph()
    expect(before.edges.some((e) => e.type === 'same_session')).toBe(true)
    await v.close()
    vault = null
    for (const f of fs.readdirSync(abs('.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    v = await open()
    expect(await v.graph()).toEqual(before)
  })
})
