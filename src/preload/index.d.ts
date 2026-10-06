import { ElectronAPI } from '@electron-toolkit/preload'
import type { KnowmonAPI } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: KnowmonAPI
  }
}
