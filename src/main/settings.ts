// App 層級設定（上次開啟的 vault、Ollama 連線與模型），存在 userData/settings.json
import fs from 'node:fs'
import path from 'node:path'
import type { LlmSettings } from '../shared/types'

export interface Settings {
  lastVault: string | null
  /** 未設定的欄位用預設值（shared/llm.ts） */
  llm?: Partial<LlmSettings>
}

const DEFAULTS: Settings = { lastVault: null }

export function loadSettings(dir: string): Settings {
  try {
    const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'settings.json')
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
}
