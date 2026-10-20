import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SEMANTIC_SETTINGS } from '../../shared/llm'
import { resolveLink } from '../../shared/links'
import { DEFAULT_TIME_SETTINGS } from '../../shared/time'
import type {
  AgentDecision,
  AgentStep,
  AskSource,
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
import { Splitter } from './components/Splitter'
import { TimeSettingsDialog } from './components/TimeSettingsDialog'
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
    // 無法儲存偏好時仍可切換
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

/** 每個 vault 各自記住開著的分頁 */
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
    // 無法儲存時下次就從空白開始
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
  /** 索引可能改變時遞增（外部修改、App 內操作、儲存），讓搜尋、反向連結與圖譜重新查詢 */
  const [indexVersion, setIndexVersion] = useState(0)
  const [switcher, setSwitcher] = useState<{
    notes: NoteSummary[]
    recent: string[]
    newTab: boolean
  } | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>(() => loadSideTab())
  // 圖譜節點座標快取，換 vault 時重新開始
  const graphPositions = useMemo(
    () => ({ global: new Map<string, Point>(), local: new Map<string, Point>(), vault }),
    [vault]
  )
  /** 這個 vault 的時間參數（時間軸的 session 切分用；時間邊由 main 計算） */
  const [timeSettings, setTimeSettings] = useState<TimeSettings>(DEFAULT_TIME_SETTINGS)
  const [semanticSettings, setSemanticSettings] =
    useState<SemanticSettings>(DEFAULT_SEMANTIC_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const llmStatus = useLlmStatus(vault)
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [summaryLanguage, setSummaryLanguage] = useState(loadSummaryLanguage)
  const [aiMode, setAiMode] = useState<AiMode>(loadAiMode)
  /** 問答對話，只存在記憶體；換 vault 時清空 */
  const [conversation, setConversation] = useState<Conversation>(emptyConversation)
  /** 遞增時聚焦對話輸入框 */
  const [chatFocus, setChatFocus] = useState(0)
  /** agent 任務，只存在記憶體；換 vault 時清空 */
  const [agentSession, setAgentSession] = useState<AgentSession>(emptySession)
  const [agentFocus, setAgentFocus] = useState(0)
  const agentWaiting = pendingConfirm(agentSession) !== null
  /** 各筆記編輯器目前選取的文字（總結選取文字用） */
  const selections = useRef(new Map<string, string>())
  /** 搜尋結果要捲到的行；n 每次遞增，同一行也會再跳 */
  const [jump, setJump] = useState<{ path: string; line: number; n: number } | null>(null)
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )

  // 事件處理器（watcher）讀取最新的分頁狀態
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  })

  const current = T.activeTab(tabs)
  const currentNote = current?.kind === 'note' ? current.path : null

  // 最近開啟的筆記（Quick switcher 排序用），越前面越近
  const recent = useRef<string[]>([])
  /** 最後看的筆記：切到時間軸時仍標示它（render 時直接調整，不經過 effect） */
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

  // ---- 分頁的存檔與還原 ----
  /** 已經還原過分頁的 vault；還原完成前不存檔，避免空的狀態蓋掉上次的分頁 */
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

  // 背景 embedding 告一段落時，semantic 邊與混合檢索的結果可能改變
  const embedBusy = llmStatus?.busy ?? false
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !embedBusy) setIndexVersion((v) => v + 1)
    wasBusy.current = embedBusy
  }, [embedBusy])

  // 總結與問答的串流片段
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
      // 無法儲存偏好時仍可切換
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

  // App 自己發起的新增/改名/刪除進行中，忽略 watcher 對開著的筆記的通知
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

  // 啟動：還原上次的 vault
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

  // 外部修改：更新檔案樹；筆記被外部刪除或移走時關閉它的分頁（內容變更由各分頁自己處理）
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

  // 關閉視窗前寫出未儲存的內容
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
      // 讓 watcher 對這次操作的回音先過去
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

  /** 開啟筆記：取代目前分頁，newTab 時開新分頁；已開著就切過去 */
  const openNote = useCallback(
    async (path: string, newTab = false): Promise<void> => {
      // 取代分頁時原本的編輯器會被移除，先寫出未儲存的內容
      await autosave.flush()
      setTabs((s) => T.openNote(s, path, newTab))
    },
    [autosave]
  )

  /** 搜尋結果：開啟筆記並捲到命中的段落 */
  const openAt = async (path: string, newTab: boolean, line?: number): Promise<void> => {
    await openNote(path, newTab)
    if (line) setJump((j) => ({ path, line, n: (j?.n ?? 0) + 1 }))
  }

  /** 總結目前的筆記；編輯器有選取文字時只總結選取的部分 */
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
      // main 從索引讀內文，先寫出未儲存的內容
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

  /** 打開右側 AI 分頁的對話並聚焦輸入框 */
  const openChat = useCallback((): void => {
    setLayout((l) => (l.rightOpen ? l : withSaved({ ...l, rightOpen: true })))
    chooseSideTab('ai')
    chooseAiMode('chat')
    setChatFocus((n) => n + 1)
  }, [chooseSideTab, chooseAiMode])

  /** 打開右側 AI 分頁的 agent 並聚焦輸入框 */
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
      // 工具從索引讀取，先寫出未儲存的內容
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
      // add_tags 會在 main 重新讀檔，先寫出未儲存的內容
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
      // main 從索引檢索，先寫出未儲存的內容
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

  const saveLlmSettings = async (next: LlmSettings): Promise<void> => {
    try {
      await window.api.llm.setSettings(next)
      setLlmSettingsOpen(false)
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
      // 時間邊與 semantic 邊會重算，讓圖譜重新取得資料
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

  /** [[目標]]：開啟筆記，不存在時在 vault 根目錄建立 */
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

  /** 在檔案樹顯示名稱輸入框，輸入名稱後才建立（見 createItem） */
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
      // 新筆記開在新分頁，不取代正在看的筆記
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

  // 面板寬度：拖曳時限制在上下限內，且不把編輯器擠得太窄
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

  // 全域快捷鍵（完整列表見 README 的「快捷鍵」）
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
      // 不讓編輯器再處理同一個按鍵（例如 CodeMirror 的 Ctrl/Cmd+G 是「找下一個」）
      e.stopPropagation()
    }
    // capture：在編輯器之前攔截全域快捷鍵
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
      <div className="empty">
        <div className="corner">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <h1>Knowmon</h1>
        <p>Choose a folder as your vault. Notes are stored in it as Markdown files.</p>
        <button className="primary" onClick={pickVault}>
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
                {tree?.name ?? vault}
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
              >
                Files
              </button>
              <button
                className={sidebarTab === 'search' ? 'active' : ''}
                onClick={openSearch}
                title="Search (Ctrl+Shift+F)"
              >
                Search
              </button>
              <button onClick={openGraph} title="Graph view (Ctrl+G)">
                Graph
              </button>
              <button onClick={openTimeline} title="Timeline (Ctrl+Shift+T)">
                Timeline
              </button>
              <button onClick={() => openSwitcher(false)} title="Quick switcher (Ctrl+O)">
                Go to…
              </button>
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
          <div className="empty">
            <p>Select a note on the left, or right-click to create one.</p>
            <p className="hint">
              Ctrl+O to jump to a note · Ctrl+Shift+F to search · Ctrl+G for the graph ·
              Ctrl+Shift+T for the timeline · Ctrl+Shift+S to summarize
            </p>
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
              >
                Backlinks
              </button>
              <button
                className={sideTab === 'local' ? 'active' : ''}
                onClick={() => chooseSideTab('local')}
              >
                Local graph
              </button>
              <button
                className={sideTab === 'ai' ? 'active' : ''}
                onClick={() => chooseSideTab('ai')}
                title="Ask your notes, agent, summaries and AI status (Ctrl+Shift+A / Ctrl+Shift+G / Ctrl+Shift+S)"
              >
                AI
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

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

function NewNoteIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </svg>
  )
}

function NewFolderIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10v6M9 13h6" />
    </svg>
  )
}

/** 側欄底部的 AI 狀態（點擊打開右側的 AI 分頁） */
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
    <button className="llm-badge" onClick={onClick} title={detail ?? 'Local AI (Ollama)'}>
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

function MoonIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  )
}

function SunIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export default App
