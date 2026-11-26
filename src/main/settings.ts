// App-level settings (last opened vault, Ollama connection and models, cloud providers), stored in userData/settings.json
import fs from 'node:fs'
import path from 'node:path'
import type { CloudProvider, LlmSettings } from '../shared/types'

export interface Settings {
  lastVault: string | null
  /** Missing fields use the defaults (shared/llm.ts) */
  llm?: Partial<LlmSettings>
  /** Cloud provider API keys: base64 after safeStorage encryption (llm/secrets.ts) */
  llmKeys?: Partial<Record<CloudProvider, string>>
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
