// 總結筆記或選取文字。過長的內容先分段各自摘要，再合併成一份（map-reduce）。
import { linkKey, wikilinkTarget } from '../../shared/links'
import { chunkMarkdown } from '../indexer/chunk'
import { extractWikilinks } from '../indexer/parse'
import type { SummaryLanguage } from '../../shared/types'
import type { ChatMessage } from './ollama'

/** 超過這個字數就分段摘要（qwen3:8b 的預設 context 約 4K–8K tokens） */
export const SUMMARY_DIRECT_MAX = 12_000
/** 分段摘要時每段的字數上限 */
export const SUMMARY_PART_MAX = 6_000

export type Chat = (messages: ChatMessage[], onDelta?: (text: string) => void) => Promise<string>

// 提示詞裡不寫出 [[...]] 的範例：小模型會把範例原樣抄進總結
const SYSTEM: Record<SummaryLanguage, string> = {
  'zh-TW': [
    '你是筆記助理，負責總結使用者的筆記。',
    '- 一律使用繁體中文。',
    '- 以 Markdown 條列 3–7 個重點；內容很短時可以更少。必要時在最前面加一句總覽。',
    '- 雙中括號是筆記之間的連結。只能使用「可用連結」清單中的連結，並一字不差地照抄（含雙中括號）；清單是「無」時，完全不要使用雙中括號。不要替一般詞語加上雙中括號，也不要自己創造連結。',
    '- 保留專有名詞。只根據提供的內容，不要補充或編造。',
    '- 直接輸出總結，不要加前言、結語或標題。'
  ].join('\n'),
  en: [
    "You are a note assistant that summarizes the user's notes.",
    '- Always write in English, even when the note is in another language.',
    '- Always answer with a Markdown bullet list ("- ") of 3–7 key points; use fewer bullets if the content is short. A one-sentence overview may come before the list.',
    '- Double square brackets are links between notes. Only use links from the "Available links" list, copied character for character including the brackets, even when the text inside is not English; never translate them. You may add an English translation in parentheses after a link. If the list says "none", never use double square brackets. Never put ordinary words in double square brackets or invent links.',
    '- Keep proper nouns. Use only the provided content; do not add or invent anything.',
    '- Output the summary directly, with no preamble, closing remarks or heading.'
  ].join('\n')
}

/** 使用者訊息的文字，依語言 */
const ASK = {
  'zh-TW': {
    note: (title: string) => `請總結這篇筆記「${title}」：`,
    selection: (title: string) => `請總結筆記「${title}」中選取的這段文字：`,
    part: (title: string, i: number, n: number) =>
      `以下是筆記「${title}」的第 ${i}/${n} 段，請條列這段的重點：`,
    partLabel: (i: number) => `第 ${i} 段重點：`,
    combine: (title: string) => `以下是筆記「${title}」各段的重點，請整合成整篇筆記的總結：`,
    links: (list: string) => `可用連結：${list || '無'}`,
    separator: '、',
    reminder: ''
  },
  en: {
    note: (title: string) => `Summarize the note "${title}" in English:`,
    selection: (title: string) =>
      `Summarize this selected text from the note "${title}" in English:`,
    part: (title: string, i: number, n: number) =>
      `This is part ${i}/${n} of the note "${title}". List the key points of this part in English:`,
    partLabel: (i: number) => `Key points of part ${i}:`,
    combine: (title: string) =>
      `These are the key points of each part of the note "${title}". Combine them into one English summary of the whole note:`,
    links: (list: string) => `Available links: ${list || 'none'}`,
    separator: ', ',
    // 內容是中文時模型容易跟著用中文，在內容後面再提醒一次
    reminder: 'Write in English. Copy available links exactly; do not create other links.'
  }
} satisfies Record<SummaryLanguage, unknown>

export type SummaryKind = 'note' | 'selection'

/** 原文中的連結目標（去重，保留第一次出現的寫法） */
export function linkTargets(text: string): string[] {
  const seen = new Map<string, string>()
  for (const l of extractWikilinks(text)) {
    if (!seen.has(linkKey(l.target))) seen.set(linkKey(l.target), l.target)
  }
  return [...seen.values()]
}

/** 內容放在 <<< >>> 之間，後面附上可用連結清單 */
function wrap(text: string, links: readonly string[], language: SummaryLanguage): string {
  const ask = ASK[language]
  const list = ask.links(links.map((t) => `[[${t}]]`).join(ask.separator))
  return [`<<<\n${text}\n>>>`, list, ask.reminder].filter(Boolean).join('\n\n')
}

export function summaryMessages(
  kind: SummaryKind,
  title: string,
  text: string,
  language: SummaryLanguage = 'zh-TW',
  links: readonly string[] = linkTargets(text)
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM[language] },
    { role: 'user', content: `${ASK[language][kind](title)}\n\n${wrap(text, links, language)}` }
  ]
}

function partMessages(
  title: string,
  text: string,
  index: number,
  count: number,
  language: SummaryLanguage
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM[language] },
    {
      role: 'user',
      content: `${ASK[language].part(title, index, count)}\n\n${wrap(text, linkTargets(text), language)}`
    }
  ]
}

function combineMessages(
  title: string,
  parts: string[],
  links: readonly string[],
  language: SummaryLanguage
): ChatMessage[] {
  const joined = parts.map((p, i) => `${ASK[language].partLabel(i + 1)}\n${p}`).join('\n\n')
  return [
    { role: 'system', content: SYSTEM[language] },
    { role: 'user', content: `${ASK[language].combine(title)}\n\n${wrap(joined, links, language)}` }
  ]
}

/**
 * 串流過濾：原文沒有的 [[連結]] 改成純文字（顯示文字或目標）。
 * 可能是連結開頭的部分先暫存，等到 ]] 或換行才輸出。
 */
export function createLinkFilter(allowed: readonly string[]): {
  push(delta: string): string
  flush(): string
} {
  const keys = new Set(allowed.map(linkKey))
  let pending = ''
  const process = (final: boolean): string => {
    let out = ''
    for (;;) {
      const i = pending.indexOf('[[')
      if (i < 0) {
        // 結尾的單一個 [ 可能是下一個連結的開頭
        const keep = !final && pending.endsWith('[') ? 1 : 0
        out += pending.slice(0, pending.length - keep)
        pending = pending.slice(pending.length - keep)
        return out
      }
      out += pending.slice(0, i)
      pending = pending.slice(i)
      const m = /^\[\[([^[\]\n]+?)\]\]/.exec(pending)
      if (m) {
        const inner = m[1]
        const target = wikilinkTarget(inner)
        const label = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : target || inner
        if (!target || !keys.has(linkKey(target))) out += label
        // 模型把路徑寫成顯示文字（[[標題 | 資料夾/標題.md]]）或寫了多餘的空白：只留標題
        else if (inner.includes('|') && isPathLabel(label, target)) out += `[[${target}]]`
        else out += m[0]
        pending = pending.slice(m[0].length)
        continue
      }
      // 還沒收到 ]]：可能是連結的一部分，等下一個片段
      if (!final && /^\[\[[^[\]\n]*\]?$/.test(pending)) return out
      // 不是連結（換行、多餘的 [ 等）：輸出一個字元後繼續找
      out += pending[0]
      pending = pending.slice(1)
    }
  }
  return {
    push(delta) {
      pending += delta
      return process(false)
    },
    flush() {
      return process(true)
    }
  }
}

function isPathLabel(label: string, target: string): boolean {
  const l = label.trim()
  return /\.md$/i.test(l) || l.includes('/') || linkKey(l) === linkKey(target)
}

/** 把過長的文字依章節與段落分成每段不超過 max 字 */
export function splitForSummary(text: string, max = SUMMARY_PART_MAX): string[] {
  const parts: string[] = []
  let buf = ''
  for (const c of chunkMarkdown(text, max)) {
    if (buf && buf.length + c.text.length + 2 > max) {
      parts.push(buf)
      buf = ''
    }
    buf = buf ? `${buf}\n\n${c.text}` : c.text
  }
  if (buf) parts.push(buf)
  return parts
}

/**
 * 串流總結；只有最後的結果經過 onDelta（分段摘要不會出現在畫面上）。
 * 原文沒有的 [[連結]] 會被改成純文字，回傳值與 onDelta 都是過濾後的內容。
 */
export async function summarize(
  chat: Chat,
  kind: SummaryKind,
  title: string,
  text: string,
  onDelta: (text: string) => void,
  language: SummaryLanguage = 'zh-TW'
): Promise<string> {
  const body = text.trim()
  if (!body) throw new Error(kind === 'note' ? 'This note is empty.' : 'Nothing is selected.')
  const links = linkTargets(body)
  const filter = createLinkFilter(links)
  let out = ''
  const emit = (t: string): void => {
    if (!t) return
    out += t
    onDelta(t)
  }
  const final = (messages: ChatMessage[]): Promise<void> =>
    chat(messages, (d) => emit(filter.push(d))).then(() => emit(filter.flush()))

  if (body.length <= SUMMARY_DIRECT_MAX) {
    await final(summaryMessages(kind, title, body, language, links))
    return out
  }
  const parts = splitForSummary(body)
  const notes: string[] = []
  for (let i = 0; i < parts.length; i++) {
    notes.push(await chat(partMessages(title, parts[i], i + 1, parts.length, language)))
  }
  await final(combineMessages(title, notes, links, language))
  return out
}
