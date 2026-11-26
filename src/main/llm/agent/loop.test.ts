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
  path: 'Comparison.md',
  content: 'Content',
  missingLinks: []
}

interface Harness {
  chunks: Omit<AgentChunk, 'id' | 'done'>[]
  /** A copy of the messages and the tool list each chat call received */
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
    budget?: { agentContext: number; toolResult: number }
  } = {}
): Harness {
  const h: Harness = {
    chunks: [],
    calls: [],
    applied: [],
    confirmed: [],
    steps: () => {
      // Replace by index, keeping the latest state
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
          maxSteps: opts.maxSteps,
          budget: opts.budget
        },
        agentMessages('task', [], 'zh-TW', NOW)
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
          ? { text: '', label: 'Create Comparison.md', notes: [], proposal: PROPOSAL }
          : {
              text: `Result of ${name}`,
              label: `${name} done`,
              notes: [{ path: 'Books/Atomic Habits.md', title: 'Atomic Habits' }],
              links: ['Deep Work'],
              ...(args.big ? { text: 'x'.repeat(Number(args.big)) } : {})
            }),
    apply: async (proposal, edited) => {
      if (opts.apply) return opts.apply(proposal, edited)
      h.applied.push({ proposal, edited })
      const path = edited?.kind === 'create_note' ? edited.path : proposal.path
      return {
        text: `Created ${path}`,
        label: `Created ${path}`,
        notes: [{ path, title: 'Comparison' }]
      }
    }
  }
  return h
}

const toolMessages = (m: ChatMessage[]): ChatMessage[] => m.filter((x) => x.role === 'tool')

describe('runAgent', () => {
  it('multi-step: runs tools, adds results to the conversation, then streams the answer', async () => {
    const h = harness([
      reply('Let me search first. ', call('search_notes', { query: 'habits' })),
      reply('', call('get_note', { path: 'Atomic Habits' })),
      reply('The key idea of [[Atomic Habits]] is to improve every day.')
    ])
    await h.run()
    expect(h.steps().map((s) => [s.index, s.tool, s.status, s.label])).toEqual([
      [0, 'search_notes', 'done', 'search_notes done'],
      [1, 'get_note', 'done', 'get_note done']
    ])
    // Each step is sent as running first
    expect(h.chunks.find((c) => c.step)!.step!.status).toBe('running')
    expect(h.text()).toBe(
      'Let me search first. The key idea of [[Atomic Habits]] is to improve every day.'
    )

    const last = h.calls[2].messages
    expect(last.slice(-4).map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
    expect(last[last.length - 4]).toMatchObject({
      content: 'Let me search first. ',
      tool_calls: [{ function: { name: 'search_notes', arguments: { query: 'habits' } } }]
    })
    expect(last[last.length - 1]).toEqual({
      role: 'tool',
      tool_name: 'get_note',
      content: 'Result of get_note'
    })
    expect(h.calls.every((c) => c.tools === TOOL_DEFINITIONS)).toBe(true)
  })

  it('cloud API tool call id and extra go into the assistant message, and tool messages carry the matching id', async () => {
    const h = harness([
      reply('', {
        ...call('get_note', { path: 'a' }),
        id: 'call_1',
        extra: { google: { thought_signature: 'sig' } }
      }),
      reply('Done')
    ])
    await h.run()
    const m = h.calls[1].messages
    expect(m.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          extra: { google: { thought_signature: 'sig' } },
          function: { name: 'get_note', arguments: { path: 'a' } }
        }
      ]
    })
    expect(m.at(-1)).toMatchObject({ role: 'tool', tool_name: 'get_note', tool_call_id: 'call_1' })
  })

  it('runs multiple tool calls from one reply in order', async () => {
    const h = harness([
      reply('', call('get_note', { path: 'a' }), call('get_note', { path: 'b' })),
      reply('Done')
    ])
    await h.run()
    expect(h.steps().map((s) => s.args)).toEqual([{ path: 'a' }, { path: 'b' }])
    expect(toolMessages(h.calls[1].messages)).toHaveLength(2)
  })

  it('after the step limit, tools are no longer offered and a direct answer is requested', async () => {
    const h = harness(
      [
        reply('', call('get_note', { path: 'x' })),
        reply('', call('get_note', { path: 'y' })),
        reply('Answer')
      ],
      {
        maxSteps: 2
      }
    )
    // From the third call on, the model is asked to answer (no tools offered)
    await h.run()
    expect(h.calls.map((c) => c.tools !== null)).toEqual([true, true, false])
    const last = h.calls[2].messages
    expect(last[last.length - 1]).toMatchObject({ role: 'user' })
    // The limit message comes from the zh-TW prompt (runAgent's default language)
    expect(last[last.length - 1].content).toContain('用完')
    expect(h.text()).toBe('Answer')
  })

  it('ignores tool calls the model returns when no tools were offered', async () => {
    const h = harness(
      [
        reply('', call('get_note', { path: 'x' })),
        reply('Answer', call('get_note', { path: 'z' }))
      ],
      {
        maxSteps: 1
      }
    )
    await h.run()
    expect(h.steps()).toHaveLength(1)
  })

  it('does not run a repeated call with the same arguments (in any order)', async () => {
    let runs = 0
    const h = harness(
      [
        reply('', call('search_notes', { query: 'a', limit: 3 })),
        reply('', call('search_notes', { limit: 3, query: 'a' })),
        reply('OK')
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

  it('tool errors and unknown tools: the error goes back to the model and the task continues', async () => {
    const h = harness(
      [
        reply('', call('get_note', { path: 'missing' }), call('delete_everything')),
        reply('Not found')
      ],
      {
        run: async () => {
          throw new ToolError('Note not found: "missing".')
        }
      }
    )
    await h.run()
    expect(h.steps()).toEqual([
      expect.objectContaining({ status: 'error', error: 'Note not found: "missing".' })
    ])
    const results = toolMessages(h.calls[1].messages).map((m) => m.content)
    expect(results[0]).toBe('Error: Note not found: "missing".')
    expect(results[1]).toMatch(/^Error: unknown tool "delete_everything"/)
    expect(h.text()).toBe('Not found')
  })

  it('write tools wait for confirmation and only write and report after Apply', async () => {
    const h = harness([
      reply('', call('create_note', { path: 'Comparison.md', content: 'Content' })),
      reply('Created')
    ])
    await h.run()
    expect(h.confirmed).toEqual([
      expect.objectContaining({ index: 0, status: 'confirm', proposal: PROPOSAL })
    ])
    expect(h.applied).toEqual([{ proposal: PROPOSAL, edited: undefined }])
    expect(h.steps()[0]).toMatchObject({
      status: 'applied',
      label: 'Created Comparison.md',
      notes: [{ path: 'Comparison.md', title: 'Comparison' }]
    })
    expect(toolMessages(h.calls[1].messages)[0].content).toBe('Created Comparison.md')
  })

  it('passes the user-edited proposal to apply', async () => {
    const edited: AgentProposal = { ...PROPOSAL, path: 'Summaries/Comparison.md' }
    const h = harness([reply('', call('create_note', {})), reply('OK')], {
      decide: () => ({ approved: true, edited })
    })
    await h.run()
    expect(h.applied[0].edited).toEqual(edited)
    expect(h.steps()[0].label).toBe('Created Summaries/Comparison.md')
  })

  it('Reject writes nothing and tells the model the user rejected it', async () => {
    const h = harness([reply('', call('create_note', {})), reply('OK, not creating it.')], {
      decide: () => ({ approved: false })
    })
    await h.run()
    expect(h.applied).toEqual([])
    expect(h.steps()[0]).toMatchObject({ status: 'rejected', proposal: PROPOSAL })
    expect(toolMessages(h.calls[1].messages)[0].content).toBe(REJECTED)
  })

  it('a failed write shows the error in the step and returns it to the model', async () => {
    const h = harness([reply('', call('create_note', {})), reply('It failed')], {
      apply: async () => {
        throw new Error('A note with this name already exists: Comparison.md')
      }
    })
    await h.run()
    expect(h.steps()[0]).toMatchObject({ status: 'error', proposal: PROPOSAL })
    expect(toolMessages(h.calls[1].messages)[0].content).toMatch(/^Error: A note/)
  })

  it('cancelling while waiting for confirmation writes nothing and throws aborted', async () => {
    const ac = new AbortController()
    const h = harness([reply('', call('create_note', {})), reply('Should not appear')], {
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

  it('long tool results are cut; once the budget is used up tools stop being offered, and old results are never rewritten', async () => {
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
    // Each request starts with the previous conversation (so Ollama's prompt cache works)
    for (let i = 1; i < h.calls.length; i++) {
      expect(h.calls[i].messages.slice(0, h.calls[i - 1].messages.length)).toEqual(
        h.calls[i - 1].messages
      )
    }
  })

  it('cuts tool results and decides when to stop offering tools by the given budget', async () => {
    const replies = Array.from({ length: 20 }, (_, i) =>
      reply('', call('get_note', { path: `p${i}`, big: 5000 }))
    )
    const h = harness(replies, { maxSteps: 20, budget: { agentContext: 10_000, toolResult: 4000 } })
    await h.run()
    expect(h.steps()).toHaveLength(3)
    const results = toolMessages(h.calls[h.calls.length - 1].messages)
    expect(results.map((m) => m.content.length)).toEqual([
      4000 + '\n(…truncated)'.length,
      4000 + '\n(…truncated)'.length,
      // The remaining budget: 10000 - 2 × 4013
      10_000 - 2 * 4013 + '\n(…truncated)'.length
    ])
  })

  it('near the end of the budget, new results are cut to what remains but keep at least TOOL_RESULT_MIN characters', async () => {
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
        reply('Done')
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
    // A little budget is left: tools are offered once more, with at least TOOL_RESULT_MIN characters
    expect(h.calls[1].tools).not.toBeNull()
    const e = toolMessages(h.calls[2].messages)[4].content
    expect(e).toBe(`${'x'.repeat(TOOL_RESULT_MIN)}\n(…truncated)`)
    expect(h.calls[2].tools).toBeNull()
  })

  it('keeps only links that appeared in tool results in the answer', async () => {
    const h = harness([
      reply('', call('get_note', { path: 'Atomic Habits' })),
      reply('[[Atomic Habits]] links to [[Deep Work]], and maybe [[A made-up note]].')
    ])
    await h.run()
    expect(h.text()).toBe('[[Atomic Habits]] links to [[Deep Work]], and maybe A made-up note.')
  })
})

describe('agentMessages', () => {
  it("the system prompt has today's date and weekday, followed by the earlier conversation", () => {
    const m = agentMessages(
      ' summarize the notes from last week ',
      [
        { role: 'user', content: 'earlier task' },
        { role: 'assistant', content: 'earlier answer [1]' }
      ],
      'zh-TW',
      NOW
    )
    // The zh-TW system prompt states the date and weekday in Chinese
    expect(m[0].content).toContain('今天是 2026-10-18（日）')
    expect(m[0].content).not.toMatch(/\[\[/)
    expect(m.slice(1)).toEqual([
      { role: 'user', content: 'earlier task' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'summarize the notes from last week' }
    ])
    expect(agentMessages('x', [], 'en', NOW)[0].content).toContain('Today is 2026-10-18 (Sunday)')
  })

  it('earlier conversation includes only the last few messages, each shortened', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${i}`.repeat(AGENT_HISTORY_CHARS + 100)
    }))
    const m = agentMessages('task', history, 'zh-TW', NOW)
    const past = m.slice(1, -1)
    expect(past).toHaveLength(AGENT_HISTORY_MESSAGES)
    expect(past[0].content.startsWith('6')).toBe(true)
    expect(past.every((p) => p.content.length === AGENT_HISTORY_CHARS + 1)).toBe(true)
  })
})
