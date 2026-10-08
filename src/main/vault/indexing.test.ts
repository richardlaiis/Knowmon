// Vault 與索引（links、notes_fts、event_date）的整合測試
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNoteByPath, listLinks } from '../db'
import * as indexer from '../indexer'
import { Vault } from '.'

vi.mock('../indexer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../indexer')>()
  return { ...real, parseNote: vi.fn(real.parseNote) }
})
const parseNote = vi.mocked(indexer.parseNote)

let root: string
let vault: Vault | null = null

const abs = (rel: string): string => path.join(root, rel)

function writeExternal(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
  fs.writeFileSync(abs(rel), content)
  const t = new Date(Date.now() + Math.random() * 1e6 + 1000)
  fs.utimesSync(abs(rel), t, t)
}

async function open(): Promise<Vault> {
  vault = await Vault.open(root)
  return vault
}

/** 以路徑表示的 wikilink：src → dst（未解析時為 null） */
function edges(v: Vault): string[] {
  const paths = new Map(v.list().map((n) => [getNoteByPath(v.db, n.path)!.id, n.path]))
  return listLinks(v.db, 'wikilink')
    .map((l) => `${paths.get(l.src)} → ${l.dst === null ? `?${l.target}` : paths.get(l.dst)}`)
    .sort()
}

const backlinkPaths = (v: Vault, rel: string): string[] => v.backlinks(rel).map((b) => b.path)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-index-'))
  writeExternal('歡迎.md', '# 歡迎\n- [[原子習慣]]\n- [[尚未建立]]')
  writeExternal('讀書筆記/原子習慣.md', '---\ndate: 2025-12-20\n---\n回到 [[歡迎]]、[[歡迎|首頁]]')
  writeExternal('日記/2026-10-06.md', '今天讀了 [[原子習慣]] 的第二章，很有收穫')
  parseNote.mockClear()
})

afterEach(async () => {
  await vault?.close()
  vault = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('開啟 vault 時建立索引', () => {
  it('解析連結（含未建立的目標）、event_date、權重', async () => {
    const v = await open()
    expect(edges(v)).toEqual([
      '日記/2026-10-06.md → 讀書筆記/原子習慣.md',
      '歡迎.md → ?尚未建立',
      '歡迎.md → 讀書筆記/原子習慣.md',
      '讀書筆記/原子習慣.md → 歡迎.md'
    ])
    const weight = listLinks(v.db).find((l) => l.target === '歡迎')!.weight
    expect(weight).toBe(2)
    expect(getNoteByPath(v.db, '讀書筆記/原子習慣.md')!.eventDate).toBe('2025-12-20')
    expect(getNoteByPath(v.db, '日記/2026-10-06.md')!.eventDate).toBe('2026-10-06')
    expect(getNoteByPath(v.db, '歡迎.md')!.eventDate).toBeNull()
  })

  it('list 回傳所有筆記摘要', async () => {
    const v = await open()
    expect(v.list()).toEqual([
      expect.objectContaining({
        path: '日記/2026-10-06.md',
        title: '2026-10-06',
        eventDate: '2026-10-06'
      }),
      expect.objectContaining({ path: '歡迎.md', title: '歡迎', eventDate: null }),
      expect.objectContaining({ path: '讀書筆記/原子習慣.md', title: '原子習慣' })
    ])
  })
})

describe('反向連結', () => {
  it('列出來源筆記與該行上下文，連結部分標記 match', async () => {
    const v = await open()
    expect(v.backlinks('歡迎.md')).toEqual([
      {
        path: '讀書筆記/原子習慣.md',
        title: '原子習慣',
        line: 4,
        context: [
          { text: '回到 ', match: false },
          { text: '[[歡迎]]', match: true },
          { text: '、', match: false },
          { text: '[[歡迎|首頁]]', match: true }
        ]
      }
    ])
    expect(backlinkPaths(v, '讀書筆記/原子習慣.md')).toEqual(['日記/2026-10-06.md', '歡迎.md'])
    expect(v.backlinks('不存在.md')).toEqual([])
  })

  it('連到自己的連結不列入', async () => {
    const v = await open()
    await v.write('歡迎.md', '[[歡迎]] [[原子習慣]]')
    expect(backlinkPaths(v, '歡迎.md')).toEqual(['讀書筆記/原子習慣.md'])
  })

  it('App 寫入後立即更新', async () => {
    const v = await open()
    await v.write('日記/2026-10-06.md', '改成連到 [[歡迎]]')
    expect(backlinkPaths(v, '歡迎.md')).toEqual(['日記/2026-10-06.md', '讀書筆記/原子習慣.md'])
    expect(backlinkPaths(v, '讀書筆記/原子習慣.md')).toEqual(['歡迎.md'])
  })

  it('建立原本不存在的目標後，舊連結自動補上', async () => {
    const v = await open()
    await v.create('專案/尚未建立.md')
    expect(backlinkPaths(v, '專案/尚未建立.md')).toEqual(['歡迎.md'])
  })

  it('外部新增的筆記也會補上連結', async () => {
    const v = await open()
    writeExternal('尚未建立.md', '現在有了')
    await v.reconcile()
    expect(backlinkPaths(v, '尚未建立.md')).toEqual(['歡迎.md'])
  })

  it('目標改名後連結變成未解析，改回來又接上', async () => {
    const v = await open()
    await v.rename('讀書筆記/原子習慣.md', '讀書筆記/習慣.md')
    expect(edges(v)).toContain('歡迎.md → ?原子習慣')
    expect(v.backlinks('讀書筆記/習慣.md')).toEqual([])
    // 改名的筆記自己的連結跟著走
    expect(edges(v)).toContain('讀書筆記/習慣.md → 歡迎.md')
    await v.rename('讀書筆記', '書')
    await v.rename('書/習慣.md', '書/原子習慣.md')
    expect(backlinkPaths(v, '書/原子習慣.md')).toEqual(['日記/2026-10-06.md', '歡迎.md'])
  })

  it('刪除目標後連結變成未解析；有同名筆記時改連到它', async () => {
    const v = await open()
    await v.create('封存/舊的/原子習慣.md')
    expect(edges(v)).toContain('歡迎.md → 讀書筆記/原子習慣.md')
    await v.remove('讀書筆記/原子習慣.md')
    expect(edges(v)).toContain('歡迎.md → 封存/舊的/原子習慣.md')
    await v.remove('封存')
    expect(edges(v)).toContain('歡迎.md → ?原子習慣')
  })

  it('刪除來源筆記時移除它的連結', async () => {
    const v = await open()
    await v.remove('日記/2026-10-06.md')
    expect(backlinkPaths(v, '讀書筆記/原子習慣.md')).toEqual(['歡迎.md'])
  })
})

describe('增量索引', () => {
  it('內容 hash 沒變時不重新解析', async () => {
    const v = await open()
    expect(parseNote).toHaveBeenCalledTimes(3)
    parseNote.mockClear()
    const t = new Date(Date.now() + 5_000_000)
    fs.utimesSync(abs('歡迎.md'), t, t)
    await v.reconcile()
    expect(parseNote).not.toHaveBeenCalled()
    // 以磁碟上實際的 mtime 比較：utimes 以浮點秒設定，讀回來可能少 1ms 以下
    expect(getNoteByPath(v.db, '歡迎.md')!.modifiedAt).toBe(
      Math.floor(fs.statSync(abs('歡迎.md')).mtimeMs)
    )

    writeExternal('歡迎.md', '改了 [[日記/2026-10-06]]')
    await v.reconcile()
    expect(parseNote).toHaveBeenCalledTimes(1)
    expect(backlinkPaths(v, '日記/2026-10-06.md')).toEqual(['歡迎.md'])
  })

  it('重新開啟時只解析關閉期間改過的檔案', async () => {
    await (await open()).close()
    parseNote.mockClear()
    writeExternal('歡迎.md', '關閉期間改的')
    const v = await open()
    expect(parseNote.mock.calls.map((c) => c[0])).toEqual(['歡迎.md'])
    expect(backlinkPaths(v, '讀書筆記/原子習慣.md')).toEqual(['日記/2026-10-06.md'])
  })

  it('改名時依新檔名重新計算 event_date', async () => {
    const v = await open()
    await v.rename('日記/2026-10-06.md', '日記/2026-10-07.md')
    expect(getNoteByPath(v.db, '日記/2026-10-07.md')!.eventDate).toBe('2026-10-07')
    await v.rename('日記', '舊日記')
    expect(getNoteByPath(v.db, '舊日記/2026-10-07.md')!.eventDate).toBe('2026-10-07')
    fs.renameSync(abs('舊日記/2026-10-07.md'), abs('舊日記/隨筆.md'))
    await v.reconcile()
    expect(getNoteByPath(v.db, '舊日記/隨筆.md')!.eventDate).toBeNull()
  })

  it('改名後搜尋用新標題', async () => {
    const v = await open()
    await v.rename('歡迎.md', '入口.md')
    expect(v.search('入口').map((h) => h.path)).toEqual(['入口.md'])
    expect(v.search('歡迎').map((h) => h.title)).not.toContain('歡迎')
  })
})

describe('圖譜', () => {
  it('邊跟著寫入與建立筆記更新，未建立的目標不列入', async () => {
    const v = await open()
    const edges = (): string[] =>
      v
        .graph()
        .edges.filter((e) => e.type === 'wikilink')
        .map((e) => `${e.source} → ${e.target}`)
    expect(v.graph().nodes).toHaveLength(3)
    expect(edges()).toEqual([
      '日記/2026-10-06.md → 讀書筆記/原子習慣.md',
      '歡迎.md → 讀書筆記/原子習慣.md',
      '讀書筆記/原子習慣.md → 歡迎.md'
    ])
    await v.create('尚未建立.md')
    expect(edges()).toContain('歡迎.md → 尚未建立.md')
    await v.write('日記/2026-10-06.md', '沒有連結了')
    expect(edges()).not.toContain('日記/2026-10-06.md → 讀書筆記/原子習慣.md')
  })
})

describe('刪掉資料庫後重建', () => {
  it('連結、搜尋、event_date 與重建前一致', async () => {
    let v = await open()
    await v.write('歡迎.md', '# 歡迎\n- [[原子習慣]]\n- [[尚未建立]]\n中文搜尋測試')
    await v.create('尚未建立.md')
    const snapshot = (x: Vault): unknown => ({
      edges: edges(x),
      list: x.list().map(({ path, eventDate }) => ({ path, eventDate })),
      backlinks: x.list().map((n) => x.backlinks(n.path)),
      search: ['原子習慣', '搜尋', '第二章 收穫'].map((q) => x.search(q))
    })
    const before = snapshot(v)
    await v.close()
    vault = null
    for (const f of fs.readdirSync(abs('.knowmon'))) {
      if (f.startsWith('index.db')) fs.rmSync(path.join(root, '.knowmon', f))
    }
    v = await open()
    expect(snapshot(v)).toEqual(before)
  })
})
