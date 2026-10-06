// App 層級設定（例如上次開啟的 vault），存在 userData/settings.json
import fs from 'node:fs'
import path from 'node:path'

export interface Settings {
  lastVault: string | null
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
