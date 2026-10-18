import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/channels'
import type { AnswerChunk, KnowmonAPI, LlmStatus, SummaryChunk, VaultChange } from '../shared/types'

/** 訂閱 main 推送的事件，回傳取消訂閱的函式 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: KnowmonAPI = {
  vault: {
    pick: () => ipcRenderer.invoke(IPC.vaultPick),
    getCurrent: () => ipcRenderer.invoke(IPC.vaultGetCurrent),
    tree: () => ipcRenderer.invoke(IPC.vaultTree),
    onChange: (cb) => subscribe<VaultChange>(IPC.vaultChanged, cb)
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
  },
  graph: {
    get: () => ipcRenderer.invoke(IPC.graphGet)
  },
  timeline: {
    activity: (from, to) => ipcRenderer.invoke(IPC.timelineActivity, from, to)
  },
  settings: {
    getTime: () => ipcRenderer.invoke(IPC.settingsGetTime),
    setTime: (s) => ipcRenderer.invoke(IPC.settingsSetTime, s),
    getSemantic: () => ipcRenderer.invoke(IPC.settingsGetSemantic),
    setSemantic: (s) => ipcRenderer.invoke(IPC.settingsSetSemantic, s)
  },
  llm: {
    status: () => ipcRenderer.invoke(IPC.llmStatus),
    retry: () => ipcRenderer.invoke(IPC.llmRetry),
    onStatus: (cb) => subscribe<LlmStatus>(IPC.llmStatusChanged, cb),
    setSettings: (s) => ipcRenderer.invoke(IPC.llmSetSettings, s),
    retrieve: (q, opts) => ipcRenderer.invoke(IPC.llmRetrieve, q, opts),
    summarize: (req) => ipcRenderer.invoke(IPC.llmSummarize, req),
    cancel: (id) => ipcRenderer.invoke(IPC.llmCancel, id),
    onSummary: (cb) => subscribe<SummaryChunk>(IPC.llmSummary, cb),
    ask: (req) => ipcRenderer.invoke(IPC.llmAsk, req),
    onAnswer: (cb) => subscribe<AnswerChunk>(IPC.llmAnswer, cb)
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
