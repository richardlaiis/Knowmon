import { describe, expect, it } from 'vitest'
import type { RetrieveHit } from '../../shared/types'
import { openDb, setNoteBody, upsertNote, type DB } from '../db'
import { setChunks } from '../db/vectors'
import { chunkMarkdown } from '../indexer/chunk'
import { parseNote } from '../indexer'
import {
  answer,
  askMessages,
  createCitationFilter,
  detectLanguage,
  gatherSources,
  HISTORY_CHARS,
  HISTORY_MESSAGES,
  keywords,
  notesInRange,
  planQuery,
  type ContextSource
} from './ask'
import type { ChatMessage } from './ollama'

const NOW = new Date(2026, 9, 14, 12).getTime()

function db(specs: { path: string; body: string; eventDate?: string; modifiedAt?: number }[]): DB {
  const d = openDb(':memory:')
  for (const s of specs) {
    const title = s.path.replace(/\.md$/, '').split('/').pop()!
    const parsed = parseNote(s.path, s.body)
    const id = upsertNote(d, {
      path: s.path,
      title,
      createdAt: 0,
      modifiedAt: s.modifiedAt ?? new Date(2026, 9, 1).getTime(),
      eventDate: s.eventDate ?? parsed.eventDate,
      contentHash: s.path
    })
    setNoteBody(d, id, title, parsed.body)
    setChunks(d, id, chunkMarkdown(parsed.body))
  }
  return d
}

const hit = (path: string, line = 1): RetrieveHit => ({
  path,
  title: path.replace(/\.md$/, ''),
  score: 1,
  line,
  snippet: [{ text: 'x', match: false }],
  via: ['vector']
})

/** 把文字依每 n 個字元切成片段，模擬串流 */
function pieces(text: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

describe('detectLanguage', () => {
  it('漢字多於英文單字時用中文', () => {
    expect(detectLanguage('深度工作的重點是什麼？')).toBe('zh-TW')
    expect(detectLanguage('What did I learn about habits?')).toBe('en')
    expect(detectLanguage('What is 深度工作?')).toBe('zh-TW')
    expect(detectLanguage('Summarize my notes on 習慣 please')).toBe('en')
    expect(detectLanguage('???')).toBe('en')
  })
})

describe('keywords', () => {
  it('去掉標點、疑問詞與虛詞', () => {
    expect(keywords('深度工作的重點是什麼？')).toEqual(['深度工作', '重點'])
    expect(keywords('關於原子習慣，我寫了哪些筆記？')).toEqual(['原子習慣'])
    expect(keywords('What did I write about deep work?')).toEqual(['deep', 'work'])
    expect(keywords('Atomic Habits atomic habits')).toEqual(['Atomic', 'Habits'])
  })

  it('不切壞含有常用字的詞', () => {
    expect(keywords('如何了解是否有效')).toEqual(['了解', '有效'])
  })

  it('只有疑問詞時沒有關鍵字', () => {
    expect(keywords('寫了什麼？')).toEqual([])
    expect(keywords('那呢？')).toEqual([])
    expect(keywords('what is it?')).toEqual([])
  })
})

describe('planQuery', () => {
  it('解析時間範圍，時間片語不當作關鍵字', () => {
    expect(planQuery('上個月讀了什麼書', [], undefined, NOW)).toEqual({
      range: { from: '2026-09-01', to: '2026-09-30' },
      keywords: [],
      vectorText: '讀了什麼書'
    })
    expect(planQuery('上個月 深度工作', [], undefined, NOW).keywords).toEqual(['深度工作'])
  })

  it('範圍由使用者指定或取消時不從問題解析', () => {
    const r = { from: '2026-01-01', to: '2026-01-31' }
    expect(planQuery('上個月 深度工作', [], r, NOW).range).toEqual(r)
    expect(planQuery('上個月 深度工作', [], null, NOW).range).toBeNull()
  })

  it('追問沒有關鍵字時沿用前一個問題', () => {
    const history = [
      { role: 'user' as const, content: '上週 原子習慣的重點' },
      { role: 'assistant' as const, content: '...' }
    ]
    expect(planQuery('那第二點呢？', history, undefined, NOW)).toEqual({
      range: null,
      keywords: ['原子習慣', '重點'],
      vectorText: '原子習慣的重點\n那第二點呢？'
    })
    expect(planQuery('深度工作呢？', history, undefined, NOW)).toMatchObject({
      keywords: ['深度工作'],
      vectorText: '原子習慣的重點\n深度工作呢？'
    })
    // 不像追問的新問題不帶前一個問題
    expect(planQuery('跑步的紀錄', history, undefined, NOW)).toMatchObject({
      keywords: ['跑步', '紀錄'],
      vectorText: '跑步的紀錄'
    })
    expect(keywords('那第二點呢？')).toEqual([])
    expect(keywords('那些書')).toEqual(['那些書'])
  })
})

describe('notesInRange', () => {
  it('依日期新到舊，沒有內容的筆記不列入', () => {
    const d = db([
      { path: 'a.md', body: '甲', eventDate: '2026-09-03' },
      { path: 'b.md', body: '乙', eventDate: '2026-09-20' },
      { path: 'c.md', body: '', eventDate: '2026-09-21' },
      { path: 'd.md', body: '丁', eventDate: '2026-10-01' },
      // 沒有 event_date 時用最後修改日
      { path: 'e.md', body: '戊', modifiedAt: new Date(2026, 8, 10, 9).getTime() }
    ])
    const hits = notesInRange(d, { from: '2026-09-01', to: '2026-09-30' })
    expect(hits.map((h) => h.path)).toEqual(['b.md', 'e.md', 'a.md'])
    expect(hits[0]).toMatchObject({ line: 1, snippet: [{ text: '乙', match: false }] })
  })
})

describe('gatherSources', () => {
  const para = (ch: string): string => ch.repeat(700)
  const long = ['# 長文', '', para('一'), '', para('二'), '', para('三'), '', para('四')].join('\n')

  it('取 line 所在的 chunk，再補前後的 chunk', () => {
    const d = db([{ path: '長文.md', body: long, eventDate: '2026-09-03' }])
    const lines = chunkMarkdown(parseNote('長文.md', long).body).map((c) => c.line)
    expect(lines.length).toBe(4)
    const [s] = gatherSources(d, [hit('長文.md', lines[2])], 1500)
    expect(s).toMatchObject({ n: 1, line: lines[2], date: '2026-09-03', title: '長文' })
    expect(s.text).toContain('三')
    // 後一塊優先；預算只夠再加一塊
    expect(s.text).toContain('四')
    expect(s.text).not.toContain('二')

    const [all] = gatherSources(d, [hit('長文.md', lines[2])], 10_000)
    expect(all.text.indexOf('一')).toBeLessThan(all.text.indexOf('四'))
  })

  it('超過預算的筆記不列入，沒有內容的略過', () => {
    const d = db([
      { path: '長文.md', body: long },
      { path: '短.md', body: '短短的內容' },
      { path: '空.md', body: '' }
    ])
    const lines = chunkMarkdown(parseNote('長文.md', long).body).map((c) => c.line)
    const sources = gatherSources(d, [hit('空.md'), hit('長文.md', lines[1]), hit('短.md')], 702)
    expect(sources.map((s) => [s.n, s.path])).toEqual([[1, '長文.md']])
    const two = gatherSources(d, [hit('長文.md', lines[0]), hit('短.md')], 2000)
    expect(two.map((s) => s.path)).toEqual(['長文.md', '短.md'])
  })
})

describe('askMessages', () => {
  const source: ContextSource = {
    n: 1,
    path: 'a.md',
    title: '甲',
    line: 1,
    snippet: [],
    date: '2026-09-03',
    text: '內容'
  }

  it('來源編號、時間範圍、問題；英文再提醒一次語言', () => {
    const zh = askMessages(
      '問題？',
      [source],
      [],
      { from: '2026-09-01', to: '2026-09-30' },
      'zh-TW'
    )
    expect(zh[0].content).toContain('繁體中文')
    expect(zh[1].content).toBe(
      '來源：\n\n[1] 甲（2026-09-03）\n內容\n\n時間範圍：2026-09-01 – 2026-09-30\n\n問題：問題？'
    )
    const en = askMessages('Q?', [source], [], null, 'en')
    expect(en[0].content).toContain('in English')
    expect(en[1].content).toMatch(/Question: Q\?\n\nAnswer in English/)
  })

  it('只帶最近幾則歷史，去掉舊的引用並截斷', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: i === 9 ? '很長[2]'.repeat(600) : `第 ${i} 則 [1]`
    }))
    const m = askMessages('Q', [source], history, null, 'zh-TW')
    expect(m).toHaveLength(HISTORY_MESSAGES + 2)
    expect(m[1]).toEqual({ role: 'user', content: '第 4 則' })
    expect(m.at(-2)!.content).toHaveLength(HISTORY_CHARS + 1)
    expect(m.at(-2)!.content).not.toContain('[2]')
  })
})

describe('createCitationFilter', () => {
  const run = (text: string, count: number, size = 1): { out: string; cited: number[] } => {
    const f = createCitationFilter(count)
    const out = pieces(text, size).map(f.push).join('') + f.flush()
    return { out, cited: f.cited() }
  }

  it('保留範圍內的引用，拿掉範圍外的', () => {
    for (const size of [1, 2, 3, 100]) {
      expect(run('甲 [1]，乙 [3]。丙 [2]', 2, size)).toEqual({
        out: '甲 [1]，乙 。丙 [2]',
        cited: [1, 2]
      })
    }
  })

  it('統一 [1, 2]、【1】、[1，2] 的寫法', () => {
    expect(run('a [1, 2] b 【2】 c [1，3]', 3).out).toBe('a [1][2] b [2] c [1][3]')
    expect(run('[0] [5, 1]', 4)).toEqual({ out: ' [1]', cited: [1] })
  })

  it('一般的中括號與 wikilink 不受影響', () => {
    expect(run('[x] [[2026-10-04]] [ ] [1a] arr[i]', 3).out).toBe(
      '[x] [[2026-10-04]] [ ] [1a] arr[i]'
    )
  })

  it('結尾未完成的引用原樣輸出', () => {
    expect(run('結尾 [1', 3).out).toBe('結尾 [1')
  })
})

describe('answer', () => {
  it('串流過濾引用與來源以外的連結，回報引用的編號', async () => {
    const sources: ContextSource[] = [
      {
        n: 1,
        path: 'a.md',
        title: '原子習慣',
        line: 1,
        snippet: [],
        date: '2026-09-03',
        text: '見 [[深度工作]]'
      }
    ]
    const reply = '根據 [[原子習慣]] [1] 與 [[深度工作]] [1][2]，還有 [[不存在]]。'
    const calls: ChatMessage[][] = []
    const deltas: string[] = []
    const r = await answer(
      async (messages, onDelta) => {
        calls.push(messages)
        for (const p of pieces(reply, 2)) onDelta?.(p)
        return reply
      },
      [{ role: 'user', content: 'q' }],
      sources,
      (d) => deltas.push(d)
    )
    expect(r.text).toBe('根據 [[原子習慣]] [1] 與 [[深度工作]] [1]，還有 不存在。')
    expect(deltas.join('')).toBe(r.text)
    expect(r.cited).toEqual([1])
  })
})
