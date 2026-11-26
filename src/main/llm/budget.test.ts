import { describe, expect, it } from 'vitest'
import { AGENT_CONTEXT_MAX, TOOL_RESULT_MAX, TOOL_RESULT_MIN } from './agent/loop'
import { NOTE_CHARS } from './agent/tools'
import { ASK_CHUNK_MAX, ASK_CONTEXT_MAX } from './ask'
import { BASE_CONTEXT_TOKENS, chatBudget } from './budget'
import { SUMMARY_DIRECT_MAX, SUMMARY_PART_MAX } from './summarize'

describe('chatBudget', () => {
  it('equals the existing constants at 8192 (default behavior unchanged)', () => {
    expect(BASE_CONTEXT_TOKENS).toBe(8192)
    expect(chatBudget(8192)).toEqual({
      askContext: ASK_CONTEXT_MAX,
      askChunk: ASK_CHUNK_MAX,
      summaryDirect: SUMMARY_DIRECT_MAX,
      summaryPart: SUMMARY_PART_MAX,
      agentContext: AGENT_CONTEXT_MAX,
      toolResult: TOOL_RESULT_MAX,
      noteChars: NOTE_CHARS
    })
  })

  it('scales proportionally to the context length', () => {
    const big = chatBudget(32768)
    expect(big.askContext).toBe(ASK_CONTEXT_MAX * 4)
    expect(big.summaryPart).toBe(SUMMARY_PART_MAX * 4)
    expect(big.agentContext).toBe(AGENT_CONTEXT_MAX * 4)
    expect(big.noteChars).toBe(NOTE_CHARS * 4)
    const small = chatBudget(2048)
    expect(small.askContext).toBe(ASK_CONTEXT_MAX / 4)
    expect(small.summaryDirect).toBe(SUMMARY_DIRECT_MAX / 4)
  })

  it("each get_note page stays within a single tool result's limit; tool results stay above the minimum", () => {
    for (const ctx of [2048, 4096, 8192, 65536]) {
      const b = chatBudget(ctx)
      expect(b.noteChars).toBeLessThan(b.toolResult)
      expect(b.toolResult).toBeGreaterThanOrEqual(TOOL_RESULT_MIN)
    }
  })
})
