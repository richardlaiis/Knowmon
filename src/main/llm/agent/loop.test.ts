import { describe, expect, it } from 'vitest'
import type {
  AgentChunk,
  AgentDecision,
  AgentProposal,
  AgentStep,
  AgentToolName
} from '../../../shared/types'
import type { ChatMessage, ChatResult, ToolCall, ToolDefinition } from '../ollama'
import {
  AGENT_CONTEXT_MAX,
  AGENT_HISTORY_CHARS,
  AGENT_HISTORY_MESSAGES,
  agentMessages,
  REJECTED,
  REPEATED,
  runAgent,
  TOOL_RESULT_MAX,
  TOOL_RESULT_MIN,
  type AgentTools,
  type ToolChat
} from './loop'
import { ToolError, TOOL_DEFINITIONS, type ToolOutcome } from './tools'

const NOW = new Date(2026, 9, 18, 12).getTime()

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  name,
  arguments: args
})
const reply = (content: string, ...toolCalls: ToolCall[]): ChatResult => ({ content, toolCalls })

const PROPOSAL: AgentProposal = {
  kind: 'create_note',
  path: '比較.md',
  content: '內容',
  missingLinks: []
}

interface Harness {
  chunks: Omit<AgentChunk, 'id' | 'done'>[]
  /** 每次 chat 收到的 messages 複本與工具清單 */
  calls: { messages: ChatMessage[]; tools: readonly ToolDefinition[] | null }[]
  applied: { proposal: AgentProposal; edited?: AgentProposal }[]
  confirmed: AgentStep[]
  steps: () => AgentStep[]
  text: () => string
  run: () => Promise<void>
}

function harness(
  replies: ChatResult[],
  opts: {
    run?: (name: AgentToolName, args: Record<string, unknown>) => Promise<ToolOutcome>
    decide?: (step: AgentStep) => AgentDecision | Promise<AgentDecision>
    apply?: AgentTools['apply']
    maxSteps?: number
    signal?: AbortSignal
  } = {}
): Harness {
  const h: Harness = {
    chunks: [],
    calls: [],
    applied: [],
    confirmed: [],
    steps: () => {
      // 同 index 取代，保留最後的狀態
      const m = new Map<number, AgentStep>()
      for (const c of h.chunks) if (c.step) m.set(c.step.index, c.step)
      return [...m.values()]
    },
    text: () => h.chunks.map((c) => c.delta).join(''),
    run: () =>
      runAgent(
        {
          chat,
          tools,
          emit: (c) => h.chunks.push(c),
          confirm: async (step) => {
            h.confirmed.push(step)
            return (opts.decide ?? (() => ({ approved: true })))(step)
          },
          signal: opts.signal ?? new AbortController().signal,
          maxSteps: opts.maxSteps
        },
        agentMessages('任務', [], 'zh-TW', NOW)
      )
  }
  let n = 0
  const chat: ToolChat = async (messages, offered, onDelta) => {
    h.calls.push({ messages: messages.map((m) => ({ ...m })), tools: offered })
    const r = replies[Math.min(n++, replies.length - 1)]
    for (const ch of r.content) onDelta(ch)
    return r
  }
  const tools: AgentTools = {
    definitions: TOOL_DEFINITIONS,
    run:
      opts.run ??
      (async (name, args) =>
        name === 'create_note'
          ? { text: '', label: 'Create 比較.md', notes: [], proposal: PROPOSAL }
          : {
              text: `${name} 的結果`,
              label: `${name} done`,
              notes: [{ path: '讀書筆記/原子習慣.md', title: '原子習慣' }],
              links: ['深度工作'],
              ...(args.big ? { text: 'x'.repeat(Number(args.big)) } : {})
            }),
    apply: async (proposal, edited) => {
      if (opts.apply) return opts.apply(proposal, edited)
      h.applied.push({ proposal, edited })
      const path = edited?.kind === 'create_note' ? edited.path : proposal.path
      return { text: `Created ${path}`, label: `Created ${path}`, notes: [{ path, title: '比較' }] }
    }
  }
  return h
}

const toolMessages = (m: ChatMessage[]): ChatMessage[] => m.filter((x) => x.role === 'tool')

describe('runAgent', () => {
  it('多步驟：執行工具、結果加回對話，最後串流回答', async () => {
    const h = harness([
      reply('我先搜尋。', call('search_notes', { query: '習慣' })),
      reply('', call('get_note', { path: '原子習慣' })),
      reply('[[原子習慣]] 的重點是每天進步。')
    ])
    await h.run()
    expect(h.steps().map((s) => [s.index, s.tool, s.status, s.label])).toEqual([
      [0, 'search_notes', 'done', 'search_notes done'],
      [1, 'get_note', 'done', 'get_note done']
    ])
    // 每個步驟先送出 running
    expect(h.chunks.find((c) => c.step)!.step!.status).toBe('running')
    expect(h.text()).toBe('我先搜尋。[[原子習慣]] 的重點是每天進步。')

    const last = h.calls[2].messages
    expect(last.slice(-4).map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
    expect(last[last.length - 4]).toMatchObject({
      content: '我先搜尋。',
      tool_calls: [{ function: { name: 'search_notes', arguments: { query: '習慣' } } }]
    })
    expect(last[last.length - 1]).toEqual({
      role: 'tool',
      tool_name: 'get_note',
      content: 'get_note 的結果'
    })
    expect(h.calls.every((c) => c.tools === TOOL_DEFINITIONS)).toBe(true)
  })

  it('一次回覆多個工具呼叫時依序執行', async () => {
    const h = harness([
      reply('', call('get_note', { path: 'a' }), call('get_note', { path: 'b' })),
      reply('完成')
    ])
    await h.run()
    expect(h.steps().map((s) => s.args)).toEqual([{ path: 'a' }, { path: 'b' }])
    expect(toolMessages(h.calls[1].messages)).toHaveLength(2)
  })

  it('達到步數上限後不再提供工具，要求直接回答', async () => {
    const h = harness(
      [
        reply('', call('get_note', { path: 'x' })),
        reply('', call('get_note', { path: 'y' })),
        reply('答案')
      ],
      {
        maxSteps: 2
      }
    )
    // 第三次以後模型被要求作答（不提供工具）
    await h.run()
    expect(h.calls.map((c) => c.tools !== null)).toEqual([true, true, false])
    const last = h.calls[2].messages
    expect(last[last.length - 1]).toMatchObject({ role: 'user' })
    expect(last[last.length - 1].content).toContain('用完')
    expect(h.text()).toBe('答案')
  })

  it('沒有提供工具時，模型仍回傳的工具呼叫被忽略', async () => {
    const h = harness(
      [reply('', call('get_note', { path: 'x' })), reply('答案', call('get_note', { path: 'z' }))],
      {
        maxSteps: 1
      }
    )
    await h.run()
    expect(h.steps()).toHaveLength(1)
  })

  it('相同參數的重複呼叫不再執行（參數順序不同也算）', async () => {
    let runs = 0
    const h = harness(
      [
        reply('', call('search_notes', { query: 'a', limit: 3 })),
        reply('', call('search_notes', { limit: 3, query: 'a' })),
        reply('好')
      ],
      {
        run: async () => {
          runs++
          return { text: 'r', label: 'l', notes: [] }
        }
      }
    )
    await h.run()
    expect(runs).toBe(1)
    expect(h.steps()[1].label).toContain('repeated')
    expect(toolMessages(h.calls[2].messages)[1].content).toBe(REPEATED)
  })

  it('工具錯誤與不認得的工具：錯誤回給模型，任務繼續', async () => {
    const h = harness(
      [reply('', call('get_note', { path: '沒有' }), call('delete_everything')), reply('找不到')],
      {
        run: async () => {
          throw new ToolError('Note not found: "沒有".')
        }
      }
    )
    await h.run()
    expect(h.steps()).toEqual([
      expect.objectContaining({ status: 'error', error: 'Note not found: "沒有".' })
    ])
    const results = toolMessages(h.calls[1].messages).map((m) => m.content)
    expect(results[0]).toBe('Error: Note not found: "沒有".')
    expect(results[1]).toMatch(/^Error: unknown tool "delete_everything"/)
    expect(h.text()).toBe('找不到')
  })

  it('寫入工具：等待確認，Apply 後才寫入並回報', async () => {
    const h = harness([
      reply('', call('create_note', { path: '比較.md', content: '內容' })),
      reply('已建立')
    ])
    await h.run()
    expect(h.confirmed).toEqual([
      expect.objectContaining({ index: 0, status: 'confirm', proposal: PROPOSAL })
    ])
    expect(h.applied).toEqual([{ proposal: PROPOSAL, edited: undefined }])
    expect(h.steps()[0]).toMatchObject({
      status: 'applied',
      label: 'Created 比較.md',
      notes: [{ path: '比較.md', title: '比較' }]
    })
    expect(toolMessages(h.calls[1].messages)[0].content).toBe('Created 比較.md')
  })

  it('使用者修改後的提案交給 apply', async () => {
    const edited: AgentProposal = { ...PROPOSAL, path: '整理/比較.md' }
    const h = harness([reply('', call('create_note', {})), reply('好')], {
      decide: () => ({ approved: true, edited })
    })
    await h.run()
    expect(h.applied[0].edited).toEqual(edited)
    expect(h.steps()[0].label).toBe('Created 整理/比較.md')
  })

  it('Reject 時不寫入，告訴模型使用者拒絕了', async () => {
    const h = harness([reply('', call('create_note', {})), reply('好的，不建立。')], {
      decide: () => ({ approved: false })
    })
    await h.run()
    expect(h.applied).toEqual([])
    expect(h.steps()[0]).toMatchObject({ status: 'rejected', proposal: PROPOSAL })
    expect(toolMessages(h.calls[1].messages)[0].content).toBe(REJECTED)
  })

  it('寫入失敗時步驟顯示錯誤，錯誤回給模型', async () => {
    const h = harness([reply('', call('create_note', {})), reply('失敗了')], {
      apply: async () => {
        throw new Error('A note with this name already exists: 比較.md')
      }
    })
    await h.run()
    expect(h.steps()[0]).toMatchObject({ status: 'error', proposal: PROPOSAL })
    expect(toolMessages(h.calls[1].messages)[0].content).toMatch(/^Error: A note/)
  })

  it('等待確認時取消：不寫入，丟出 aborted', async () => {
    const ac = new AbortController()
    const h = harness([reply('', call('create_note', {})), reply('不該出現')], {
      signal: ac.signal,
      decide: () => {
        ac.abort()
        return { approved: false }
      }
    })
    await expect(h.run()).rejects.toMatchObject({ kind: 'aborted' })
    expect(h.applied).toEqual([])
    expect(h.calls).toHaveLength(1)
  })

  it('工具結果過長時截斷；字數預算用完後不再提供工具，舊結果不改寫', async () => {
    const big = TOOL_RESULT_MAX + 500
    const replies = Array.from({ length: 20 }, (_, i) =>
      reply('', call('get_note', { path: `p${i}`, big }))
    )
    const h = harness(replies, { maxSteps: 20 })
    await h.run()
    const n = Math.ceil(AGENT_CONTEXT_MAX / TOOL_RESULT_MAX)
    expect(h.steps()).toHaveLength(n)
    expect(h.calls.map((c) => c.tools !== null)).toEqual([...Array<boolean>(n).fill(true), false])
    const last = h.calls[h.calls.length - 1].messages
    expect(last[last.length - 1]).toMatchObject({ role: 'user' })
    const results = toolMessages(last)
    expect(results[0].content).toBe(`${'x'.repeat(TOOL_RESULT_MAX)}\n(…truncated)`)
    expect(results.every((m) => m.content.endsWith('(…truncated)'))).toBe(true)
    expect(results.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(
      AGENT_CONTEXT_MAX + TOOL_RESULT_MIN + 20
    )
    // 每次送出的對話都以上一次的對話開頭（Ollama 的 prompt 快取才有效）
    for (let i = 1; i < h.calls.length; i++) {
      expect(h.calls[i].messages.slice(0, h.calls[i - 1].messages.length)).toEqual(
        h.calls[i - 1].messages
      )
    }
  })

  it('預算快用完時，新的結果截到剩下的預算，但至少保留 TOOL_RESULT_MIN 字', async () => {
    const first = AGENT_CONTEXT_MAX - TOOL_RESULT_MIN / 2
    const h = harness(
      [
        reply(
          '',
          call('get_note', { path: 'a', big: TOOL_RESULT_MAX }),
          call('get_note', { path: 'b', big: TOOL_RESULT_MAX }),
          call('get_note', { path: 'c', big: TOOL_RESULT_MAX }),
          call('get_note', { path: 'd', big: first - 3 * TOOL_RESULT_MAX })
        ),
        reply('', call('get_note', { path: 'e', big: TOOL_RESULT_MAX })),
        reply('完成')
      ],
      { maxSteps: 20 }
    )
    await h.run()
    const results = toolMessages(h.calls[1].messages)
    expect(results.map((m) => m.content.length)).toEqual([
      TOOL_RESULT_MAX,
      TOOL_RESULT_MAX,
      TOOL_RESULT_MAX,
      first - 3 * TOOL_RESULT_MAX
    ])
    // 還有一點預算：再提供一次工具，結果至少 TOOL_RESULT_MIN 字
    expect(h.calls[1].tools).not.toBeNull()
    const e = toolMessages(h.calls[2].messages)[4].content
    expect(e).toBe(`${'x'.repeat(TOOL_RESULT_MIN)}\n(…truncated)`)
    expect(h.calls[2].tools).toBeNull()
  })

  it('回答中只保留工具結果裡出現過的連結', async () => {
    const h = harness([
      reply('', call('get_note', { path: '原子習慣' })),
      reply('[[原子習慣]] 連到 [[深度工作]]，也許還有 [[編造的筆記]]。')
    ])
    await h.run()
    expect(h.text()).toBe('[[原子習慣]] 連到 [[深度工作]]，也許還有 編造的筆記。')
  })
})

describe('agentMessages', () => {
  it('系統提示詞含今天的日期與星期，附上之前的對話', () => {
    const m = agentMessages(
      ' 整理上週的筆記 ',
      [
        { role: 'user', content: '之前的任務' },
        { role: 'assistant', content: '之前的回答 [1]' }
      ],
      'zh-TW',
      NOW
    )
    expect(m[0].content).toContain('今天是 2026-10-18（日）')
    expect(m[0].content).not.toMatch(/\[\[/)
    expect(m.slice(1)).toEqual([
      { role: 'user', content: '之前的任務' },
      { role: 'assistant', content: '之前的回答' },
      { role: 'user', content: '整理上週的筆記' }
    ])
    expect(agentMessages('x', [], 'en', NOW)[0].content).toContain('Today is 2026-10-18 (Sunday)')
  })

  it('之前的對話只附最近幾則，每則截短', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${i}`.repeat(AGENT_HISTORY_CHARS + 100)
    }))
    const m = agentMessages('任務', history, 'zh-TW', NOW)
    const past = m.slice(1, -1)
    expect(past).toHaveLength(AGENT_HISTORY_MESSAGES)
    expect(past[0].content.startsWith('6')).toBe(true)
    expect(past.every((p) => p.content.length === AGENT_HISTORY_CHARS + 1)).toBe(true)
  })
})
