// Agent 迴圈：模型回覆工具呼叫 → 執行（寫入工具先等使用者確認）→ 結果加回對話 → 下一步，
// 直到模型直接回答或達到步數上限。chat、工具、確認都由呼叫者注入。
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
import { OllamaError, type ChatMessage, type ChatResult, type ToolDefinition } from '../ollama'
import { createLinkFilter } from '../summarize'
import { callLabel, isToolName, type ToolOutcome } from './tools'

// 在 CPU 上讀入 prompt 只有約 17 tokens/s（中文約一字一 token），工具結果的長度直接決定任務時間。
/** 最多呼叫幾次工具；用完後要求模型直接回答 */
export const AGENT_MAX_STEPS = 5
/** 每個工具結果最多幾個字 */
export const TOOL_RESULT_MAX = 1_500
/**
 * 所有工具結果加起來的字數預算。新的結果截到剩下的預算（至少 TOOL_RESULT_MIN），
 * 用完後不再提供工具。舊結果一律不改寫：改了前面的訊息，Ollama 的 prompt 快取就失效，整段要重新讀入。
 */
export const AGENT_CONTEXT_MAX = 6_000
/** 預算快用完時，每個結果仍至少保留幾個字 */
export const TOOL_RESULT_MIN = 300
/** 之前的任務與回答：最多幾則、每則幾個字 */
export const AGENT_HISTORY_MESSAGES = 4
export const AGENT_HISTORY_CHARS = 600

/** tools 為 null 時不提供工具（要求模型直接回答） */
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
  /** 推送文字片段或步驟 */
  emit: (c: Omit<AgentChunk, 'id' | 'done'>) => void
  /** 等待使用者確認寫入提案；取消時應回傳 approved: false */
  confirm: (step: AgentStep) => Promise<AgentDecision>
  signal: AbortSignal
  maxSteps?: number
}

// 實測：只說「使用者拒絕了」時，qwen3:8b 仍回答「已建立」
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

// 不寫 [[...]] 範例（小模型會原樣抄進回答）
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

/** 參數順序不同也算同一個呼叫 */
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
 * 執行任務。messages 只會在後面加入工具呼叫與結果，已有的訊息不改（保住 Ollama 的 prompt 快取）。
 * 最終回答中的 [[連結]] 只保留工具結果中出現過的筆記與連結。
 */
export async function runAgent(
  opts: AgentLoopOptions,
  messages: ChatMessage[],
  language: SummaryLanguage = 'zh-TW'
): Promise<void> {
  const { chat, tools, emit, signal } = opts
  const max = opts.maxSteps ?? AGENT_MAX_STEPS
  const allowed = new Map<string, string>()
  const allow = (targets: readonly string[]): void => {
    for (const t of targets) allowed.set(linkKey(t), t)
  }
  const seen = new Set<string>()
  /** 工具結果已用掉的字數 */
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
        // 寫入失敗（例如等待期間有人建立了同名筆記）：保留提案讓使用者看到寫了什麼
        step({ ...waiting, status: 'error', error: errorMessage(e) })
        return `Error: ${errorMessage(e)}`
      }
    } catch (e) {
      if (signal.aborted) throw aborted()
      // 同一個呼叫出錯後，模型修正參數前不必擋下重試
      seen.delete(key)
      step({ ...base, status: 'error', error: errorMessage(e) })
      return `Error: ${errorMessage(e)}`
    }
  }

  let index = 0
  for (;;) {
    const offer = steps < max && used < AGENT_CONTEXT_MAX
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
      tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
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
      const room = Math.max(TOOL_RESULT_MIN, Math.min(TOOL_RESULT_MAX, AGENT_CONTEXT_MAX - used))
      const content = clipResult(text, room)
      used += content.length
      messages.push({ role: 'tool', tool_name: call.name, content })
    }
    if (steps >= max || used >= AGENT_CONTEXT_MAX) {
      messages.push({ role: 'user', content: LIMIT[language] })
    }
  }
}
