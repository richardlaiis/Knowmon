import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentProposal } from '../../../shared/types'
import { Vault } from '../../vault'
import { applyProposal, NOTE_CHARS, runTool, ToolError, type ToolContext } from './tools'

// 2026-10-18 是星期日：這週 = 10-12 – 10-18，上週 = 10-05 – 10-11
const NOW = new Date(2026, 9, 18, 12).getTime()
const LONG = '深度工作需要長時間不被打斷的專注。'.repeat(200)

let root: string
let vault: Vault
let ctx: ToolContext

function write(rel: string, content: string, mtime?: Date): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  if (mtime) fs.utimesSync(abs, mtime, mtime)
}
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-tools-'))
  write(
    '讀書筆記/原子習慣.md',
    '---\ndate: 2026-10-01\ntags: [書, 習慣]\n---\n# 原子習慣\n\n每天進步 1%。相關：[[深度工作]]、[[不存在的筆記]]\n'
  )
  write('讀書筆記/深度工作.md', `---\ndate: 2026-09-20\n---\n${LONG}`)
  write('日記/2026-10-12.md', '今天讀了 [[原子習慣]]，習慣的力量很大。')
  write('日記/2026-10-14.md', '寫程式，做了時間軸。')
  write('壞掉.md', '---\ntags: [a\nb: : :\n---\n內文', new Date(2025, 0, 1))
  vault = await Vault.open(root, { now: () => NOW })
  ctx = { vault, now: NOW, queryVector: async () => null }
})

afterEach(async () => {
  await vault.close()
  fs.rmSync(root, { recursive: true, force: true })
})

async function toolError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError)
    return (e as Error).message
  }
  throw new Error('expected a ToolError')
}

describe('search_notes', () => {
  it('列出筆記的標題、路徑、日期與段落', async () => {
    const r = await runTool(ctx, 'search_notes', { query: '原子習慣' })
    expect(r.notes[0]).toEqual({ path: '讀書筆記/原子習慣.md', title: '原子習慣' })
    expect(r.text).toMatch(
      /^\d+ notes? found:\n1\. 原子習慣 \(path: 讀書筆記\/原子習慣\.md, date: 2026-10-01\)\n {3}\S/
    )
    expect(r.label).toMatch(/^Search “原子習慣” → \d+ notes?$/)
    expect(r.proposal).toBeUndefined()
  })

  it('period 由 parseTimeRange 解析；寫在 query 裡的時間也算', async () => {
    for (const args of [{ query: '原子習慣', period: '這週' }, { query: '這週 原子習慣' }]) {
      const r = await runTool(ctx, 'search_notes', args)
      expect(r.notes.map((n) => n.path)).toEqual(['日記/2026-10-12.md'])
      expect(r.text).toContain('(2026-10-12 – 2026-10-18)')
    }
  })

  it('只有時間時列出範圍內的筆記', async () => {
    const r = await runTool(ctx, 'search_notes', { query: '這週' })
    expect(r.notes.map((n) => n.path)).toEqual(['日記/2026-10-14.md', '日記/2026-10-12.md'])
  })

  it('看不懂的 period 與空的 query 回錯誤', async () => {
    expect(
      await toolError(runTool(ctx, 'search_notes', { query: 'x', period: '很久以前' }))
    ).toMatch(/Could not understand the period "很久以前"/)
    expect(await toolError(runTool(ctx, 'search_notes', { query: ' ' }))).toMatch(/empty/)
  })

  it('找不到時說明', async () => {
    const r = await runTool(ctx, 'search_notes', { query: '量子力學' })
    expect(r.text).toBe('No notes found.')
    expect(r.notes).toEqual([])
  })
})

describe('get_note', () => {
  it('以標題、[[標題]] 或路徑取得內文、日期與標籤，不記 open', async () => {
    for (const p of ['原子習慣', '[[原子習慣]]', '讀書筆記/原子習慣.md', '讀書筆記/原子習慣']) {
      const r = await runTool(ctx, 'get_note', { path: p })
      expect(r.text).toBe(
        'Title: 原子習慣\nPath: 讀書筆記/原子習慣.md\nDate: 2026-10-01\nTags: 書, 習慣\n\n' +
          '# 原子習慣\n\n每天進步 1%。相關：[[深度工作]]、[[不存在的筆記]]'
      )
      expect(r.links).toEqual(['深度工作', '不存在的筆記'])
    }
    const events = vault.db
      .prepare("SELECT COUNT(*) AS n FROM note_events WHERE kind = 'open'")
      .get()
    expect(events).toEqual({ n: 0 })
  })

  it('長的筆記分段讀取', async () => {
    const first = await runTool(ctx, 'get_note', { path: '深度工作' })
    expect(first.text).toContain(`Showing characters 0–${NOTE_CHARS} of ${LONG.length}`)
    expect(first.text).toContain(`offset=${NOTE_CHARS}`)
    const last = await runTool(ctx, 'get_note', { path: '深度工作', offset: LONG.length - 10 })
    expect(last.text).toContain(LONG.slice(-10))
    expect(last.text).not.toContain('to read more')
  })

  it('找不到的筆記回錯誤', async () => {
    expect(await toolError(runTool(ctx, 'get_note', { path: '沒有這篇' }))).toMatch(
      /Note not found: "沒有這篇"/
    )
  })
})

describe('get_neighbors', () => {
  it('依類型列出連結、反向連結與尚未建立的目標', async () => {
    const r = await runTool(ctx, 'get_neighbors', { path: '原子習慣' })
    expect(r.text).toContain('Links to:\n- 深度工作 (path: 讀書筆記/深度工作.md)')
    expect(r.text).toContain('Linked from:\n- 2026-10-12 (path: 日記/2026-10-12.md)')
    expect(r.text).toContain("Links to notes that don't exist yet: 不存在的筆記")
    expect(r.notes.map((n) => n.title)).toEqual(expect.arrayContaining(['深度工作', '2026-10-12']))
  })

  it('同一資料夾的前後篇；可只取部分類型', async () => {
    const r = await runTool(ctx, 'get_neighbors', { path: '2026-10-12', types: ['sequence'] })
    expect(r.text).toContain('Next in folder:\n- 2026-10-14 (path: 日記/2026-10-14.md)')
    expect(r.text).not.toContain('Links to')
    const none = await runTool(ctx, 'get_neighbors', { path: '壞掉', types: ['semantic'] })
    expect(none.text).toBe('壞掉 has no connections.')
  })
})

describe('list_notes_in_range', () => {
  it('period 或 from / to，新 → 舊', async () => {
    const a = await runTool(ctx, 'list_notes_in_range', { period: '這週' })
    expect(a.notes.map((n) => n.title)).toEqual(['2026-10-14', '2026-10-12'])
    expect(a.label).toBe('Notes from 2026-10-12 – 2026-10-18 → 2 notes')
    const b = await runTool(ctx, 'list_notes_in_range', { from: '2026-09-01', to: '2026-10-01' })
    expect(b.notes.map((n) => n.title)).toEqual(['原子習慣', '深度工作'])
    expect(await toolError(runTool(ctx, 'list_notes_in_range', {}))).toMatch(/period or from\/to/)
  })
})

describe('create_note', () => {
  it('產生提案但不寫入；補上 .md，標出不存在的連結', async () => {
    const r = await runTool(ctx, 'create_note', {
      path: '整理/比較',
      content: '[[原子習慣]] 與 [[深度工作]]、[[新主題]]'
    })
    expect(r.proposal).toEqual({
      kind: 'create_note',
      path: '整理/比較.md',
      content: '[[原子習慣]] 與 [[深度工作]]、[[新主題]]',
      missingLinks: ['新主題']
    })
    expect(fs.existsSync(path.join(root, '整理/比較.md'))).toBe(false)
  })

  it('拒絕已存在、跳出 vault、隱藏資料夾與空內容', async () => {
    const make = (p: string, content = 'x'): Promise<unknown> =>
      runTool(ctx, 'create_note', { path: p, content })
    expect(await toolError(make('讀書筆記/原子習慣.md'))).toMatch(/already exists/)
    expect(await toolError(make('../外面.md'))).toMatch(/outside the vault/)
    expect(await toolError(make('.knowmon/x.md'))).toMatch(/Hidden/)
    expect(await toolError(make('新.md', '  '))).toMatch(/empty/)
  })

  it('確認後寫入；使用者修改的路徑與內容優先', async () => {
    const { proposal } = await runTool(ctx, 'create_note', { path: '比較.md', content: '初稿' })
    const edited: AgentProposal = {
      ...proposal!,
      path: '整理/比較 v2',
      content: '改過'
    } as AgentProposal
    const r = await applyProposal(ctx, proposal!, edited)
    expect(read('整理/比較 v2.md')).toBe('改過')
    expect(fs.existsSync(path.join(root, '比較.md'))).toBe(false)
    expect(r.notes).toEqual([{ path: '整理/比較 v2.md', title: '比較 v2' }])
    expect(r.text).toContain('The user edited it')
    expect(vault.list().map((n) => n.path)).toContain('整理/比較 v2.md')
  })

  it('等待確認期間有人建立了同名筆記時不覆蓋', async () => {
    const { proposal } = await runTool(ctx, 'create_note', { path: '比較.md', content: '初稿' })
    write('比較.md', '別人寫的')
    await expect(applyProposal(ctx, proposal!)).rejects.toThrow(/already exists/)
    expect(read('比較.md')).toBe('別人寫的')
  })
})

describe('add_tags', () => {
  it('提案帶修改前後的 frontmatter；已有的標籤不重複', async () => {
    const r = await runTool(ctx, 'add_tags', { path: '原子習慣', tags: ['#習慣', '回顧'] })
    expect(r.proposal).toEqual({
      kind: 'add_tags',
      path: '讀書筆記/原子習慣.md',
      title: '原子習慣',
      tags: ['回顧'],
      before: '---\ndate: 2026-10-01\ntags: [書, 習慣]\n---\n',
      after: '---\ndate: 2026-10-01\ntags: [書, 習慣, 回顧]\n---\n'
    })
    expect(read('讀書筆記/原子習慣.md')).toContain('tags: [書, 習慣]\n')
  })

  it('全部已存在時不需要確認；逗號分隔的字串也接受', async () => {
    const r = await runTool(ctx, 'add_tags', { path: '原子習慣', tags: '書, 習慣' })
    expect(r.proposal).toBeUndefined()
    expect(r.text).toContain('already has these tags')
  })

  it('frontmatter 損毀時回錯誤', async () => {
    expect(await toolError(runTool(ctx, 'add_tags', { path: '壞掉', tags: ['x'] }))).toMatch(
      /not valid YAML/
    )
  })

  it('確認時重新讀檔再套用，不會蓋掉等待期間的修改；可刪掉個別標籤', async () => {
    const { proposal } = await runTool(ctx, 'add_tags', {
      path: '2026-10-12',
      tags: ['日記', '回顧']
    })
    await vault.write('日記/2026-10-12.md', '今天讀了 [[原子習慣]]。晚上又補了一段。')
    const edited = { ...proposal!, tags: ['回顧'] } as AgentProposal
    const r = await applyProposal(ctx, proposal!, edited)
    expect(read('日記/2026-10-12.md')).toBe(
      '---\ntags: [回顧]\n---\n今天讀了 [[原子習慣]]。晚上又補了一段。'
    )
    expect(r.label).toBe('Added #回顧 to 2026-10-12')
  })

  it('使用者刪掉全部標籤時什麼都不寫', async () => {
    const { proposal } = await runTool(ctx, 'add_tags', { path: '2026-10-14', tags: ['x'] })
    const before = read('日記/2026-10-14.md')
    const r = await applyProposal(ctx, proposal!, { ...proposal!, tags: [] } as AgentProposal)
    expect(read('日記/2026-10-14.md')).toBe(before)
    expect(r.text).toContain('nothing was changed')
  })
})
