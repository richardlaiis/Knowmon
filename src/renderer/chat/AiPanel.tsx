// The AI tab in the right panel: the chat provider's (Ollama or cloud) connection and embedding progress, with a switch below between chat (Q&A), the agent and a summary of the current note
import { useState } from 'react'
import { PROVIDER_LABELS, activeChatModel } from '../../shared/llm'
import type { LlmStatus, SummaryLanguage } from '../../shared/types'
import { SettingsIcon } from '../src/components/icons'
import { AgentPanel, type AgentPanelProps } from './AgentPanel'
import { ChatPanel, type ChatPanelProps } from './ChatPanel'
import type { AiMode } from './conversation'
import { describeStatus } from './status'
import { Markdown } from './Markdown'
import type { SummaryState } from './summary'

export interface AiPanelProps {
  status: LlmStatus | null
  mode: AiMode
  onModeChange: (mode: AiMode) => void
  chat: Omit<ChatPanelProps, 'online'>
  agent: Omit<AgentPanelProps, 'online'>
  /** The agent has a write proposal waiting for confirmation (shows a dot on the mode button) */
  agentWaiting: boolean
  /** The currently open note; only the status is shown when there is none */
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

const MODES: [AiMode, string, string][] = [
  ['chat', 'Chat', 'Ask questions about your notes (Ctrl+Shift+A)'],
  ['agent', 'Agent', 'Multi-step tasks: search, organize, create notes, add tags (Ctrl+Shift+G)'],
  ['summary', 'Summary', 'Summarize the current note (Ctrl+Shift+S)']
]

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
          <button onClick={props.onRetry} title="Check the AI connection again">
            Retry
          </button>
          <button
            className="with-icon"
            onClick={props.onOpenSettings}
            title="Chat provider, Ollama address and models"
          >
            <SettingsIcon size={15} />
            Settings
          </button>
        </div>
        {status && (
          <p className="ai-status-detail">
            {status.settings.provider !== 'ollama' &&
              `${PROVIDER_LABELS[status.settings.provider]} `}
            {activeChatModel(status.settings) || '(no model)'} · {status.settings.embedModel} ·{' '}
            {status.embedded}/{status.total} notes indexed
          </p>
        )}
        {status?.error && <p className="ai-status-detail error">{status.error}</p>}
        {status?.embedError && <p className="ai-status-detail">{status.embedError}</p>}
        <div className="segmented ai-mode" role="group" aria-label="AI mode">
          {MODES.map(([value, label, hint]) => (
            <button
              key={value}
              className={props.mode === value ? 'on' : ''}
              aria-pressed={props.mode === value}
              title={hint}
              onClick={() => props.onModeChange(value)}
            >
              {label}
              {value === 'agent' && props.agentWaiting && (
                <span className="attention-dot" aria-label="waiting for confirmation" />
              )}
            </button>
          ))}
        </div>
      </section>

      {props.mode === 'chat' ? (
        <ChatPanel {...props.chat} online={!!status?.online} />
      ) : props.mode === 'agent' ? (
        <AgentPanel {...props.agent} online={!!status?.online} />
      ) : !note ? (
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
