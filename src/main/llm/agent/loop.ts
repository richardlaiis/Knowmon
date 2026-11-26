// The agent loop: the model replies with tool calls → they run (write tools wait for the user's confirmation first) → results are added to the conversation → next step,
// until the model answers directly or the step limit is reached. Chat, tools and confirmation are all injected by the caller.
import { linkKey } from '../../../shared/links'
import { localDay } from '../../../shared/time'
import type {
  AgentChunk,
  AgentDecision,
  AgentProposal,
  AgentStep,
  AgentToolName,
  ChatTurn,
  SummaryLanguage
} from '../../../shared/types'
import { historyMessages } from '../ask'
import type { ChatBudget } from '../budget'
import { OllamaError, type ChatMessage, type ChatResult, type ToolDefinition } from '../ollama'
import { createLinkFilter } from '../summarize'
import { callLabel, isToolName, type ToolOutcome } from './tools'

// On a CPU, reading the prompt runs at only about 17 tokens/s (Chinese is about one token per character), so the length of tool results directly sets the task time.
/** Maximum number of tool calls; after that the model is asked to answer directly */
export const AGENT_MAX_STEPS = 5
/** Maximum characters per tool result */
export const TOOL_RESULT_MAX = 1_500
/**
 * Character budget for all tool results combined. New results are cut to the remaining budget (at least TOOL_RESULT_MIN),
 * and tools stop being offered once it's used up. Old results are never rewritten: changing an earlier message invalidates Ollama's prompt cache and everything must be read again.
 */
export const AGENT_CONTEXT_MAX = 6_000
/** Minimum characters kept per result when the budget is nearly used up */
export const TOOL_RESULT_MIN = 300
/** Earlier tasks and answers: at most this many messages, this many characters each */
export const AGENT_HISTORY_MESSAGES = 4
export const AGENT_HISTORY_CHARS = 600

/** When tools is null, no tools are offered (asking the model to answer directly) */
export type ToolChat = (
  messages: ChatMessage[],
  tools: readonly ToolDefinition[] | null,
  onDelta: (text: string) => void
) => Promise<ChatResult>

export interface AgentTools {
  definitions: readonly ToolDefinition[]
  run(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome>
  apply(proposal: AgentProposal, edited?: AgentProposal): Promise<ToolOutcome>
}

export interface AgentLoopOptions {
  chat: ToolChat
  tools: AgentTools
  /** Pushes a text chunk or a step */
  emit: (c: Omit<AgentChunk, 'id' | 'done'>) => void
  /** Waits for the user to confirm a write proposal; should return approved: false when cancelled */
  confirm: (step: AgentStep) => Promise<AgentDecision>
  signal: AbortSignal
  maxSteps?: number
  /** Character budget for tool results; defaults to AGENT_CONTEXT_MAX and TOOL_RESULT_MAX */
  budget?: Pick<ChatBudget, 'agentContext' | 'toolResult'>
}

// Tested: when told only that "the user rejected it", qwen3:8b still answered that the note was created
export const REJECTED =
  'REJECTED: the user declined this change, so it was NOT made and nothing was written. In your reply, say clearly that this change was not made; never say it was done. Do not try it again unless the user asks.'
export const REPEATED =
  'You already called this tool with the same arguments; use the earlier result above.'
const LIMIT: Record<SummaryLanguage, string> = {
  'zh-TW': '工具的使用次數已經用完。請根據上面的結果直接完成任務並回覆。',
  en: 'You have used all the tool calls. Finish the task now using the results above.'
}

const WEEKDAYS: Record<SummaryLanguage, string[]> = {
  'zh-TW': ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
}

// No [[...]] examples (small models copy them verbatim into the answer)
function systemPrompt(language: SummaryLanguage, now: number): string {
  const today = `${localDay(now)}（${WEEKDAYS[language][new Date(now).getDay()]}）`
  if (language === 'zh-TW') {
    return [
      '你是使用者的筆記助理，可以用工具查詢使用者的筆記，並在使用者要求時建立筆記或加上標籤。',
      `今天是 ${today}。`,
      '- 一律使用繁體中文。',
      '- 先用 search_notes 或 list_notes_in_range 找出相關的筆記，需要細節時再用 get_note 讀全文；要找與某篇相關的筆記時用 get_neighbors。',
      `- 工具最多只能用 ${AGENT_MAX_STEPS} 次，而且每次都很花時間：搜尋結果的摘要足以回答時就直接回答，不要再讀全文。`,
      '- 只有使用者提到時間時才使用 period 參數，照抄使用者的說法（例如「上週」「2026-09」），不要自己換算日期；沒提到時間就不要加。',
      '- 只根據工具的結果回答，不要編造筆記內容，也不要用自己的知識補充。找不到就直接說。',
      '- 提到筆記時，用雙中括號包住筆記標題（就是 wikilink），括號裡只寫標題，不要加路徑或日期；只能使用工具結果中出現過的標題。',
      '- 只有使用者要求時才使用 create_note 或 add_tags。寫入前先把需要的內容查清楚，一次寫好；使用者會先確認。工具結果是 REJECTED 時，表示使用者拒絕、沒有寫入，回覆時要說明沒有完成，不要重試同一個動作。',
      '- 新筆記的內容用 Markdown，提到其他筆記時用 wikilink。',
      '- 完成後簡潔地回報結果，不要加前言或結語。'
    ].join('\n')
  }
  return [
    "You are a note assistant. You can use tools to look up the user's notes, and create notes or add tags when the user asks.",
    `Today is ${localDay(now)} (${WEEKDAYS.en[new Date(now).getDay()]}).`,
    '- Always write in English, even when the notes are in another language.',
    '- First find relevant notes with search_notes or list_notes_in_range; use get_note to read a note in full when you need details, and get_neighbors to find notes related to a note.',
    `- You can use tools at most ${AGENT_MAX_STEPS} times, and each call is slow: when the search passages are enough to answer, answer without reading full notes.`,
    '- Use the period parameter only when the user mentions a time, copying their own words (e.g. "last week", "2026-09"); never calculate dates yourself, and leave it out otherwise.',
    '- Answer only from the tool results. Never invent note contents or add outside knowledge. If nothing is found, say so.',
    '- When you mention a note, write only its title inside double square brackets (a wikilink), without the path or date. Only use titles that appeared in tool results.',
    '- Only use create_note or add_tags when the user asks. Gather what you need first and write it in one go; the user confirms before anything is written. A REJECTED result means the user declined and nothing was written: say the change was not made, and do not retry it.',
    '- Write new notes in Markdown, using wikilinks when mentioning other notes.',
    '- When done, report the result briefly, with no preamble or closing remarks.'
  ].join('\n')
}

export function agentMessages(
  task: string,
  history: readonly ChatTurn[],
  language: SummaryLanguage,
  now: number
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(language, now) },
    ...historyMessages(history, AGENT_HISTORY_MESSAGES, AGENT_HISTORY_CHARS),
    { role: 'user', content: task.trim() }
  ]
}

/** The same call regardless of argument order */
function callKey(name: string, args: Record<string, unknown>): string {
  const sorted = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])])
        )
      : v
  return `${name}:${JSON.stringify(sorted(args))}`
}

function clipResult(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n(…truncated)` : text
}

const aborted = (): OllamaError => new OllamaError('Cancelled', 'aborted')
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Runs a task. Tool calls and results are only appended to messages; existing messages are never changed (to keep Ollama's prompt cache).
 * [[links]] in the final answer keep only notes and links that appeared in tool results.
 */
export async function runAgent(
  opts: AgentLoopOptions,
  messages: ChatMessage[],
  language: SummaryLanguage = 'zh-TW'
): Promise<void> {
  const { chat, tools, emit, signal } = opts
  const max = opts.maxSteps ?? AGENT_MAX_STEPS
  const contextMax = opts.budget?.agentContext ?? AGENT_CONTEXT_MAX
  const resultMax = opts.budget?.toolResult ?? TOOL_RESULT_MAX
  const allowed = new Map<string, string>()
  const allow = (targets: readonly string[]): void => {
    for (const t of targets) allowed.set(linkKey(t), t)
  }
  const seen = new Set<string>()
  /** Characters of tool results used so far */
  let used = 0
  let steps = 0

  const step = (s: AgentStep): void => emit({ delta: '', step: s })

  const execute = async (
    index: number,
    name: AgentToolName,
    args: Record<string, unknown>
  ): Promise<string> => {
    const base: AgentStep = {
      index,
      tool: name,
      args,
      status: 'running',
      label: callLabel(name, args),
      notes: []
    }
    step(base)
    const key = callKey(name, args)
    if (seen.has(key)) {
      step({ ...base, status: 'done', label: `${base.label} (repeated, skipped)` })
      return REPEATED
    }
    seen.add(key)
    try {
      const out = await tools.run(name, args)
      if (signal.aborted) throw aborted()
      allow(out.notes.map((n) => n.title))
      allow(out.links ?? [])
      const result = { ...base, label: out.label, notes: out.notes }
      if (!out.proposal) {
        step({ ...result, status: 'done' })
        return out.text
      }
      const waiting: AgentStep = { ...result, status: 'confirm', proposal: out.proposal }
      step(waiting)
      const decision = await opts.confirm(waiting)
      if (signal.aborted) throw aborted()
      if (!decision.approved) {
        step({ ...waiting, status: 'rejected' })
        return REJECTED
      }
      try {
        const applied = await tools.apply(out.proposal, decision.edited)
        allow(applied.notes.map((n) => n.title))
        step({
          ...waiting,
          status: 'applied',
          label: applied.label,
          notes: applied.notes,
          proposal: applied.proposal ?? out.proposal
        })
        return applied.text
      } catch (e) {
        // The write failed (for example someone created a note with the same name while waiting): keep the proposal so the user sees what was to be written
        step({ ...waiting, status: 'error', error: errorMessage(e) })
        return `Error: ${errorMessage(e)}`
      }
    } catch (e) {
      if (signal.aborted) throw aborted()
      // After a call fails, don't block retries until the model corrects its arguments
      seen.delete(key)
      step({ ...base, status: 'error', error: errorMessage(e) })
      return `Error: ${errorMessage(e)}`
    }
  }

  let index = 0
  for (;;) {
    const offer = steps < max && used < contextMax
    const filter = createLinkFilter([...allowed.values()])
    const res = await chat(messages, offer ? tools.definitions : null, (d) => {
      const t = filter.push(d)
      if (t) emit({ delta: t })
    })
    const rest = filter.flush()
    if (rest) emit({ delta: rest })
    if (signal.aborted) throw aborted()
    const calls = offer ? res.toolCalls : []
    if (calls.length === 0) return

    messages.push({
      role: 'assistant',
      content: res.content,
      // Cloud API ids and thought signatures must go back verbatim (the Ollama client strips them before sending)
      tool_calls: calls.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        ...(c.extra !== undefined ? { extra: c.extra } : {}),
        function: { name: c.name, arguments: c.arguments }
      }))
    })
    for (const call of calls) {
      let text: string
      if (!isToolName(call.name)) {
        const names = tools.definitions.map((d) => d.function.name).join(', ')
        text = `Error: unknown tool "${call.name}". Available tools: ${names}.`
      } else if (steps >= max) {
        text = 'Not executed: the tool call limit was reached.'
      } else {
        text = await execute(index++, call.name, call.arguments)
      }
      steps++
      const room = Math.max(TOOL_RESULT_MIN, Math.min(resultMax, contextMax - used))
      const content = clipResult(text, room)
      used += content.length
      messages.push({
        role: 'tool',
        tool_name: call.name,
        ...(call.id ? { tool_call_id: call.id } : {}),
        content
      })
    }
    if (steps >= max || used >= contextMax) {
      messages.push({ role: 'user', content: LIMIT[language] })
    }
  }
}
