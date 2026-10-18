// AI 分頁的對話：問題、附引用的回答、來源清單、時間範圍
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTimeRange } from '../../shared/timeRange'
import type { AskSource, DateRange } from '../../shared/types'
import { Segments } from '../src/components/Segments'
import { wantsNewTab } from '../src/workspace/tabs'
import {
  answerForCopy,
  isRunning,
  splitSources,
  type Answer,
  type Conversation
} from './conversation'
import { Markdown } from './Markdown'

export interface ChatPanelProps {
  conversation: Conversation
  /** Ollama 可用 */
  online: boolean
  /** 每次改變時聚焦輸入框（Ctrl/Cmd+Shift+A） */
  focusKey: number
  /** range：undefined = 由 main 從問題解析，null = 不篩選 */
  onAsk: (question: string, range: DateRange | null | undefined) => void
  onStop: () => void
  onReset: () => void
  onOpenSource: (source: AskSource, newTab: boolean) => void
  onOpenLink: (target: string, newTab: boolean) => void
}

/** 時間範圍：從問題偵測、使用者關掉、手動指定 */
type RangeMode = { kind: 'auto' } | { kind: 'off' } | { kind: 'manual'; from: string; to: string }

const fmtRange = (r: DateRange): string => (r.from === r.to ? r.from : `${r.from} – ${r.to}`)

export function ChatPanel(props: ChatPanelProps): React.JSX.Element {
  const { conversation, online } = props
  const [input, setInput] = useState('')
  const [rangeMode, setRangeMode] = useState<RangeMode>({ kind: 'auto' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const running = isRunning(conversation)
  const detected = useMemo(() => parseTimeRange(input), [input])

  useEffect(() => {
    if (props.focusKey) inputRef.current?.focus()
  }, [props.focusKey])

  // 新的內容出現時捲到底（使用者往上捲去看舊內容時不打擾）
  const last = conversation.entries[conversation.entries.length - 1]
  const lastLength = last ? (last.role === 'user' ? last.text.length : last.text.length + 1) : 0
  const pinned = useRef(true)
  useEffect(() => {
    const el = listRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [conversation.entries.length, lastLength])

  const send = (): void => {
    const q = input.trim()
    if (!q || running || !online) return
    const range =
      rangeMode.kind === 'off'
        ? null
        : rangeMode.kind === 'manual'
          ? {
              from: rangeMode.from || '1900-01-01',
              to: rangeMode.to || '2100-12-31'
            }
          : undefined
    pinned.current = true
    props.onAsk(q, range)
    setInput('')
    setRangeMode({ kind: 'auto' })
  }

  return (
    <div className="chat">
      <div
        className="chat-messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {conversation.entries.length === 0 && (
          <div className="panel-note chat-intro">
            <p>Ask a question about your notes. Answers cite their sources as [1], [2]…</p>
            <p>
              Mention a time to filter by date, for example “上個月”, “最近 7 天”, “last week” or
              “2026-09”.
            </p>
          </div>
        )}
        {conversation.entries.map((e, i) =>
          e.role === 'user' ? (
            <div key={i} className="chat-question">
              {e.text}
            </div>
          ) : (
            <AnswerView
              key={i}
              answer={e}
              onOpenSource={props.onOpenSource}
              onOpenLink={props.onOpenLink}
            />
          )
        )}
      </div>

      <div className="chat-composer">
        <RangeBar mode={rangeMode} detected={detected?.range ?? null} onChange={setRangeMode} />
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          rows={2}
          placeholder={online ? 'Ask your notes… (Enter to send)' : 'Ollama is offline'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // 輸入法選字時的 Enter 不送出
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="chat-actions">
          <button
            onClick={props.onReset}
            disabled={conversation.entries.length === 0}
            title="Start a new conversation"
          >
            New chat
          </button>
          <span className="chat-spacer" />
          {running ? (
            <button onClick={props.onStop}>Stop</button>
          ) : (
            <button
              className="primary"
              onClick={send}
              disabled={!input.trim() || !online}
              title="Send (Enter) · Shift+Enter for a new line"
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RangeBar({
  mode,
  detected,
  onChange
}: {
  mode: RangeMode
  detected: DateRange | null
  onChange: (m: RangeMode) => void
}): React.JSX.Element {
  if (mode.kind === 'manual') {
    return (
      <div className="chat-range date-range" title="Only use notes from this date range">
        <input
          type="date"
          value={mode.from}
          max={mode.to || undefined}
          onChange={(e) => onChange({ ...mode, from: e.target.value })}
        />
        <span>–</span>
        <input
          type="date"
          value={mode.to}
          min={mode.from || undefined}
          onChange={(e) => onChange({ ...mode, to: e.target.value })}
        />
        <button onClick={() => onChange({ kind: 'auto' })} title="Clear the date range">
          ×
        </button>
      </div>
    )
  }
  if (detected && mode.kind === 'auto') {
    return (
      <div className="chat-range">
        <span
          className="range-chip"
          title="Detected in your question; only notes from these dates are used"
        >
          {fmtRange(detected)}
          <button onClick={() => onChange({ kind: 'off' })} title="Don't filter by date">
            ×
          </button>
        </span>
      </div>
    )
  }
  return (
    <div className="chat-range">
      {detected && (
        <button
          className="range-off"
          onClick={() => onChange({ kind: 'auto' })}
          title={`Filter by ${fmtRange(detected)} again`}
        >
          No date filter
        </button>
      )}
      <button
        className="range-add"
        onClick={() =>
          onChange({ kind: 'manual', from: detected?.from ?? '', to: detected?.to ?? '' })
        }
        title="Only use notes from a date range"
      >
        Date range…
      </button>
    </div>
  )
}

function AnswerView({
  answer,
  onOpenSource,
  onOpenLink
}: {
  answer: Answer
  onOpenSource: (source: AskSource, newTab: boolean) => void
  onOpenLink: (target: string, newTab: boolean) => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [showOther, setShowOther] = useState(false)
  const { cited, other } = splitSources(answer)
  const done = answer.status !== 'searching' && answer.status !== 'running'

  const copy = (): void => {
    void navigator.clipboard.writeText(answerForCopy(answer)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="chat-answer">
      {answer.status !== 'searching' && (answer.range || !answer.vector) && (
        <p className="chat-meta">
          {answer.range && <>Notes from {fmtRange(answer.range)}. </>}
          {!answer.vector && <>Semantic search is unavailable; used keyword matches.</>}
        </p>
      )}
      {answer.status === 'searching' && <p className="panel-note">Searching notes…</p>}
      {answer.status === 'running' && !answer.text && <p className="panel-note">Thinking…</p>}
      {answer.text && (
        <Markdown
          className="ai-summary-text"
          text={answer.text}
          onOpenLink={onOpenLink}
          citations={{ sources: answer.sources, onOpen: onOpenSource }}
        />
      )}
      {answer.status === 'stopped' && <p className="panel-note">Stopped.</p>}
      {answer.status === 'error' && <p className="panel-note error">{answer.error}</p>}

      {cited.length > 0 && (
        <ul className="chat-sources">
          {cited.map((s) => (
            <SourceItem key={s.n} source={s} onOpen={onOpenSource} />
          ))}
        </ul>
      )}
      {other.length > 0 && done && (
        <>
          <button className="chat-more" onClick={() => setShowOther((v) => !v)}>
            {showOther ? '▾' : '▸'} {cited.length > 0 ? 'Other' : ''} sources searched (
            {other.length})
          </button>
          {showOther && (
            <ul className="chat-sources">
              {other.map((s) => (
                <SourceItem key={s.n} source={s} onOpen={onOpenSource} />
              ))}
            </ul>
          )}
        </>
      )}
      {done && answer.text && (
        <div className="chat-answer-actions">
          <button onClick={copy} title="Copy; citations become [[links]]">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function SourceItem({
  source,
  onOpen
}: {
  source: AskSource
  onOpen: (source: AskSource, newTab: boolean) => void
}): React.JSX.Element {
  return (
    <li>
      <button
        className="result chat-source"
        onClick={(e) => onOpen(source, wantsNewTab(e))}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && onOpen(source, true)}
        title={`${source.path}:${source.line}`}
      >
        <span className="result-title">
          <span className="cite-num">{source.n}</span>
          <span className="result-name">{source.title}</span>
          <span className="chat-source-date">{source.date}</span>
        </span>
        <span className="result-snippet">
          <Segments segments={source.snippet} />
        </span>
      </button>
    </li>
  )
}
