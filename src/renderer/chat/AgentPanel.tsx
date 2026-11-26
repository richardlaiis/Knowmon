// The Agent in the AI tab: the task, execution steps (expandable), confirmation cards for write proposals, and the final answer
import { useEffect, useRef, useState } from 'react'
import type { AgentDecision, AgentProposal, AgentStep } from '../../shared/types'
import { wantsNewTab } from '../src/workspace/tabs'
import { isTaskRunning, type AgentItem, type AgentSession, type AgentTask } from './agentRun'
import { Markdown } from './Markdown'

export interface AgentPanelProps {
  session: AgentSession
  /** The chat provider is available (Ollama or cloud) */
  online: boolean
  /** Focuses the input whenever it changes (Ctrl/Cmd+Shift+G) */
  focusKey: number
  onRun: (task: string) => void
  onStop: () => void
  onReset: () => void
  onDecide: (step: AgentStep, decision: AgentDecision) => void
  onOpenNote: (path: string, newTab: boolean) => void
  onOpenLink: (target: string, newTab: boolean) => void
}

const EXAMPLES = [
  'Which notes did I write last week, and what does each of them link to?',
  'Collect my notes about habits into one summary note',
  'Add the tag "review" to my journal entries from this month'
]

export function AgentPanel(props: AgentPanelProps): React.JSX.Element {
  const { session, online } = props
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const running = isTaskRunning(session)

  useEffect(() => {
    if (props.focusKey) inputRef.current?.focus()
  }, [props.focusKey])

  // Scroll to the bottom when new content appears (without interrupting a user who scrolled up to read)
  const last = session.tasks[session.tasks.length - 1]
  const size = last
    ? last.items.reduce((n, i) => n + (i.kind === 'text' ? i.text.length : 1), 0)
    : 0
  const pinned = useRef(true)
  useEffect(() => {
    const el = listRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [session.tasks.length, size, last?.status])

  const send = (): void => {
    const task = input.trim()
    if (!task || running || !online) return
    pinned.current = true
    props.onRun(task)
    setInput('')
  }

  return (
    <div className="chat agent">
      <div
        className="chat-messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {session.tasks.length === 0 && (
          <div className="panel-note chat-intro">
            <p>
              Give the agent a task. It searches and reads your notes step by step; creating notes
              or adding tags always waits for your confirmation.
            </p>
            <ul className="agent-examples">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button onClick={() => setInput(ex)}>{ex}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {session.tasks.map((t, i) => (
          <TaskView key={i} task={t} {...props} />
        ))}
      </div>

      <div className="chat-composer">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          rows={2}
          placeholder={
            online
              ? 'Give the agent a task… (Enter to run)'
              : 'AI is offline (see the status above)'
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter during IME composition doesn't send
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="chat-actions">
          <button
            onClick={props.onReset}
            disabled={session.tasks.length === 0}
            title="Start over without the earlier tasks"
          >
            New task
          </button>
          <span className="chat-spacer" />
          {running ? (
            <button onClick={props.onStop} title="Stop; a pending change is not written">
              Stop
            </button>
          ) : (
            <button
              className="primary"
              onClick={send}
              disabled={!input.trim() || !online}
              title="Run (Enter) · Shift+Enter for a new line"
            >
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskView(props: { task: AgentTask } & AgentPanelProps): React.JSX.Element {
  const { task } = props
  const lastStep = task.items.findLastIndex((x) => x.kind === 'step')
  const thinking =
    task.status === 'running' &&
    (task.items.length === 0 || task.items[task.items.length - 1].kind === 'step') &&
    !task.items.some((x) => x.kind === 'step' && ['running', 'confirm'].includes(x.step.status))
  return (
    <>
      <div className="chat-question">{task.task}</div>
      <div className="chat-answer agent-task">
        {task.items.map((item, i) => (
          <ItemView key={i} item={item} final={i > lastStep} {...props} />
        ))}
        {thinking && <p className="panel-note">Thinking…</p>}
        {task.status === 'stopped' && <p className="panel-note">Stopped.</p>}
        {task.status === 'error' && <p className="panel-note error">{task.error}</p>}
      </div>
    </>
  )
}

function ItemView(
  props: { item: AgentItem; final: boolean; task: AgentTask } & AgentPanelProps
): React.JSX.Element | null {
  const { item } = props
  if (item.kind === 'text') {
    if (!item.text.trim()) return null
    return (
      <Markdown
        className={props.final ? 'ai-summary-text' : 'ai-summary-text agent-aside'}
        text={item.text}
        onOpenLink={props.onOpenLink}
      />
    )
  }
  return (
    <StepView
      step={item.step}
      active={props.task.status === 'running'}
      onDecide={props.onDecide}
      onOpenNote={props.onOpenNote}
    />
  )
}

const STATUS_ICON: Record<AgentStep['status'], string> = {
  running: '',
  done: '✓',
  error: '!',
  confirm: '?',
  applied: '✓',
  rejected: '✕'
}

function StepView({
  step,
  active,
  onDecide,
  onOpenNote
}: {
  step: AgentStep
  /** The task is still running (confirmation cards can't be used after stopping) */
  active: boolean
  onDecide: (step: AgentStep, decision: AgentDecision) => void
  onOpenNote: (path: string, newTab: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const waiting = step.status === 'confirm' && active
  const canOpen = step.notes.length > 0 || Object.keys(step.args).length > 0 || !!step.error
  return (
    <div className={`agent-step ${step.status}${waiting ? ' waiting' : ''}`}>
      <button
        className="agent-step-head"
        onClick={() => setOpen((v) => !v)}
        disabled={!canOpen}
        aria-expanded={open}
        title={step.tool}
      >
        <span className="agent-step-icon" aria-hidden="true">
          {step.status === 'running' ? <span className="spinner" /> : STATUS_ICON[step.status]}
        </span>
        <span className="agent-step-label">{step.label}</span>
        {canOpen && <span className="agent-step-toggle">{open ? '▾' : '▸'}</span>}
      </button>
      {step.error && <p className="agent-step-error">{step.error}</p>}
      {open && (
        <div className="agent-step-detail">
          <pre className="agent-args">{JSON.stringify(step.args, null, 2)}</pre>
          {step.notes.length > 0 && <NoteList notes={step.notes} onOpen={onOpenNote} />}
        </div>
      )}
      {step.proposal && (step.status === 'confirm' || step.status === 'error') && (
        <ProposalCard
          proposal={step.proposal}
          editable={waiting}
          onDecide={(d) => onDecide(step, d)}
        />
      )}
      {step.status === 'applied' && !open && step.notes.length > 0 && (
        <NoteList notes={step.notes} onOpen={onOpenNote} />
      )}
    </div>
  )
}

function NoteList({
  notes,
  onOpen
}: {
  notes: AgentStep['notes']
  onOpen: (path: string, newTab: boolean) => void
}): React.JSX.Element {
  return (
    <ul className="agent-notes">
      {notes.map((n) => (
        <li key={n.path}>
          <button
            onClick={(e) => onOpen(n.path, wantsNewTab(e))}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && onOpen(n.path, true)}
            title={n.path}
          >
            {n.title}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A write proposal: edit it and Apply, or Reject */
function ProposalCard({
  proposal,
  editable,
  onDecide
}: {
  proposal: AgentProposal
  editable: boolean
  onDecide: (d: AgentDecision) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(proposal)
  const [sent, setSent] = useState(false)
  const disabled = !editable || sent
  const decide = (approved: boolean): void => {
    setSent(true)
    onDecide(approved ? { approved, edited: draft } : { approved })
  }

  return (
    <div className="agent-proposal">
      {draft.kind === 'create_note' ? (
        <>
          <label className="agent-field">
            <span>New note</span>
            <input
              value={draft.path}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </label>
          <textarea
            className="agent-content"
            value={draft.content}
            disabled={disabled}
            rows={Math.min(16, Math.max(5, draft.content.split('\n').length + 1))}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          {proposal.kind === 'create_note' && proposal.missingLinks.length > 0 && (
            <p className="agent-warning">
              Links to notes that don&apos;t exist yet:{' '}
              {proposal.missingLinks.map((l) => `[[${l}]]`).join(', ')}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="agent-field">
            <span>Add tags to</span> <strong>{draft.title}</strong>
          </p>
          <div className="agent-tags">
            {draft.tags.map((t) => (
              <span key={t} className="range-chip">
                #{t}
                {!disabled && (
                  <button
                    onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}
                    title="Don't add this tag"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {draft.tags.length === 0 && <span className="panel-note">No tags left to add.</span>}
          </div>
          {proposal.kind === 'add_tags' && (
            <div className="agent-diff">
              <pre className="before">{proposal.before.trimEnd() || '(no frontmatter)'}</pre>
              <pre className="after">{proposal.after.trimEnd()}</pre>
            </div>
          )}
        </>
      )}
      {editable && (
        <div className="agent-proposal-actions">
          <button onClick={() => decide(false)} disabled={sent}>
            Reject
          </button>
          <button
            className="primary"
            onClick={() => decide(true)}
            disabled={
              sent || (draft.kind === 'create_note' ? !draft.path.trim() : draft.tags.length === 0)
            }
            title="Write this change to the vault"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
