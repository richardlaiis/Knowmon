// 右側面板的 AI 分頁：Ollama 連線與 embedding 進度、目前筆記的總結
import { useState } from 'react'
import type { LlmStatus, SummaryLanguage } from '../../shared/types'
import { describeStatus } from './status'
import { Markdown } from './Markdown'
import type { SummaryState } from './summary'

export interface AiPanelProps {
  status: LlmStatus | null
  /** 目前開著的筆記；沒有時只顯示狀態 */
  note: string | null
  summary: SummaryState | null
  language: SummaryLanguage
  onLanguageChange: (language: SummaryLanguage) => void
  onSummarize: () => void
  onStop: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onOpenLink: (target: string, newTab: boolean) => void
}

const LANGUAGES: [SummaryLanguage, string][] = [
  ['zh-TW', '中文'],
  ['en', 'EN']
]

const title = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function AiPanel(props: AiPanelProps): React.JSX.Element {
  const { status, note, summary } = props
  const { tone, label } = describeStatus(status)
  const [copied, setCopied] = useState(false)
  const shown = summary && summary.path === note ? summary : null
  const running = shown?.status === 'running'

  const copy = (): void => {
    if (!shown) return
    void navigator.clipboard.writeText(shown.text.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="ai-panel">
      <section className="ai-status">
        <div className="ai-status-line">
          <span className={`status-dot ${tone}`} aria-hidden="true" />
          <span className="ai-status-label">{label}</span>
          <button onClick={props.onRetry} title="Check the Ollama connection again">
            Retry
          </button>
          <button onClick={props.onOpenSettings} title="Ollama address and models">
            Settings
          </button>
        </div>
        {status && (
          <p className="ai-status-detail">
            {status.settings.chatModel} · {status.settings.embedModel} · {status.embedded}/
            {status.total} notes indexed
          </p>
        )}
        {status?.error && <p className="ai-status-detail error">{status.error}</p>}
      </section>

      {!note ? (
        <p className="panel-note">Open a note to summarize it.</p>
      ) : (
        <section className="ai-summary">
          <div className="ai-summary-header">
            <span className="ai-summary-title" title={note}>
              {shown?.selection ? 'Selection in ' : ''}
              {title(note)}
            </span>
            <div className="segmented" role="group" aria-label="Summary language">
              {LANGUAGES.map(([value, label]) => (
                <button
                  key={value}
                  className={props.language === value ? 'on' : ''}
                  aria-pressed={props.language === value}
                  title={
                    value === 'en' ? 'Summarize in English' : 'Summarize in Traditional Chinese'
                  }
                  onClick={() => props.onLanguageChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {running ? (
              <button onClick={props.onStop}>Stop</button>
            ) : (
              <button
                className="primary"
                onClick={props.onSummarize}
                title="Summarize the note, or the selected text (Ctrl+Shift+S)"
              >
                {shown ? 'Regenerate' : 'Summarize'}
              </button>
            )}
            {shown && shown.text && !running && (
              <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            )}
          </div>
          {!shown && (
            <p className="panel-note">
              Summarize this note with {status?.settings.chatModel ?? 'the local model'}. Select
              text first to summarize only the selection. (Ctrl+Shift+S)
            </p>
          )}
          {running && !shown.text && <p className="panel-note">Thinking…</p>}
          {shown && shown.text && (
            <Markdown className="ai-summary-text" text={shown.text} onOpenLink={props.onOpenLink} />
          )}
          {shown?.status === 'stopped' && <p className="panel-note">Stopped.</p>}
          {shown?.status === 'error' && <p className="panel-note error">{shown.error}</p>}
        </section>
      )}
    </div>
  )
}
