// Character budgets for note content sent to the model, scaled by the configured context length.
// Each module's constants are the values at context = 8192 tokens (tuned for Ollama on a CPU), so behavior is unchanged at 8192.
import { AGENT_CONTEXT_MAX, TOOL_RESULT_MAX, TOOL_RESULT_MIN } from './agent/loop'
import { NOTE_CHARS } from './agent/tools'
import { ASK_CHUNK_MAX, ASK_CONTEXT_MAX } from './ask'
import { SUMMARY_DIRECT_MAX, SUMMARY_PART_MAX } from './summarize'

/** The context length (tokens) the existing constants correspond to */
export const BASE_CONTEXT_TOKENS = 8_192

export interface ChatBudget {
  /** Total characters of Q&A sources */
  askContext: number
  /** Character limit per Q&A chunk */
  askChunk: number
  /** Summaries longer than this are split */
  summaryDirect: number
  /** Characters per part when a summary is split */
  summaryPart: number
  /** Character budget for all of the agent's tool results */
  agentContext: number
  /** Character limit per agent tool result */
  toolResult: number
  /** Characters per get_note page (still within toolResult with the header) */
  noteChars: number
}

/** Scales the character budgets by context length; the number of Q&A sources, history length and agent steps aren't scaled */
export function chatBudget(contextTokens: number): ChatBudget {
  const ratio = contextTokens / BASE_CONTEXT_TOKENS
  const scale = (n: number): number => Math.max(1, Math.round(n * ratio))
  return {
    askContext: scale(ASK_CONTEXT_MAX),
    askChunk: scale(ASK_CHUNK_MAX),
    summaryDirect: scale(SUMMARY_DIRECT_MAX),
    summaryPart: scale(SUMMARY_PART_MAX),
    agentContext: scale(AGENT_CONTEXT_MAX),
    toolResult: Math.max(TOOL_RESULT_MIN, scale(TOOL_RESULT_MAX)),
    noteChars: scale(NOTE_CHARS)
  }
}
