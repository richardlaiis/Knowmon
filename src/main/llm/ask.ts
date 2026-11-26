// Q&A (RAG): parse the time range and keywords from the question, retrieve notes, build a context with numbered sources,
// then stream the answer and filter its citations. Answers cite sources as [n]; numbers outside the sources and [[links]] are removed.
import { withoutTimeRange, parseTimeRange } from '../../shared/timeRange'
import type {
  AskSource,
  ChatTurn,
  DateRange,
  RetrieveHit,
  SummaryLanguage
} from '../../shared/types'
import { getNoteByPath, type DB } from '../db'
import { clip, toSegments } from '../db/segments'
import { listChunks } from '../db/vectors'
import type { ChatMessage } from './ollama'
import { noteDay } from './retrieve'
import { createLinkFilter, linkTargets, type Chat } from './summarize'

/** Maximum number of notes cited */
export const ASK_SOURCES = 8
/** Character limit for all source text combined (the value at context 8192; scaled per settings, see budget.ts) */
export const ASK_CONTEXT_MAX = 8_000
/** Maximum characters taken from a single chunk (for overlong code blocks) */
export const ASK_CHUNK_MAX = 2_000
/** Number of recent Q&A messages included as context (3 rounds) */
export const HISTORY_MESSAGES = 6
/** Maximum characters per history message */
export const HISTORY_CHARS = 1_000
const SNIPPET_MAX = 160

/** Answer in Chinese when the question has more CJK characters than English words */
export function detectLanguage(text: string): SummaryLanguage {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length
  const words = (text.match(/[A-Za-z]+/g) ?? []).length
  return han > 0 && han >= words ? 'zh-TW' : 'en'
}

// Keywords: cut out function words and question words, then OR-search the remaining pieces. Longer ones match first (「是什麼」 before 「什麼」).
// Single characters only include particles that almost never appear inside words (「了」, 「是」 and 「有」 would break 「了解」, 「是否」 and 「有效」).
const ZH_STOP = [
  '為什麼',
  '为什么',
  '是什麼',
  '是什么',
  '有哪些',
  '有什麼',
  '有什么',
  '了什麼',
  '了什么',
  '告訴我',
  '告诉我',
  '有沒有',
  '有没有',
  '什麼',
  '什么',
  '甚麼',
  '哪些',
  '哪個',
  '哪个',
  '哪裡',
  '哪里',
  '如何',
  '怎麼',
  '怎么',
  '怎樣',
  '怎样',
  '為何',
  '为何',
  '是否',
  '請問',
  '请问',
  '關於',
  '关于',
  '相關',
  '相关',
  '筆記',
  '笔记',
  '內容',
  '内容',
  '一下',
  '我的',
  '我們',
  '我们',
  '我在',
  '我有',
  '寫了',
  '写了',
  '寫過',
  '写过',
  '讀了',
  '读了',
  '做了',
  '學了',
  '学了',
  '看了',
  '提到',
  '記錄',
  '记录',
  '總結',
  '总结',
  '整理',
  '請',
  '请',
  '的',
  '嗎',
  '吗',
  '呢',
  '吧',
  '啊',
  '呀'
]
const EN_STOP = new Set(
  (
    'a an the of in on at to for from with about and or is are was were be been do does did ' +
    'i me my we our you your it its this that these those what which who whom how why when ' +
    'where any some there have has had can could would should will tell show give list ' +
    'summarize summary note notes write wrote written say said mention mentioned please ' +
    'between during into than then them they he she his her not no yes'
  ).split(' ')
)

/** Keywords from a question that can be used for full-text search (deduped, in order of appearance) */
export function keywords(text: string): string[] {
  let s = text
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    // 「第二點」 ("the second point") and 「第 3 章」 ("chapter 3") refer to the structure of an earlier answer or note, not its content
    .replace(/第\s*[\d一二三四五六七八九十]+\s*[點点個个項项條条章節节段部]/g, ' ')
    .replace(/(^|\s)(?:那麼|那么|那)(?!些|裡|里|個|个)/g, ' ')
  for (const w of ZH_STOP) s = s.split(w).join(' ')
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of s.split(/\s+/)) {
    const k = t.toLowerCase()
    if ([...t].length < 2 || EN_STOP.has(k) || /^\d+$/.test(t) || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export interface AskQuery {
  /** The time range actually applied; null = no filter */
  range: DateRange | null
  /** Keywords for full-text search (OR) */
  keywords: string[]
  /** Text sent for embedding */
  vectorText: string
}

/** Follow-up phrasing: 「那…」, 「還有…」, 「…呢？」, "what about…" */
const FOLLOW_UP =
  /^\s*(?:那|還有|还有|然後|然后|另外|所以|and\b|so\b|what about\b|how about\b|why\b)|呢\s*[？?]?\s*$/i

/**
 * Decides how to retrieve. When range is undefined it's parsed from the question; time phrases aren't keywords.
 * For follow-ups (no keywords, or phrased like a follow-up), the vector query adds the previous question; with no keywords, the previous question's keywords are reused.
 */
export function planQuery(
  question: string,
  history: readonly ChatTurn[],
  range: DateRange | null | undefined,
  now: number
): AskQuery {
  const match = parseTimeRange(question, now)
  const resolved = range === undefined ? (match?.range ?? null) : range
  const text = withoutTimeRange(question, match)
  const own = keywords(text)
  const prev = [...history].reverse().find((t) => t.role === 'user')
  if (!prev || (own.length > 0 && !FOLLOW_UP.test(text))) {
    return { range: resolved, keywords: own, vectorText: text }
  }
  const prevText = withoutTimeRange(prev.content, parseTimeRange(prev.content, now))
  return {
    range: resolved,
    keywords: own.length > 0 ? own : keywords(prevText),
    vectorText: `${prevText}\n${text}`.trim()
  }
}

/** Notes in the time range (newest first), used when the question has only a time and nothing to retrieve */
export function notesInRange(db: DB, range: DateRange, limit = ASK_SOURCES): RetrieveHit[] {
  const rows = db
    .prepare(
      `SELECT n.id AS id, n.path AS path, n.title AS title, n.event_date AS eventDate,
              n.modified_at AS modifiedAt
       FROM notes n WHERE EXISTS (SELECT 1 FROM chunks c WHERE c.note_id = n.id)`
    )
    .all() as {
    id: number
    path: string
    title: string
    eventDate: string | null
    modifiedAt: number
  }[]
  return rows
    .map((n) => ({ n, day: noteDay(n) }))
    .filter(({ day }) => day >= range.from && day <= range.to)
    .sort((a, b) => (a.day === b.day ? (a.n.path < b.n.path ? -1 : 1) : a.day < b.day ? 1 : -1))
    .slice(0, limit)
    .map(({ n }) => {
      const first = listChunks(db, n.id)[0]
      const c = clip(first.text.trim(), [], SNIPPET_MAX)
      return {
        path: n.path,
        title: n.title,
        score: 0,
        line: first.line,
        snippet: toSegments(c.text, c.ranges),
        via: []
      }
    })
}

/** A source for the prompt: AskSource plus its text */
export interface ContextSource extends AskSource {
  text: string
}

/** The part pushed to the renderer (without the text) */
export function toAskSource(s: ContextSource): AskSource {
  return { n: s.n, path: s.path, title: s.title, line: s.line, snippet: s.snippet, date: s.date }
}

/**
 * Takes each note's most relevant passage (the chunk containing RetrieveHit.line), then adds neighboring chunks round-robin by rank
 * until the total reaches max. Lower-ranked notes that don't fit are left out. Each chunk is cut to chunkMax characters.
 */
export function gatherSources(
  db: DB,
  hits: readonly RetrieveHit[],
  max = ASK_CONTEXT_MAX,
  chunkMax = ASK_CHUNK_MAX
): ContextSource[] {
  interface Item {
    hit: RetrieveHit
    date: string
    chunks: { line: number; text: string }[]
    main: number
    picked: Set<number>
  }
  const items: Item[] = []
  let total = 0
  for (const hit of hits) {
    const note = getNoteByPath(db, hit.path)
    if (!note) continue
    const chunks = listChunks(db, note.id).map((c) => ({
      line: c.line,
      text: c.text.length > chunkMax ? c.text.slice(0, chunkMax) + '…' : c.text
    }))
    if (chunks.length === 0) continue
    let main = 0
    chunks.forEach((c, i) => {
      if (c.line <= hit.line) main = i
    })
    const len = chunks[main].text.length
    if (items.length > 0 && total + len > max) break
    total += len
    items.push({ hit, date: noteDay(note), chunks, main, picked: new Set([main]) })
  }
  // Add neighboring chunks round-robin (the next chunk first), at most one per note per round
  for (let added = true; added;) {
    added = false
    for (const it of items) {
      const near = [...it.picked].flatMap((i) => [i + 1, i - 1])
      const next = near.find((i) => i >= 0 && i < it.chunks.length && !it.picked.has(i))
      if (next === undefined) continue
      const len = it.chunks[next].text.length
      if (total + len > max) continue
      total += len
      it.picked.add(next)
      added = true
    }
  }
  return items.map((it, i) => {
    // Added chunks are all adjacent to selected ones, so the passage is contiguous
    const picked = [...it.picked].sort((a, b) => a - b)
    const parts = picked.map((idx) => it.chunks[idx].text.trim())
    return {
      n: i + 1,
      path: it.hit.path,
      title: it.hit.title,
      line: it.chunks[it.main].line,
      snippet: it.hit.snippet,
      date: it.date,
      text: parts.join('\n\n')
    }
  })
}

// The prompt only has [n] examples; no [[...]] examples (small models copy them verbatim into the answer)
const SYSTEM: Record<SummaryLanguage, string> = {
  'zh-TW': [
    '你是使用者的筆記助理，根據提供的「來源」（使用者自己的筆記）回答問題。',
    '- 一律使用繁體中文。',
    '- 只根據來源回答。來源沒有提到的，直接說筆記裡沒有相關內容；不要編造，也不要用自己的知識補充。',
    '- 在根據來源的句子後面標上來源編號，例如 [1]；根據多個來源時寫成 [1][3]。只能使用來源清單中的編號。',
    '- 雙中括號是筆記之間的連結，只能照抄來源中出現過的連結，不要自己創造。',
    '- 以 Markdown 簡潔、直接地回答，不要加前言或結語。'
  ].join('\n'),
  en: [
    "You are a note assistant. Answer the user's question using only the provided sources (the user's own notes).",
    '- Always write in English, even when the sources are in another language.',
    "- Use only the sources. If they don't cover the question, say the notes don't mention it; never invent anything or add outside knowledge.",
    '- After each statement based on a source, cite its number, like [1]; cite several as [1][3]. Only use numbers from the source list.',
    '- Double square brackets are links between notes. Only copy links that appear in the sources, exactly; never create new ones.',
    '- Answer concisely in Markdown, with no preamble or closing remarks.'
  ].join('\n')
}

const ASK = {
  'zh-TW': {
    sources: '來源：',
    range: (r: DateRange) => `時間範圍：${r.from} – ${r.to}`,
    question: (q: string) => `問題：${q}`,
    reminder: '',
    none: '筆記中找不到相關的內容。',
    noneInRange: (r: DateRange) => `${r.from} – ${r.to} 之間的筆記中找不到相關的內容。`
  },
  en: {
    sources: 'Sources:',
    range: (r: DateRange) => `Time range: ${r.from} – ${r.to}`,
    question: (q: string) => `Question: ${q}`,
    // With Chinese sources the model tends to answer in Chinese
    reminder: 'Answer in English and cite sources as [n].',
    none: 'No relevant notes were found.',
    noneInRange: (r: DateRange) => `No relevant notes were found between ${r.from} and ${r.to}.`
  }
} satisfies Record<SummaryLanguage, unknown>

/** Fixed reply when no sources are found (the model isn't called, to avoid making things up) */
export function noSourcesMessage(language: SummaryLanguage, range: DateRange | null): string {
  return range ? ASK[language].noneInRange(range) : ASK[language].none
}

/** Notice appended when an answer is cut off by the output limit */
export const TRUNCATED_NOTICE: Record<SummaryLanguage, string> = {
  'zh-TW': '\n\n_（回覆達到輸出上限而中斷，可在 AI 設定中調高。）_',
  en: '\n\n_(Reply stopped at the max output limit. You can raise it in AI settings.)_'
}

/** History messages: strip old citation numbers (they referred to earlier sources) and truncation notices, and cut long ones */
export function historyMessages(
  history: readonly ChatTurn[],
  maxMessages = HISTORY_MESSAGES,
  maxChars = HISTORY_CHARS
): ChatMessage[] {
  return history
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-maxMessages)
    .map((t) => {
      let text = t.content
      for (const notice of Object.values(TRUNCATED_NOTICE))
        text = text.split(notice.trim()).join('')
      text = text.replace(/\[\d+\]/g, '').trim()
      return {
        role: t.role,
        content: text.length > maxChars ? text.slice(0, maxChars) + '…' : text
      }
    })
}

export function askMessages(
  question: string,
  sources: readonly ContextSource[],
  history: readonly ChatTurn[],
  range: DateRange | null,
  language: SummaryLanguage
): ChatMessage[] {
  const ask = ASK[language]
  const blocks = sources.map((s) => `[${s.n}] ${s.title}（${s.date}）\n${s.text}`)
  const content = [
    ask.sources,
    blocks.join('\n\n'),
    range ? ask.range(range) : '',
    ask.question(question.trim()),
    ask.reminder
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: SYSTEM[language] },
    ...historyMessages(history),
    { role: 'user', content }
  ]
}

/**
 * Filters citations while streaming: [1, 2], [1][2] and 【1】 are normalized to [1][2], and numbers outside 1…count are removed.
 * Anything starting with [[ is a wikilink and passes through unchanged. Text that may be the start of a citation is held until ] arrives.
 */
export function createCitationFilter(count: number): {
  push(delta: string): string
  flush(): string
  cited(): number[]
} {
  const cited = new Set<number>()
  let pending = ''
  const process = (final: boolean): string => {
    let out = ''
    for (;;) {
      const i = pending.search(/[[【]/)
      if (i < 0) {
        out += pending
        pending = ''
        return out
      }
      out += pending.slice(0, i)
      pending = pending.slice(i)
      if (pending.startsWith('[[')) {
        out += '[['
        pending = pending.slice(2)
        continue
      }
      const m = /^[[【]\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*[\]】]/.exec(pending)
      if (m) {
        const nums = m[1].split(/\s*[,，、]\s*/).map(Number)
        for (const n of nums) {
          if (n >= 1 && n <= count) {
            cited.add(n)
            out += `[${n}]`
          }
        }
        pending = pending.slice(m[0].length)
        continue
      }
      // No ] yet: this may be part of a citation, so wait for the next chunk
      if (!final && /^[[【][\d\s,，、]*$/.test(pending)) return out
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
    },
    cited: () => [...cited].sort((a, b) => a - b)
  }
}

/**
 * Streams the answer. Citations go through createCitationFilter and links through createLinkFilter (keeping only links that appear
 * in the sources and the source titles); the return value and onDelta both carry the filtered content.
 */
export async function answer(
  chat: Chat,
  messages: ChatMessage[],
  sources: readonly ContextSource[],
  onDelta: (text: string) => void
): Promise<{ text: string; cited: number[] }> {
  const cites = createCitationFilter(sources.length)
  const links = createLinkFilter([
    ...sources.map((s) => s.title),
    ...sources.flatMap((s) => linkTargets(s.text))
  ])
  let text = ''
  const emit = (t: string): void => {
    if (!t) return
    text += t
    onDelta(t)
  }
  await chat(messages, (d) => emit(links.push(cites.push(d))))
  emit(links.push(cites.flush()) + links.flush())
  return { text, cited: cites.cited() }
}
