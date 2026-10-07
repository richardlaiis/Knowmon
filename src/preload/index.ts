import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/channels'
import type { KnowmonAPI, VaultChange } from '../shared/types'

const api: KnowmonAPI = {
  vault: {
    pick: () => ipcRenderer.invoke(IPC.vaultPick),
    getCurrent: () => ipcRenderer.invoke(IPC.vaultGetCurrent),
    tree: () => ipcRenderer.invoke(IPC.vaultTree),
    onChange: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, c: VaultChange): void => cb(c)
      ipcRenderer.on(IPC.vaultChanged, listener)
      return () => ipcRenderer.removeListener(IPC.vaultChanged, listener)
    }
  },
  notes: {
    read: (path) => ipcRenderer.invoke(IPC.notesRead, path),
    write: (path, content) => ipcRenderer.invoke(IPC.notesWrite, path, content),
    create: (path) => ipcRenderer.invoke(IPC.notesCreate, path),
    createFolder: (path) => ipcRenderer.invoke(IPC.notesCreateFolder, path),
    rename: (from, to) => ipcRenderer.invoke(IPC.notesRename, from, to),
    remove: (path) => ipcRenderer.invoke(IPC.notesRemove, path),
    list: () => ipcRenderer.invoke(IPC.notesList)
  },
  links: {
    backlinks: (path) => ipcRenderer.invoke(IPC.linksBacklinks, path)
  },
  search: {
    query: (q, limit) => ipcRenderer.invoke(IPC.searchQuery, q, limit)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
