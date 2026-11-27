import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SEMANTIC_SETTINGS } from '../../shared/llm'
import { resolveLink } from '../../shared/links'
import { DEFAULT_TIME_SETTINGS } from '../../shared/time'
import type {
  AgentDecision,
  AgentStep,
  AskSource,
  CloudProvider,
  DateRange,
  LlmSettings,
  NoteSummary,
  SemanticSettings,
  TimeSettings,
  TreeNode,
  VaultChange
} from '../../shared/types'
import {
  AiPanel,
  LlmSettingsDialog,
  type ApiKeyChanges,
  applyAnswerChunk,
  applyChunk,
  askQuestion,
  emptyConversation,
  failAnswer,
  chatHistory,
  lastAnswer,
  loadAiMode,
  saveAiMode,
  stopAnswer,
  withAnswerId,
  type AiMode,
  type Conversation,
  agentHistory,
  applyAgentChunk,
  emptySession,
  failTask,
  isTaskRunning,
  lastTask,
  pendingConfirm,
  startTask,
  stopTask,
  withTaskId,
  type AgentSession,
  describeStatus,
  failSummary,
  loadSummaryLanguage,
  saveSummaryLanguage,
  startSummary,
  stopSummary,
  useLlmStatus,
  withId,
  type SummaryState
} from '../chat'
import { createAutosave } from '../editor'
import { GlobalGraph, LocalGraph, type Point } from '../graph'
import { TimelineView } from '../timeline'
import { BacklinksPanel } from './components/BacklinksPanel'
import { FileTree } from './components/FileTree'
import { QuickSwitcher } from './components/QuickSwitcher'
import { SearchPanel } from './components/SearchPanel'
import { SettingsMenu } from './components/SettingsMenu'
import { Splitter } from './components/Splitter'
import { TimeSettingsDialog } from './components/TimeSettingsDialog'
import {
  BacklinksIcon,
  FilesIcon,
  FolderOpenIcon,
  GoToIcon,
  GraphIcon,
  LocalGraphIcon,
  Logo,
  MoonIcon,
  NewFolderIcon,
  NewNoteIcon,
  SearchIcon,
  SparkleIcon,
  SunIcon,
  TimelineIcon
} from './components/icons'
import { EMPTY_STATE_HINTS, isMacPlatform, splitKeys } from './lib/shortcutHints'
import {
  errorMessage,
  isWithin,
  movedInto,
  newItemPath,
  renamedPath,
  type NewItem
} from './lib/tree'
import { applyTheme, browserStore, otherTheme, saveTheme, type Theme } from './lib/theme'
import {
  DEFAULT_LAYOUT,
  PANE_LIMITS,
  clampWidth,
  loadLayout,
  saveLayout,
  type LayoutPrefs
} from './workspace/layout'
import { NotePane } from './workspace/NotePane'
import { TabBar } from './workspace/TabBar'
import * as T from './workspace/tabs'

const PREVIEW_KEY = 'knowmon.livePreview'
const SIDE_TAB_KEY = 'knowmon.sidePanel'
const TABS_KEY = 'knowmon.tabs:'
const RECENT_MAX = 20
/** Shortcut hints show ⌘ on macOS */
const MAC = isMacPlatform(navigator.userAgent)

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'false'
  } catch {
    return true
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, String(on))
  } catch {
    // Switching still works when the preference can't be saved
  }
}

type SideTab = 'backlinks' | 'local' | 'ai'

function loadSideTab(): SideTab {
  try {
    const v = localStorage.getItem(SIDE_TAB_KEY)
    return v === 'local' || v === 'ai' ? v : 'backlinks'
  } catch {
    return 'backlinks'
  }
}

/** Each vault remembers its own open tabs */
function loadSavedTabs(vault: string): unknown {
  try {
    const raw = localStorage.getItem(TABS_KEY + vault)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveTabs(vault: string, tabs: T.TabsState): void {
  try {
    localStorage.setItem(TABS_KEY + vault, JSON.stringify(T.serializeTabs(tabs)))
  } catch {
    // If it can't be saved, start blank next time
  }
}

const fetchNotes = (): Promise<NoteSummary[]> => window.api.notes.list()

function withSaved(layout: LayoutPrefs): LayoutPrefs {
  saveLayout(layout)
  return layout
}

function App(): React.JSX.Element {
  const [vault, setVault] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [tabs, setTabs] = useState<T.TabsState>(T.emptyTabs)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState<NewItem | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(() => loadFlag(PREVIEW_KEY))
  const [layout, setLayout] = useState<LayoutPrefs>(loadLayout)
  const [sidebarTab, setSidebarTab] = useState<'files' | 'search'>('files')
  const [searchFocus, setSearchFocus] = useState(0)
  /** Incremented when the index may have changed (external changes, in-app operations, saves), so search, backlinks and the graph query again */
  const [indexVersion, setIndexVersion] = useState(0)
  const [switcher, setSwitcher] = useState<{
    notes: NoteSummary[]
    recent: string[]
    newTab: boolean
  } | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>(() => loadSideTab())
  // Graph node position cache, reset when switching vaults
  const graphPositions = useMemo(
    () => ({ global: new Map<string, Point>(), local: new Map<string, Point>(), vault }),
    [vault]
  )
  /** This vault's time parameters (for splitting timeline sessions; time edges are computed by main) */
  const [timeSettings, setTimeSettings] = useState<TimeSettings>(DEFAULT_TIME_SETTINGS)
  const [semanticSettings, setSemanticSettings] =
    useState<SemanticSettings>(DEFAULT_SEMANTIC_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const llmStatus = useLlmStatus(vault)
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [summaryLanguage, setSummaryLanguage] = useState(loadSummaryLanguage)
  const [aiMode, setAiMode] = useState<AiMode>(loadAiMode)
  /** The Q&A conversation, kept only in memory; cleared when switching vaults */
  const [conversation, setConversation] = useState<Conversation>(emptyConversation)
  /** Incremented to focus the chat input */
  const [chatFocus, setChatFocus] = useState(0)
  /** The agent task, kept only in memory; cleared when switching vaults */
  const [agentSession, setAgentSession] = useState<AgentSession>(emptySession)
  const [agentFocus, setAgentFocus] = useState(0)
  const agentWaiting = pendingConfirm(agentSession) !== null
  /** The text currently selected in each note's editor (for summarizing the selection) */
  const selections = useRef(new Map<string, string>())
  /** The line a search result should scroll to; n increments every time, so the same line jumps again */
  const [jump, setJump] = useState<{ path: string; line: number; n: number } | null>(null)
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )

  // Event handlers (the watcher) read the latest tab state
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  })

  const current = T.activeTab(tabs)
  const currentNote = current?.kind === 'note' ? current.path : null

  // Recently opened notes (for Quick switcher ordering), most recent first
  const recent = useRef<string[]>([])
  /** The last note viewed: still highlighted when switching to the timeline (adjusted during render, not in an effect) */
  const [lastNote, setLastNote] = useState<string | null>(null)
  if (currentNote && currentNote !== lastNote) setLastNote(currentNote)
  useEffect(() => {
    if (currentNote) {
      recent.current = [currentNote, ...recent.current.filter((p) => p !== currentNote)].slice(
        0,
        RECENT_MAX
      )
    }
  }, [currentNote])

  // ---- Saving and restoring tabs ----
  /** Vaults whose tabs have been restored; nothing is saved until restoring finishes, so an empty state can't overwrite the previous tabs */
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!vault) return
    let stale = false
    fetchNotes()
      .then((notes) => {
        if (stale) return
        const exists = new Set(notes.map((n) => n.path))
        restoredFor.current = vault
        setTabs(T.restoreTabs(loadSavedTabs(vault), (p) => exists.has(p)))
      })
      .catch((e) => setMessage(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [vault])
  useEffect(() => {
    if (vault && restoredFor.current === vault) saveTabs(vault, tabs)
  }, [vault, tabs])

  useEffect(() => {
    if (!vault) return
    let stale = false
    Promise.all([window.api.settings.getTime(), window.api.settings.getSemantic()])
      .then(([t, s]) => {
        if (stale) return
        setTimeSettings(t)
        setSemanticSettings(s)
      })
      .catch((e) => setMessage(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [vault])

  // When background embedding settles, semantic edges and hybrid retrieval results may change
  const embedBusy = llmStatus?.busy ?? false
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !embedBusy) setIndexVersion((v) => v + 1)
    wasBusy.current = embedBusy
  }, [embedBusy])

  // Streamed chunks of summaries and answers
  useEffect(() => window.api.llm.onSummary((c) => setSummary((s) => s && applyChunk(s, c))), [])
  useEffect(
    () => window.api.llm.onAnswer((c) => setConversation((s) => applyAnswerChunk(s, c))),
    []
  )
  useEffect(() => window.api.llm.onAgent((c) => setAgentSession((s) => applyAgentChunk(s, c))), [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = otherTheme(t)
      applyTheme(document.documentElement, next)
      saveTheme(browserStore(), next)
      return next
    })
  }, [])

  const togglePreview = useCallback(() => {
    setPreview((on) => {
      saveFlag(PREVIEW_KEY, !on)
      return !on
    })
  }, [])

  const updateLayout = useCallback((change: Partial<LayoutPrefs>) => {
    setLayout((l) => withSaved({ ...l, ...change }))
  }, [])

  const openSwitcher = useCallback((newTab = false) => {
    fetchNotes()
      .then((notes) => setSwitcher({ notes, recent: recent.current, newTab }))
      .catch((e) => setMessage(errorMessage(e)))
  }, [])

  const chooseSideTab = useCallback((tab: SideTab): void => {
    setSideTab(tab)
    try {
      localStorage.setItem(SIDE_TAB_KEY, tab)
    } catch {
      // Switching still works when the preference can't be saved
    }
  }, [])

  const chooseAiMode = useCallback((mode: AiMode): void => {
    setAiMode(mode)
    saveAiMode(mode)
  }, [])

  const openSearch = useCallback(() => {
    updateLayout({ leftOpen: true })
    setSidebarTab('search')
    setSearchFocus((n) => n + 1)
  }, [updateLayout])

  // While the app's own create/rename/delete is in progress, ignore watcher notifications about open notes
  const localOps = useRef(0)
  const isLocalOp = useCallback(() => localOps.current > 0, [])

  const showError = useCallback((e: unknown) => setMessage(errorMessage(e)), [])
  const autosave = useMemo(
    () =>
      createAutosave(
        async (p, c) => {
          await window.api.notes.write(p, c)
          setIndexVersion((v) => v + 1)
        },
        500,
        showError
      ),
    [showError]
  )

  const refreshTree = useCallback(async () => {
    try {
      setTree(await window.api.vault.tree())
      setIndexVersion((v) => v + 1)
    } catch (e) {
      showError(e)
    }
  }, [showError])

  // Startup: restore the last vault
  useEffect(() => {
    window.api.vault
      .getCurrent()
      .then(async (root) => {
        setVault(root)
        if (root) setTree(await window.api.vault.tree())
      })
      .catch(showError)
      .finally(() => setReady(true))
  }, [showError])

  // External changes: update the file tree; close the tab of a note deleted or moved externally (content changes are handled by each tab)
  useEffect(() => {
    if (!vault) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.vault.onChange((c: VaultChange) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refreshTree(), 100)
      if (c.type !== 'unlink' || localOps.current > 0) return
      const gone = tabsRef.current.tabs.flatMap((t) =>
        t.kind === 'note' && isWithin(t.path, c.path) ? [t.path] : []
      )
      if (gone.length === 0) return
      if (gone.some((p) => autosave.isDirty(p))) autosave.cancel()
      setMessage(
        gone.length === 1
          ? `"${gone[0]}" was deleted or moved outside the app`
          : `${gone.length} open notes were deleted or moved outside the app`
      )
      setTabs((s) => T.removePaths(s, c.path))
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [vault, refreshTree, autosave])

  // Write out unsaved content before the window closes
  useEffect(() => {
    const onUnload = (): void => void autosave.flush()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [autosave])

  const runLocal = async (fn: () => Promise<void>): Promise<void> => {
    localOps.current++
    try {
      await autosave.flush()
      await fn()
    } catch (e) {
      showError(e)
    } finally {
      // Let the watcher's echo of this operation pass first
      setTimeout(() => localOps.current--, 500)
      await refreshTree()
    }
  }

  const pickVault = async (): Promise<void> => {
    try {
      await autosave.flush()
      const root = await window.api.vault.pick()
      if (!root) return
      restoredFor.current = null
      setTabs(T.emptyTabs)
      setCreating(null)
      resetConversation()
      resetAgent()
      setVault(root)
      await refreshTree()
    } catch (e) {
      showError(e)
    }
  }

  /** Opens a note: replaces the current tab, or opens a new tab with newTab; switches to it if already open */
  const openNote = useCallback(
    async (path: string, newTab = false): Promise<void> => {
      // Replacing the tab removes the old editor, so write out unsaved content first
      await autosave.flush()
      setTabs((s) => T.openNote(s, path, newTab))
    },
    [autosave]
  )

  /** Search result: opens the note and scrolls to the matching passage */
  const openAt = async (path: string, newTab: boolean, line?: number): Promise<void> => {
    await openNote(path, newTab)
    if (line) setJump((j) => ({ path, line, n: (j?.n ?? 0) + 1 }))
  }

  /** Summarizes the current note; with text selected in the editor, only the selection */
  const summarize = useCallback(async (): Promise<void> => {
    const path = currentNote
    if (!path) return
    const selection = (selections.current.get(path) ?? '').trim()
    setLayout((l) => (l.rightOpen ? l : withSaved({ ...l, rightOpen: true })))
    chooseSideTab('ai')
    chooseAiMode('summary')
    setSummary((s) => {
      if (s?.id && s.status === 'running') void window.api.llm.cancel(s.id)
      return startSummary(path, selection.length > 0)
    })
    try {
      // Main reads the body from the index, so write out unsaved content first
      await autosave.flush()
      const id = await window.api.llm.summarize({
        path,
        ...(selection ? { selection } : {}),
        language: summaryLanguage
      })
      setSummary((s) => (s && s.id === null && s.path === path ? withId(s, id) : s))
    } catch (e) {
      setSummary((s) => s && failSummary(s, errorMessage(e)))
    }
  }, [currentNote, autosave, chooseSideTab, chooseAiMode, summaryLanguage])

  /** Opens Chat in the right AI tab and focuses the input */
  const openChat = useCallback((): void => {
    setLayout((l) => (l.rightOpen ? l : withSaved({ ...l, rightOpen: true })))
    chooseSideTab('ai')
    chooseAiMode('chat')
    setChatFocus((n) => n + 1)
  }, [chooseSideTab, chooseAiMode])

  /** Opens the agent in the right AI tab and focuses the input */
  const openAgent = useCallback((): void => {
    setLayout((l) => (l.rightOpen ? l : withSaved({ ...l, rightOpen: true })))
    chooseSideTab('ai')
    chooseAiMode('agent')
    setAgentFocus((n) => n + 1)
  }, [chooseSideTab, chooseAiMode])

  const runAgent = async (task: string): Promise<void> => {
    const turns = agentHistory(agentSession)
    setAgentSession((s) => startTask(s, task))
    try {
      // Tools read from the index, so write out unsaved content first
      await autosave.flush()
      const id = await window.api.llm.agent({ task, history: turns })
      setAgentSession((s) => withTaskId(s, id))
    } catch (e) {
      setAgentSession((s) => failTask(s, errorMessage(e)))
    }
  }

  const stopAgent = (): void => {
    const t = lastTask(agentSession)
    if (t?.id) void window.api.llm.cancel(t.id)
    setAgentSession(stopTask)
  }

  function resetAgent(): void {
    setAgentSession((s) => {
      const t = lastTask(s)
      if (t?.id && isTaskRunning(s)) void window.api.llm.cancel(t.id)
      return emptySession()
    })
  }

  const decideAgentStep = async (step: AgentStep, decision: AgentDecision): Promise<void> => {
    const t = lastTask(agentSession)
    if (!t?.id) return
    try {
      // add_tags rereads the file in main, so write out unsaved content first
      if (decision.approved) await autosave.flush()
      await window.api.llm.confirm(t.id, step.index, decision)
    } catch (e) {
      showError(e)
    }
  }

  const askNotes = async (question: string, range: DateRange | null | undefined): Promise<void> => {
    const turns = chatHistory(conversation)
    setConversation((c) => askQuestion(c, question))
    try {
      // Main retrieves from the index, so write out unsaved content first
      await autosave.flush()
      const id = await window.api.llm.ask({ question, history: turns, range })
      setConversation((c) => withAnswerId(c, id))
    } catch (e) {
      setConversation((c) => failAnswer(c, errorMessage(e)))
    }
  }

  const stopAsking = (): void => {
    const a = lastAnswer(conversation)
    if (a?.id) void window.api.llm.cancel(a.id)
    setConversation(stopAnswer)
  }

  function resetConversation(): void {
    setConversation((c) => {
      const a = lastAnswer(c)
      if (a?.id && (a.status === 'searching' || a.status === 'running')) {
        void window.api.llm.cancel(a.id)
      }
      return emptyConversation()
    })
  }

  const openSource = (source: AskSource, newTab: boolean): void =>
    void openAt(source.path, newTab, source.line)

  const stopSummarizing = (): void => {
    if (summary?.id) void window.api.llm.cancel(summary.id)
    setSummary((s) => s && stopSummary(s))
  }

  const saveLlmSettings = async (
    next: LlmSettings,
    keys: ApiKeyChanges,
    keepOpen: boolean
  ): Promise<void> => {
    try {
      // Save keys first, so the connection check triggered by the settings change can use them
      for (const [provider, key] of Object.entries(keys) as [CloudProvider, string | null][]) {
        await window.api.llm.setApiKey(provider, key)
      }
      await window.api.llm.setSettings(next)
      if (!keepOpen) setLlmSettingsOpen(false)
    } catch (e) {
      showError(e)
    }
  }

  const openGraph = useCallback(() => setTabs((s) => T.openView(s, 'graph')), [])
  const openTimeline = useCallback(() => setTabs((s) => T.openView(s, 'timeline')), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const saveTimeSettings = async (
    next: TimeSettings,
    semantic: SemanticSettings
  ): Promise<void> => {
    try {
      setTimeSettings(await window.api.settings.setTime(next))
      setSemanticSettings(await window.api.settings.setSemantic(semantic))
      setSettingsOpen(false)
      // Time edges and semantic edges are recomputed, so have the graph fetch its data again
      setIndexVersion((v) => v + 1)
    } catch (e) {
      showError(e)
    }
  }

  const closeTab = useCallback(
    async (id: string): Promise<void> => {
      await autosave.flush()
      setTabs((s) => T.closeTab(s, id))
    },
    [autosave]
  )

  /** [[target]]: opens the note, creating it at the vault root if it doesn't exist */
  const openLink = async (target: string, newTab: boolean): Promise<void> => {
    try {
      const notes = await fetchNotes()
      const path = resolveLink(
        target,
        notes.map((n) => n.path)
      )
      if (path) return await openNote(path, newTab)
      await runLocal(async () => {
        const created = `${target}.md`
        await window.api.notes.create(created)
        setTabs((s) => T.openNote(s, created, newTab))
      })
    } catch (e) {
      showError(e)
    }
  }

  /** Shows a name field in the file tree; the item is created only after a name is entered (see createItem) */
  const startCreate = (item: NewItem | null): void => {
    setRenaming(null)
    setSidebarTab('files')
    setCreating(item)
  }

  const createItem = (item: NewItem, name: string): Promise<void> =>
    runLocal(async () => {
      setCreating(null)
      if (!tree) return
      const path = newItemPath(tree, item, name)
      if (item.kind === 'folder') return await window.api.notes.createFolder(path)
      await window.api.notes.create(path)
      // New notes open in a new tab without replacing the note being viewed
      setTabs((s) => T.openNote(s, path, true))
    })

  const renameNode = (node: TreeNode, newName: string): Promise<void> =>
    runLocal(async () => {
      setRenaming(null)
      const to = renamedPath(node, newName)
      if (to === node.path) return
      await window.api.notes.rename(node.path, to)
      setTabs((s) => T.renamePaths(s, node.path, to))
    })

  const moveNode = (from: string, folder: string): Promise<void> =>
    runLocal(async () => {
      const to = movedInto(from, folder)
      if (!to) return
      await window.api.notes.rename(from, to)
      setTabs((s) => T.renamePaths(s, from, to))
    })

  const removeNode = (node: TreeNode): Promise<void> => {
    const what =
      node.kind === 'folder' ? `the folder "${node.name}" and all notes in it` : `"${node.name}"`
    if (!window.confirm(`Move ${what} to the trash?`)) return Promise.resolve()
    return runLocal(async () => {
      await window.api.notes.remove(node.path)
      setTabs((s) => T.removePaths(s, node.path))
    })
  }

  // Panel widths: kept within limits while dragging, without squeezing the editor too narrow
  const resizeLeft = (w: number): void =>
    updateLayout({
      left: clampWidth(w, PANE_LIMITS.left, window.innerWidth, layout.rightOpen ? layout.right : 0)
    })
  const resizeRight = (w: number): void =>
    updateLayout({
      right: clampWidth(w, PANE_LIMITS.right, window.innerWidth, layout.leftOpen ? layout.left : 0)
    })
  const toggleLeft = useCallback(
    () => setLayout((l) => withSaved({ ...l, leftOpen: !l.leftOpen })),
    []
  )
  const toggleRight = useCallback(
    () => setLayout((l) => withSaved({ ...l, rightOpen: !l.rightOpen })),
    []
  )

  // Global shortcuts (full list in docs/user-guide/shortcuts.md)
  const activeId = tabs.activeId
  useEffect(() => {
    if (!vault) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (e.key === 'Tab' && e.ctrlKey) setTabs((s) => T.cycle(s, e.shiftKey ? -1 : 1))
      else if (e.altKey && key === 'b') toggleRight()
      else if (e.altKey) return
      else if (e.shiftKey && key === 'f') openSearch()
      else if (e.shiftKey && key === 't') openTimeline()
      else if (e.shiftKey && key === 's') void summarize()
      else if (e.shiftKey && key === 'a') openChat()
      else if (e.shiftKey && key === 'g') openAgent()
      else if (e.shiftKey) return
      else if (key === 'e') togglePreview()
      else if (key === 'o') openSwitcher(false)
      else if (key === 't') openSwitcher(true)
      else if (key === 'g') openGraph()
      else if (key === 'b') toggleLeft()
      else if (key === 'w') {
        if (activeId) void closeTab(activeId)
      } else return
      e.preventDefault()
      // Don't let the editor handle the same key again (for example CodeMirror's Ctrl/Cmd+G is "find next")
      e.stopPropagation()
    }
    // capture: intercept global shortcuts before the editor
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    vault,
    activeId,
    togglePreview,
    openSwitcher,
    openSearch,
    openGraph,
    openTimeline,
    closeTab,
    toggleLeft,
    toggleRight,
    summarize,
    openChat,
    openAgent
  ])

  if (!ready) return <div className="empty" />

  if (!vault) {
    return (
      <div className="empty welcome">
        <div className="corner">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <Logo size={96} className="welcome-logo" />
        <h1>Knowmon</h1>
        <p className="tagline">Markdown notes linked by links — and by when you wrote them.</p>
        <p>Choose a folder as your vault. Notes are stored in it as Markdown files.</p>
        <button className="primary with-icon" onClick={pickVault}>
          <FolderOpenIcon />
          Open folder
        </button>
        {message && <p className="error">{message}</p>}
      </div>
    )
  }

  const graphTab = tabs.tabs.find((t) => t.kind === 'graph')
  const timelineTab = tabs.tabs.find((t) => t.kind === 'timeline')

  return (
    <div className="layout">
      {layout.leftOpen && (
        <>
          <aside className="sidebar" style={{ width: layout.left }}>
            <header className="sidebar-header">
              <button
                className="vault-name"
                onClick={pickVault}
                title={`${vault}\nClick to switch vault`}
              >
                <Logo size={20} />
                <span className="vault-label">{tree?.name ?? vault}</span>
              </button>
              <button
                className="icon"
                onClick={() => startCreate({ folder: '', kind: 'file' })}
                title="New note"
              >
                <NewNoteIcon />
              </button>
              <button
                className="icon"
                onClick={() => startCreate({ folder: '', kind: 'folder' })}
                title="New folder"
              >
                <NewFolderIcon />
              </button>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </header>
            <nav className="sidebar-tabs">
              <button
                className={sidebarTab === 'files' ? 'active' : ''}
                onClick={() => setSidebarTab('files')}
                title="Files"
                aria-label="Files"
              >
                <FilesIcon size={16} />
                <span className="label">Files</span>
              </button>
              <button
                className={sidebarTab === 'search' ? 'active' : ''}
                onClick={openSearch}
                title="Search (Ctrl+Shift+F)"
                aria-label="Search"
              >
                <SearchIcon size={16} />
                <span className="label">Search</span>
              </button>
              {/* Actions that open tabs show only icons (the tooltip has the name and shortcut) */}
              <div className="sidebar-actions">
                <button onClick={openGraph} title="Graph view (Ctrl+G)" aria-label="Graph view">
                  <GraphIcon size={17} />
                </button>
                <button
                  onClick={openTimeline}
                  title="Timeline (Ctrl+Shift+T)"
                  aria-label="Timeline"
                >
                  <TimelineIcon size={17} />
                </button>
                <button
                  onClick={() => openSwitcher(false)}
                  title="Quick switcher (Ctrl+O)"
                  aria-label="Quick switcher"
                >
                  <GoToIcon size={17} />
                </button>
              </div>
            </nav>
            {sidebarTab === 'search' && (
              <SearchPanel
                focusKey={searchFocus}
                version={indexVersion}
                selected={currentNote}
                onOpen={(p, newTab, line) => void openAt(p, newTab, line)}
              />
            )}
            {sidebarTab === 'files' && tree && (
              <FileTree
                root={tree}
                selected={currentNote}
                renaming={renaming}
                creating={creating}
                onOpen={(p, newTab) => void openNote(p, newTab)}
                onStartCreate={startCreate}
                onCreate={createItem}
                onStartRename={(p) => {
                  setCreating(null)
                  setRenaming(p)
                }}
                onRename={renameNode}
                onMove={moveNode}
                onRemove={removeNode}
              />
            )}
            <footer className="sidebar-footer">
              <SettingsMenu
                onTimeSettings={openSettings}
                onAiSettings={() => setLlmSettingsOpen(true)}
                aiDisabled={!llmStatus}
              />
              <LlmBadge
                status={
                  agentWaiting
                    ? { tone: 'warn', label: 'Agent: confirm a change' }
                    : describeStatus(llmStatus)
                }
                detail={
                  agentWaiting
                    ? 'The agent is waiting for you to apply or reject a change'
                    : (llmStatus?.error ?? null)
                }
                onClick={() => {
                  if (agentWaiting) return openAgent()
                  setLayout((l) => (l.rightOpen ? l : withSaved({ ...l, rightOpen: true })))
                  chooseSideTab('ai')
                }}
              />
            </footer>
          </aside>
          <Splitter
            side="left"
            width={layout.left}
            onResize={resizeLeft}
            onReset={() => updateLayout({ left: DEFAULT_LAYOUT.left })}
          />
        </>
      )}
      <main className="main">
        <TabBar
          tabs={tabs.tabs}
          activeId={tabs.activeId}
          onActivate={(id) => setTabs((s) => T.activate(s, id))}
          onClose={(id) => void closeTab(id)}
          onCloseOthers={(id) => {
            void autosave.flush().then(() => setTabs((s) => T.closeOthers(s, id)))
          }}
          onMove={(id, to) => setTabs((s) => T.moveTab(s, id, to))}
          onNewTab={() => openSwitcher(true)}
          leftOpen={layout.leftOpen}
          rightOpen={layout.rightOpen}
          onToggleLeft={toggleLeft}
          onToggleRight={toggleRight}
        />
        {message && (
          <div className="banner error" onClick={() => setMessage(null)}>
            {message} (click to dismiss)
          </div>
        )}
        {graphTab && (
          <GlobalGraph
            visible={graphTab.id === tabs.activeId}
            version={indexVersion}
            current={null}
            theme={theme}
            positions={graphPositions.global}
            onOpen={(p, newTab) => void openNote(p, newTab)}
            onOpenSettings={openSettings}
            onError={showError}
          />
        )}
        {timelineTab && (
          <TimelineView
            visible={timelineTab.id === tabs.activeId}
            version={indexVersion}
            current={lastNote}
            sessionGapMinutes={timeSettings.sessionGapMinutes}
            onOpen={(p, newTab) => void openNote(p, newTab)}
            onOpenSettings={openSettings}
            onError={showError}
          />
        )}
        {tabs.tabs.map((t) =>
          t.kind === 'note' ? (
            <NotePane
              key={t.id}
              path={t.path}
              active={t.id === tabs.activeId}
              preview={preview}
              autosave={autosave}
              isLocalOp={isLocalOp}
              getNotes={fetchNotes}
              onTogglePreview={togglePreview}
              onOpenLink={(target, newTab) => void openLink(target, newTab)}
              onError={showError}
              onSummarize={() => void summarize()}
              onSelectionChange={(p, text) => selections.current.set(p, text)}
              reveal={jump && jump.path === t.path ? jump : null}
            />
          ) : null
        )}
        {tabs.tabs.length === 0 && (
          <div className="empty no-tabs">
            <Logo size={64} className="empty-logo" />
            <p>Select a note on the left, or right-click to create one.</p>
            <dl className="shortcut-hints">
              {EMPTY_STATE_HINTS.map((h) => (
                <div key={h.keys}>
                  <dt>
                    {splitKeys(h.keys, MAC).map((k, i) => (
                      <span key={i}>
                        {i > 0 && '+'}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{h.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </main>
      {layout.rightOpen && (
        <>
          <Splitter
            side="right"
            width={layout.right}
            onResize={resizeRight}
            onReset={() => updateLayout({ right: DEFAULT_LAYOUT.right })}
          />
          <aside className="side-panel" style={{ width: layout.right }}>
            <nav className="side-tabs">
              <button
                className={sideTab === 'backlinks' ? 'active' : ''}
                onClick={() => chooseSideTab('backlinks')}
                title="Backlinks"
                aria-label="Backlinks"
              >
                <BacklinksIcon size={16} />
                <span className="label">Backlinks</span>
              </button>
              <button
                className={sideTab === 'local' ? 'active' : ''}
                onClick={() => chooseSideTab('local')}
                title="Local graph"
                aria-label="Local graph"
              >
                <LocalGraphIcon size={16} />
                <span className="label">Local graph</span>
              </button>
              <button
                className={sideTab === 'ai' ? 'active' : ''}
                onClick={() => chooseSideTab('ai')}
                title="Ask your notes, agent, summaries and AI status (Ctrl+Shift+A / Ctrl+Shift+G / Ctrl+Shift+S)"
                aria-label="AI"
              >
                <SparkleIcon size={16} />
                <span className="label">AI</span>
                {agentWaiting && (
                  <span className="attention-dot" aria-label="waiting for confirmation" />
                )}
              </button>
            </nav>
            {sideTab === 'ai' ? (
              <AiPanel
                status={llmStatus}
                mode={aiMode}
                onModeChange={chooseAiMode}
                chat={{
                  conversation,
                  focusKey: chatFocus,
                  onAsk: (q, range) => void askNotes(q, range),
                  onStop: stopAsking,
                  onReset: resetConversation,
                  onOpenSource: openSource,
                  onOpenLink: (target, newTab) => void openLink(target, newTab)
                }}
                agent={{
                  session: agentSession,
                  focusKey: agentFocus,
                  onRun: (task) => void runAgent(task),
                  onStop: stopAgent,
                  onReset: resetAgent,
                  onDecide: (step, decision) => void decideAgentStep(step, decision),
                  onOpenNote: (p, newTab) => void openNote(p, newTab),
                  onOpenLink: (target, newTab) => void openLink(target, newTab)
                }}
                agentWaiting={agentWaiting}
                note={currentNote}
                summary={summary}
                language={summaryLanguage}
                onLanguageChange={(l) => {
                  setSummaryLanguage(l)
                  saveSummaryLanguage(l)
                }}
                onSummarize={() => void summarize()}
                onStop={stopSummarizing}
                onRetry={() => void window.api.llm.retry().catch(showError)}
                onOpenSettings={() => setLlmSettingsOpen(true)}
                onOpenLink={(target, newTab) => void openLink(target, newTab)}
              />
            ) : !currentNote ? (
              <p className="panel-note">No note is open in this tab.</p>
            ) : sideTab === 'backlinks' ? (
              <BacklinksPanel
                path={currentNote}
                version={indexVersion}
                onOpen={(p, newTab) => void openNote(p, newTab)}
              />
            ) : (
              <LocalGraph
                path={currentNote}
                version={indexVersion}
                theme={theme}
                positions={graphPositions.local}
                onOpen={(p, newTab) => void openNote(p, newTab)}
                onError={showError}
              />
            )}
          </aside>
        </>
      )}
      {settingsOpen && (
        <TimeSettingsDialog
          value={timeSettings}
          semantic={semanticSettings}
          onSave={saveTimeSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {llmSettingsOpen && llmStatus && (
        <LlmSettingsDialog
          status={llmStatus}
          onSave={saveLlmSettings}
          onClose={() => setLlmSettingsOpen(false)}
        />
      )}
      {switcher && (
        <QuickSwitcher
          notes={switcher.notes}
          recent={switcher.recent}
          newTab={switcher.newTab}
          onOpen={(path, newTab) => {
            setSwitcher(null)
            void openNote(path, newTab)
          }}
          onClose={() => setSwitcher(null)}
        />
      )}
    </div>
  )
}

/** AI status at the bottom of the sidebar (clicking opens the AI tab on the right) */
function LlmBadge({
  status,
  detail,
  onClick
}: {
  status: ReturnType<typeof describeStatus>
  detail: string | null
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className="llm-badge" onClick={onClick} title={detail ?? 'AI status'}>
      <span className={`status-dot ${status.tone}`} aria-hidden="true" />
      {status.label}
    </button>
  )
}

function ThemeToggle({
  theme,
  onToggle
}: {
  theme: Theme
  onToggle: () => void
}): React.JSX.Element {
  const dark = theme === 'dark'
  return (
    <button
      className="icon"
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

export default App
