// IPC handler：renderer 只能透過這裡（以及 preload 暴露的 KnowmonAPI）存取檔案與 DB
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/channels'
import type { TreeNode } from '../shared/types'
import { loadSettings, saveSettings } from './settings'
import { Vault } from './vault'

export interface IpcContext {
  settingsDir: string
}

let current: Vault | null = null

function requireVault(): Vault {
  if (!current) throw new Error('No vault is open')
  return current
}

export async function openVault(root: string, ctx: IpcContext): Promise<Vault> {
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
  return vault
}

export async function closeVault(): Promise<void> {
  await current?.close()
  current = null
}

export function registerIpc(ctx: IpcContext): void {
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
}
