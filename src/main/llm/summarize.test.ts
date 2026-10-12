import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './ollama'
import {
  createLinkFilter,
  linkTargets,
  splitForSummary,
  summarize,
  summaryMessages,
  SUMMARY_DIRECT_MAX
} from './summarize'

/** 回覆是陣列時逐段串流 */
function fakeChat(replies: (messages: ChatMessage[], i: number) => string | string[]): {
  chat: (m: ChatMessage[], onDelta?: (t: string) => void) => Promise<string>
  calls: ChatMessage[][]
} {
  const calls: ChatMessage[][] = []
  return {
    calls,
    chat: async (messages, onDelta) => {
      const reply = replies(messages, calls.length)
      calls.push(messages)
      const pieces = Array.isArray(reply) ? reply : [reply]
      for (const p of pieces) onDelta?.(p)
      return pieces.join('')
    }
  }
}

describe('summaryMessages', () => {
  it('要求繁體中文、條列，附上原文的連結清單，並包含標題與內容', () => {
    const [system, user] = summaryMessages(
      'note',
      '讀書會',
      '內容 [[原子習慣]] 與 [[深度工作|深度]]'
    )
    expect(system.role).toBe('system')
    expect(system.content).toContain('繁體中文')
    expect(system.content).toContain('可用連結')
    // 範例會被小模型原樣抄進總結，提示詞裡不能有 [[...]]
    expect(system.content).not.toMatch(/\[\[/)
    expect(user.content).toContain('「讀書會」')
    expect(user.content).toContain('內容 [[原子習慣]]')
    expect(user.content).toContain('可用連結：[[原子習慣]]、[[深度工作]]')
    expect(summaryMessages('note', 't', '沒有連結')[1].content).toContain('可用連結：無')
    expect(summaryMessages('selection', '讀書會', 'x')[1].content).toContain('選取')
  })

  it('英文模式：英文提示詞、保留 wikilink、內容原樣送出', () => {
    const [system, user] = summaryMessages('note', '讀書會', '內容 [[原子習慣]]', 'en')
    expect(system.content).toContain('in English')
    expect(system.content).not.toMatch(/\[\[/)
    expect(user.content).toContain('Available links: [[原子習慣]]')
    expect(summaryMessages('note', 't', 'x', 'en')[1].content).toContain('Available links: none')
    expect(system.content).not.toContain('繁體中文')
    expect(user.content).toContain('"讀書會"')
    expect(user.content).toContain('內容 [[原子習慣]]')
    expect(summaryMessages('selection', 't', 'x', 'en')[1].content).toContain('selected')
  })
})

describe('summarize', () => {
  it('短內容直接總結並串流', async () => {
    const { chat, calls } = fakeChat(() => '- 重點')
    const deltas: string[] = []
    expect(await summarize(chat, 'note', 't', '  內容  ', (d) => deltas.push(d))).toBe('- 重點')
    expect(calls).toHaveLength(1)
    expect(calls[0][1].content).toContain('<<<\n內容\n>>>')
    expect(deltas).toEqual(['- 重點'])
  })

  it('空白內容直接報錯，不呼叫模型', async () => {
    const { chat, calls } = fakeChat(() => '')
    await expect(summarize(chat, 'note', 't', '\n \n', () => {})).rejects.toThrow('empty')
    expect(calls).toHaveLength(0)
  })

  it('過長的內容先分段摘要再合併，只有最後的結果被串流', async () => {
    const section = (i: number): string => `## 第${i}節\n\n` + '內容。'.repeat(1000)
    const text = [1, 2, 3, 4, 5].map(section).join('\n\n')
    expect(text.length).toBeGreaterThan(SUMMARY_DIRECT_MAX)
    const { chat, calls } = fakeChat((_m, i) => `摘要${i + 1}`)
    const deltas: string[] = []
    const out = await summarize(chat, 'note', '長文', text, (d) => deltas.push(d))
    const parts = calls.length - 1
    expect(parts).toBeGreaterThan(1)
    expect(calls[0][1].content).toContain(`第 1/${parts} 段`)
    const last = calls[calls.length - 1][1].content
    expect(last).toContain('摘要1')
    expect(last).toContain(`摘要${parts}`)
    expect(deltas).toEqual([out])

    const en = fakeChat(() => 'part')
    await summarize(en.chat, 'note', 'long', text, () => {}, 'en')
    expect(en.calls[0][1].content).toContain('part 1/')
    expect(en.calls.at(-1)![1].content).toContain('Key points of part 1:')
    expect(en.calls.every((c) => c[0].content.includes('in English'))).toBe(true)
  })
})

describe('splitForSummary', () => {
  it('每段不超過上限，合起來包含全部內容', () => {
    const text = Array.from({ length: 20 }, (_, i) => `段落${i}。` + '字'.repeat(90)).join('\n\n')
    const parts = splitForSummary(text, 500)
    expect(parts.every((p) => p.length <= 500)).toBe(true)
    expect(parts.join('\n\n')).toBe(text)
  })
})

describe('linkTargets', () => {
  it('去重（不分大小寫）、去掉 #標題 與 |顯示文字，略過程式碼裡的', () => {
    expect(linkTargets('[[A]] [[a#h|x]] [[B|b]] `[[C]]`\n```\n[[D]]\n```')).toEqual(['A', 'B'])
  })
})

describe('createLinkFilter', () => {
  const run = (allowed: string[], pieces: string[]): string => {
    const f = createLinkFilter(allowed)
    return pieces.map((p) => f.push(p)).join('') + f.flush()
  }

  it('保留原文有的連結，其他的改成純文字', () => {
    expect(run(['原子習慣'], ['見 [[原子習慣]]、[[wikilink]] 與 [[假的|顯示]]'])).toBe(
      '見 [[原子習慣]]、wikilink 與 顯示'
    )
  })

  it('連結被切在多個片段之間也能判斷', () => {
    const pieces = ['見 [', '[原子', '習慣]', ']，[[不存', '在]]。']
    expect(run(['原子習慣'], pieces)).toBe('見 [[原子習慣]]，不存在。')
  })

  it('比對不分大小寫、可帶 #標題', () => {
    expect(run(['Deep Work'], ['[[deep work#ch1|DW]]'])).toBe('[[deep work#ch1|DW]]')
  })

  it('不是連結的中括號原樣輸出，未完成的在 flush 時輸出', () => {
    expect(run([], ['陣列 a[0] 與 [x](https://a.b) 和 [[未完'])).toBe(
      '陣列 a[0] 與 [x](https://a.b) 和 [[未完'
    )
    expect(run([], ['[[a\nb]] ok'])).toBe('[[a\nb]] ok')
  })

  it('沒有連結時不暫存，片段立刻輸出', () => {
    const f = createLinkFilter([])
    expect(f.push('- 第一點')).toBe('- 第一點')
    expect(f.push('，[')).toBe('，')
    expect(f.push('x]')).toBe('[x]')
  })
})

describe('summarize 的連結過濾', () => {
  it('串流與回傳值都移除原文沒有的連結', async () => {
    const { chat } = fakeChat(() => ['- 參考 [[原子', '習慣]] 和 [[wiki', 'link]]'])
    const deltas: string[] = []
    const out = await summarize(chat, 'note', 't', '讀 [[原子習慣]]', (d) => deltas.push(d))
    expect(out).toBe('- 參考 [[原子習慣]] 和 wikilink')
    expect(deltas.join('')).toBe(out)
  })
})
