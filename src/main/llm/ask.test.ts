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
  TRUNCATED_NOTICE,
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

/** Splits text into chunks of n characters, simulating a stream */
function pieces(text: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

describe('detectLanguage', () => {
  it('uses Chinese when CJK characters outnumber English words', () => {
    expect(detectLanguage('深度工作的重點是什麼？')).toBe('zh-TW')
    expect(detectLanguage('What did I learn about habits?')).toBe('en')
    expect(detectLanguage('What is 深度工作?')).toBe('zh-TW')
    expect(detectLanguage('Summarize my notes on 習慣 please')).toBe('en')
    expect(detectLanguage('???')).toBe('en')
  })
})

describe('keywords', () => {
  it('removes punctuation, question words and function words', () => {
    expect(keywords('深度工作的重點是什麼？')).toEqual(['深度工作', '重點'])
    expect(keywords('關於原子習慣，我寫了哪些筆記？')).toEqual(['原子習慣'])
    expect(keywords('What did I write about deep work?')).toEqual(['deep', 'work'])
    expect(keywords('Atomic Habits atomic habits')).toEqual(['Atomic', 'Habits'])
  })

  it('does not break words containing common characters', () => {
    expect(keywords('如何了解是否有效')).toEqual(['了解', '有效'])
  })

  it('has no keywords when there are only question words', () => {
    expect(keywords('寫了什麼？')).toEqual([])
    expect(keywords('那呢？')).toEqual([])
    expect(keywords('what is it?')).toEqual([])
  })
})

describe('planQuery', () => {
  it('parses the time range; time phrases are not keywords', () => {
    expect(planQuery('上個月讀了什麼書', [], undefined, NOW)).toEqual({
      range: { from: '2026-09-01', to: '2026-09-30' },
      keywords: [],
      vectorText: '讀了什麼書'
    })
    expect(planQuery('上個月 深度工作', [], undefined, NOW).keywords).toEqual(['深度工作'])
  })

  it('does not parse from the question when the user set or removed the range', () => {
    const r = { from: '2026-01-01', to: '2026-01-31' }
    expect(planQuery('上個月 深度工作', [], r, NOW).range).toEqual(r)
    expect(planQuery('上個月 深度工作', [], null, NOW).range).toBeNull()
  })

  it('a follow-up without keywords reuses the previous question', () => {
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
    // A new question that doesn't read like a follow-up doesn't include the previous one
    expect(planQuery('跑步的紀錄', history, undefined, NOW)).toMatchObject({
      keywords: ['跑步', '紀錄'],
      vectorText: '跑步的紀錄'
    })
    expect(keywords('那第二點呢？')).toEqual([])
    expect(keywords('那些書')).toEqual(['那些書'])
  })
})

describe('notesInRange', () => {
  it('newest first by date, skipping notes without content', () => {
    const d = db([
      { path: 'a.md', body: '甲', eventDate: '2026-09-03' },
      { path: 'b.md', body: '乙', eventDate: '2026-09-20' },
      { path: 'c.md', body: '', eventDate: '2026-09-21' },
      { path: 'd.md', body: '丁', eventDate: '2026-10-01' },
      // Without an event_date, the last modified date is used
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

  it('takes the chunk containing line, then adds the chunks before and after', () => {
    const d = db([{ path: '長文.md', body: long, eventDate: '2026-09-03' }])
    const lines = chunkMarkdown(parseNote('長文.md', long).body).map((c) => c.line)
    expect(lines.length).toBe(4)
    const [s] = gatherSources(d, [hit('長文.md', lines[2])], 1500)
    expect(s).toMatchObject({ n: 1, line: lines[2], date: '2026-09-03', title: '長文' })
    expect(s.text).toContain('三')
    // The next chunk first; the budget fits only one more
    expect(s.text).toContain('四')
    expect(s.text).not.toContain('二')

    const [all] = gatherSources(d, [hit('長文.md', lines[2])], 10_000)
    expect(all.text.indexOf('一')).toBeLessThan(all.text.indexOf('四'))
  })

  it('notes over the budget are left out, and empty ones skipped', () => {
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

  it('cuts each chunk to chunkMax characters', () => {
    const d = db([{ path: '長文.md', body: long }])
    const lines = chunkMarkdown(parseNote('長文.md', long).body).map((c) => c.line)
    const [s] = gatherSources(d, [hit('長文.md', lines[1])], 250, 100)
    // The chunk containing 「二」 and the next one, 「三」, each cut to 100 characters
    expect(s.text).toBe('二'.repeat(100) + '…\n\n' + '三'.repeat(100) + '…')
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

  it('source numbers, time range and question; English repeats the language instruction', () => {
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

  it('includes only the last few history messages, stripping old citations and truncating', () => {
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

  it('strips the truncation notice from old answers in history', () => {
    const m = askMessages(
      'Q',
      [source],
      [
        { role: 'user', content: '問' },
        { role: 'assistant', content: '回答' + TRUNCATED_NOTICE['zh-TW'] },
        { role: 'user', content: 'ask' },
        { role: 'assistant', content: ('answer' + TRUNCATED_NOTICE.en).trim() }
      ],
      null,
      'zh-TW'
    )
    expect(m.slice(1, -1).map((x) => x.content)).toEqual(['問', '回答', 'ask', 'answer'])
  })
})

describe('createCitationFilter', () => {
  const run = (text: string, count: number, size = 1): { out: string; cited: number[] } => {
    const f = createCitationFilter(count)
    const out = pieces(text, size).map(f.push).join('') + f.flush()
    return { out, cited: f.cited() }
  }

  it('keeps citations in range and removes those out of range', () => {
    for (const size of [1, 2, 3, 100]) {
      expect(run('甲 [1]，乙 [3]。丙 [2]', 2, size)).toEqual({
        out: '甲 [1]，乙 。丙 [2]',
        cited: [1, 2]
      })
    }
  })

  it('normalizes [1, 2], 【1】 and [1，2]', () => {
    expect(run('a [1, 2] b 【2】 c [1，3]', 3).out).toBe('a [1][2] b [2] c [1][3]')
    expect(run('[0] [5, 1]', 4)).toEqual({ out: ' [1]', cited: [1] })
  })

  it('ordinary brackets and wikilinks are unaffected', () => {
    expect(run('[x] [[2026-10-04]] [ ] [1a] arr[i]', 3).out).toBe(
      '[x] [[2026-10-04]] [ ] [1a] arr[i]'
    )
  })

  it('an unfinished citation at the end is output as is', () => {
    expect(run('結尾 [1', 3).out).toBe('結尾 [1')
  })
})

describe('answer', () => {
  it('filters citations and links not in the sources while streaming, reporting the cited numbers', async () => {
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
