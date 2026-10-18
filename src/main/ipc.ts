// IPC handler：renderer 只能透過這裡（以及 preload 暴露的 KnowmonAPI）存取檔案與 DB
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/channels'
import type {
  AnswerChunk,
  ChatTurn,
  DateRange,
  LlmStatus,
  RetrieveOptions,
  SummaryChunk,
  TreeNode
} from '../shared/types'
import { LlmService } from './llm/service'
import { loadSettings, saveSettings } from './settings'
import { Vault } from './vault'

export interface IpcContext {
  settingsDir: string
}

let current: Vault | null = null
let llm: LlmService | null = null

function broadcast(channel: string, payload: LlmStatus | SummaryChunk | AnswerChunk): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

function requireLlm(): LlmService {
  if (!llm) throw new Error('LLM service is not ready')
  return llm
}

function requireVault(): Vault {
  if (!current) throw new Error('No vault is open')
  return current
}

export async function openVault(root: string, ctx: IpcContext): Promise<Vault> {
  // 先停下背景 embedding，再關閉舊 vault 的 DB
  await llm?.attach(null)
  await current?.close()
  current = null
  const vault = await Vault.open(root, {
    watch: true,
    trash: (p) => shell.trashItem(p)
  })
  vault.onChange((change) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.vaultChanged, change)
  })
  current = vault
  saveSettings(ctx.settingsDir, { ...loadSettings(ctx.settingsDir), lastVault: vault.root })
  // 不等連線檢查（Ollama 沒開時最多 2 秒）
  void llm?.attach(vault)
  return vault
}

export async function closeVault(): Promise<void> {
  await llm?.dispose()
  await current?.close()
  current = null
}

export function registerIpc(ctx: IpcContext): void {
  llm = new LlmService({
    loadSettings: () => loadSettings(ctx.settingsDir).llm,
    saveSettings: (s) =>
      saveSettings(ctx.settingsDir, { ...loadSettings(ctx.settingsDir), llm: s }),
    onStatus: (s) => broadcast(IPC.llmStatusChanged, s),
    onSummary: (c) => broadcast(IPC.llmSummary, c),
    onAnswer: (c) => broadcast(IPC.llmAnswer, c)
  })

  ipcMain.handle(IPC.vaultPick, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // 不自動開啟上次的 vault，但對話框會從上次的位置開始
    const { lastVault } = loadSettings(ctx.settingsDir)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a vault folder',
      ...(lastVault ? { defaultPath: lastVault } : {}),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return (await openVault(result.filePaths[0], ctx)).root
  })
  ipcMain.handle(IPC.vaultGetCurrent, () => current?.root ?? null)
  ipcMain.handle(IPC.vaultTree, (): Promise<TreeNode> => requireVault().tree())

  ipcMain.handle(IPC.notesRead, (_e, path: string) => requireVault().read(path))
  ipcMain.handle(IPC.notesWrite, (_e, path: string, content: string) =>
    requireVault().write(path, content)
  )
  ipcMain.handle(IPC.notesCreate, (_e, path: string) => requireVault().create(path))
  ipcMain.handle(IPC.notesCreateFolder, (_e, path: string) => requireVault().createFolder(path))
  ipcMain.handle(IPC.notesRename, (_e, from: string, to: string) => requireVault().rename(from, to))
  ipcMain.handle(IPC.notesRemove, (_e, path: string) => requireVault().remove(path))
  ipcMain.handle(IPC.notesList, () => requireVault().list())

  ipcMain.handle(IPC.linksBacklinks, (_e, path: string) => requireVault().backlinks(path))
  ipcMain.handle(IPC.graphGet, () => requireVault().graph())
  ipcMain.handle(IPC.timelineActivity, (_e, from: number, to: number) =>
    requireVault().activity(Number(from) || 0, Number(to) || 0)
  )
  ipcMain.handle(IPC.settingsGetTime, () => requireVault().getTimeSettings())
  ipcMain.handle(IPC.settingsSetTime, (_e, change: unknown) =>
    requireVault().setTimeSettings(change && typeof change === 'object' ? change : {})
  )
  ipcMain.handle(IPC.searchQuery, (_e, q: string, limit?: number) =>
    requireVault().search(String(q ?? ''), typeof limit === 'number' ? limit : undefined)
  )
  ipcMain.handle(IPC.settingsGetSemantic, () => requireVault().getSemanticSettings())
  ipcMain.handle(IPC.settingsSetSemantic, (_e, change: unknown) =>
    requireVault().setSemanticSettings(change && typeof change === 'object' ? change : {})
  )

  ipcMain.handle(IPC.llmStatus, () => requireLlm().status())
  ipcMain.handle(IPC.llmRetry, () => requireLlm().retry())
  ipcMain.handle(IPC.llmSetSettings, (_e, change: unknown) =>
    requireLlm().setSettings(change && typeof change === 'object' ? change : {})
  )
  ipcMain.handle(IPC.llmRetrieve, (_e, q: unknown, opts: unknown) => {
    requireVault()
    return requireLlm().retrieve(String(q ?? ''), retrieveOptions(opts))
  })
  ipcMain.handle(IPC.llmSummarize, (_e, req: unknown) => {
    requireVault()
    const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
    return requireLlm().summarize({
      path: String(r.path ?? ''),
      ...(typeof r.selection === 'string' ? { selection: r.selection } : {}),
      language: r.language === 'en' ? 'en' : 'zh-TW'
    })
  })
  ipcMain.handle(IPC.llmAsk, (_e, req: unknown) => {
    requireVault()
    const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
    return requireLlm().ask({
      question: String(r.question ?? ''),
      history: chatHistory(r.history),
      ...(r.range === null
        ? { range: null }
        : dateRange(r.range)
          ? { range: dateRange(r.range) }
          : {})
    })
  })
  ipcMain.handle(IPC.llmCancel, (_e, id: unknown) => requireLlm().cancel(String(id ?? '')))
}

const day = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined

/** renderer 傳來的時間範圍；不合法時 undefined（改從問題解析） */
function dateRange(input: unknown): DateRange | undefined {
  if (!input || typeof input !== 'object') return undefined
  const o = input as Record<string, unknown>
  const from = day(o.from)
  const to = day(o.to)
  if (!from || !to) return undefined
  return from <= to ? { from, to } : { from: to, to: from }
}

/** renderer 傳來的對話紀錄只取合法的訊息 */
function chatHistory(input: unknown): ChatTurn[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((t): ChatTurn[] => {
    if (!t || typeof t !== 'object') return []
    const { role, content } = t as Record<string, unknown>
    return (role === 'user' || role === 'assistant') && typeof content === 'string'
      ? [{ role, content }]
      : []
  })
}

/** renderer 傳來的檢索選項只取合法欄位 */
function retrieveOptions(input: unknown): RetrieveOptions {
  if (!input || typeof input !== 'object') return {}
  const o = input as Record<string, unknown>
  return {
    ...(typeof o.limit === 'number' ? { limit: o.limit } : {}),
    ...(day(o.from) ? { from: day(o.from) } : {}),
    ...(day(o.to) ? { to: day(o.to) } : {}),
    ...(typeof o.expand === 'boolean' ? { expand: o.expand } : {})
  }
}
